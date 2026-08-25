import { braze, warnIfUnverified } from "../selectors.mjs";
import { paths, WIZARD, campaignIdFromUrl } from "../urls.mjs";
import { login, appGroup } from "./login.mjs";

/**
 * Read the whole campaigns index out of the dashboard.
 *
 * There is no Braze REST key available on this account, so the dashboard is the
 * only source of truth for what campaigns exist and what state they are in, and
 * `data/campaigns.json` is a cache of this scrape. That makes the flow
 * load-bearing for invoicing: every record it returns eventually becomes a line
 * on a bill, which is why nothing below guesses. A status it does not recognise
 * comes back as "unknown" with the dashboard's own wording attached, and a
 * human decides — billing the wrong campaign is far more expensive than a
 * campaign sitting unclassified for a day.
 *
 * Read-only, deliberately so: it navigates, it reads, and the only thing it
 * ever clicks is a paging control that has been checked against
 * `braze.campaignList.neverClick` first.
 */

/**
 * The ledger's vocabulary, and the only strings that map into it. Exact match
 * on the lower-cased, trimmed cell — no prefix or substring matching, because
 * "Stopped" and "Stopped (draft copy)" are not the same thing and PLAN-BILLING
 * makes `stopped` the word that turns a campaign billable.
 *
 * Everything Braze prints that is not in here — "Scheduled", "Paused", "Sent",
 * "In progress" — is passed through as unknown on purpose. They are plausible
 * synonyms for members of this list, and plausible is not good enough: the
 * first real run logs the distinct raw values it saw, and each one gets added
 * here by hand once we know what it means.
 */
const STATUS = new Map([
  ["draft", "draft"],
  ["active", "active"],
  ["live", "active"],
  ["stopped", "stopped"],
  ["completed", "completed"],
  ["archived", "archived"],
]);

/** Header label -> field, applied to whatever the table's header row says. */
const COLUMNS = [
  ["name", /^(name|campaign|campaign name|title)$/i],
  ["status", /^(status|state)$/i],
  ["channel", /^(channel|channels|message type|type)$/i],
  ["createdAt", /created|added/i],
  ["lastEditedAt", /modified|updated|last edit/i],
  ["firstSentAt", /sent|delivered|last send/i],
  ["scheduledFor", /start|scheduled|launch|send (date|time)/i],
];

const CHANNELS = /email|push|in-app|in app|webhook|sms|whatsapp|content card/i;

/**
 * @param {string} raw the status column exactly as the dashboard printed it
 * @returns {{brazeStatus: string, statusRaw: string}} `brazeStatus` is one of
 *   draft|active|stopped|completed|archived|unknown
 */
export function normalizeStatus(raw) {
  const statusRaw = String(raw ?? "").replace(/\s+/g, " ").trim();
  return { brazeStatus: STATUS.get(statusRaw.toLowerCase()) ?? "unknown", statusRaw };
}

/**
 * Turn one extracted row into a ledger record, or null when the row is not a
 * campaign at all — a header, a spacer, a "no results" row. Identity is the
 * campaign id off the link href and nothing else: names repeat (ours are all
 * `YYYYMMDD`) and a name-keyed ledger would merge two months into one line.
 */
export function parseRow(row, columns) {
  const id = campaignIdFromUrl(row.href || "");
  if (!id) return null;

  const cells = (row.cells || []).map(c => String(c).replace(/\s+/g, " ").trim());
  const at = field => {
    const index = columns?.[field];
    return index === undefined ? "" : cells[index] ?? "";
  };

  // Without a usable header row the columns are unknown, so each value is
  // recovered from whichever cell looks like it: the status from a word in the
  // ledger's vocabulary, the channel from a known channel name. That is weaker
  // than the header map and it is why the flow logs which one it used.
  const byHeader = Boolean(columns && Object.keys(columns).length);
  const status = byHeader
    ? at("status")
    : cells.find(c => STATUS.has(c.toLowerCase())) ?? "";
  const channelCell = byHeader ? at("channel") : cells.find(c => CHANNELS.test(c)) ?? "";
  const name = (byHeader && at("name")) || row.linkText || cells[0] || "";

  const { brazeStatus, statusRaw } = normalizeStatus(status);

  return {
    id,
    name: name.replace(/\s+/g, " ").trim(),
    href: row.href,
    brazeStatus,
    statusRaw,
    channel: channelCell.match(CHANNELS)?.[0].toLowerCase() ?? channelCell,
    createdAt: date(at("createdAt")),
    scheduledFor: date(at("scheduledFor")),
    firstSentAt: date(at("firstSentAt")),
    lastEditedAt: date(at("lastEditedAt")),
    /**
     * Every cell, keyed by its header. The parsed dates above are a best
     * effort — the dashboard renders in the viewer's locale, so 03/04 is
     * ambiguous — and this is the original text to fall back on when one of
     * them looks wrong on an invoice.
     */
    cells: byHeader
      ? Object.fromEntries(Object.entries(columns).map(([field, i]) => [field, cells[i] ?? ""]))
      : { row: cells.join(" | ") },
  };
}

/**
 * A date cell as ISO, or the raw text when it cannot be read. Never null on a
 * non-empty cell: losing "Aug 25" because it did not parse would show as "no
 * send date" on the ledger, which reads as a fact rather than as a failure.
 */
function date(text) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!value || /^(—|-|n\/a|never)$/i.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

/** Map the table's header labels onto field names. */
export function mapColumns(headers) {
  const columns = {};
  headers.forEach((label, index) => {
    const text = String(label).replace(/\s+/g, " ").trim();
    if (!text) return;
    for (const [field, pattern] of COLUMNS) {
      if (columns[field] === undefined && pattern.test(text)) {
        columns[field] = index;
        return;
      }
    }
  });
  return columns;
}

/** The first candidate locator that actually matches, with its name. */
async function firstMatch(page, strategies, get = s => s.locator(page)) {
  for (const strategy of strategies) {
    const count = await get(strategy).count().catch(() => 0);
    if (count > 0) return { ...strategy, count, locator: get(strategy) };
  }
  return null;
}

/**
 * Read the rows currently in the DOM. Exported so the offline fixture tests can
 * drive it against saved HTML — the parsing is the part that will be wrong, and
 * it should not take a live dashboard to find that out.
 */
export async function readRows(page) {
  const { cellSelector, linkSelector, rowStrategies, headerStrategies } = braze.campaignList;

  const header = await firstMatch(page, headerStrategies, s => s.headers(page));
  const headers = header ? await header.locator.allInnerTexts() : [];
  const columns = mapColumns(headers);

  const matched = await firstMatch(page, rowStrategies, s => s.rows(page));
  if (!matched) return { strategy: null, headerStrategy: header?.name ?? null, headers, columns, rows: [] };

  // One evaluate for the whole table: per-row locator calls cost a round trip
  // each, and this list can run to several hundred rows.
  const raw = await matched.locator.evaluateAll(
    (els, sel) =>
      els.map(el => {
        const link = el.querySelector(sel.link);
        let cells = [...el.querySelectorAll(sel.cell)].map(c => c.textContent || "");
        // A virtualised list has no cell semantics at all, so its direct
        // children are the closest thing to columns. Worse than real cells and
        // knowingly so — it is what keeps a status readable when the row is a
        // pile of divs.
        if (!cells.length) cells = [...el.children].map(c => c.textContent || "");
        return {
          href: link?.getAttribute("href") || "",
          linkText: link?.textContent?.trim() || "",
          cells,
        };
      }),
    { cell: cellSelector, link: linkSelector }
  );

  return {
    strategy: matched.name,
    headerStrategy: header?.name ?? null,
    headers: headers.map(h => h.replace(/\s+/g, " ").trim()),
    columns,
    rows: raw.map(r => parseRow(r, columns)).filter(Boolean),
  };
}

/**
 * List every campaign in the workspace.
 *
 * @param {import("../runner.mjs").RunContext} ctx
 * @param {{status?: string, limit?: number, maxRounds?: number, pageSize?: number}} options
 *   `status` filters the *normalised* status locally rather than by driving the
 *   dashboard's own filter UI — one less control to click on a read-only flow,
 *   and the filter's wording is one more thing that could be wrong.
 *   `pageSize` is the `limit` query parameter, i.e. how many rows one
 *   navigation asks for. The dashboard's own UI uses 96; asking for more is
 *   what makes most workspaces a single request, and if Braze caps it the flow
 *   notices because the page comes back short and simply asks for the next
 *   window.
 */
export async function listCampaigns(ctx, { status = "", limit = 0, maxRounds = 60, pageSize = 200 } = {}) {
  warnIfUnverified(ctx, "listCampaigns");
  await login(ctx);
  const group = await appGroup(ctx);

  await ctx.step("open the campaigns index", async p => {
    await p.goto(ctx.base + paths.campaignList(group, { start: 0, limit: pageSize }), {
      waitUntil: "domcontentloaded",
    });
    // The index is lazy-loaded and networkidle never fires on this dashboard,
    // so wait on the content. A missing anchor is reported, not thrown: the
    // page may simply be empty, and "found nothing" is a legitimate answer.
    const ready = await firstMatchVisible(p, braze.campaignList.readyStrategies);
    if (ready) ctx.log(`the list painted — matched by "${ready}"`);
    else ctx.log("none of the readiness anchors matched; reading whatever is there", "warn");
    await p.waitForTimeout(2_000);
  });

  const view = await ctx.step("clear the dashboard's own filter and page at the largest size", p =>
    widenTheList(ctx, p)
  );

  const seen = new Map();
  let strategy = null;
  let headers = [];
  let rounds = 0;
  let pagesClicked = 0;
  let scrolls = 0;
  let stopped = "end of list";

  await ctx.step("read every row", async p => {
    for (rounds = 1; rounds <= maxRounds; rounds++) {
      const batch = await readRows(p);
      if (rounds === 1) {
        strategy = batch.strategy;
        headers = batch.headers;
        // Logged rather than asserted, because this is the line that will tell
        // us on the first real run which guess in selectors.mjs was right.
        ctx.log(
          `rows matched by "${batch.strategy ?? "nothing"}", headers via ` +
            `"${batch.headerStrategy ?? "nothing"}": [${batch.headers.join(" | ")}] -> ` +
            `${JSON.stringify(batch.columns)}`
        );
      }

      const before = seen.size;
      for (const row of batch.rows) if (!seen.has(row.id)) seen.set(row.id, row);
      if (seen.size > before) ctx.log(`round ${rounds}: ${seen.size} campaigns so far`);

      if (limit && seen.size >= limit) {
        stopped = `limit of ${limit} reached`;
        break;
      }

      // Page by URL. The index keeps its window in the query string, so the
      // next page is a navigation with a bigger `start` — deterministic, and
      // with no control to mis-resolve. A page that comes back shorter than it
      // was asked for is the last one.
      if (batch.rows.length < pageSize) {
        stopped = rounds === 1 ? "single page" : "end of list";
        break;
      }
      const start = rounds * pageSize;
      await p.goto(ctx.base + paths.campaignList(group, { start, limit: pageSize, extra: view.filterParams }), {
        waitUntil: "domcontentloaded",
      });
      await firstMatchVisible(p, braze.campaignList.readyStrategies, 20_000);
      await p.waitForTimeout(2_000);
      pagesClicked++;

      // If the window moved but the rows did not, the parameters are being
      // ignored — an older dashboard build, or a view that scrolls rather than
      // pages. Fall back to the DOM: scrolling first, because it cannot click
      // anything, and only then a paging control.
      const fresh = await readRows(p);
      const known = fresh.rows.filter(r => seen.has(r.id)).length;
      if (fresh.rows.length && known === fresh.rows.length) {
        ctx.log(`start=${start} returned the same rows — the URL window is being ignored, falling back to the DOM`, "warn");
        const grew = await scrollForMore(p, seen, seen.size);
        if (grew.scrolled) scrolls++;
        if (grew.more) continue;
        if (!(await clickNext(ctx, p))) {
          stopped = "no further page";
          break;
        }
        await p.waitForTimeout(2_500);
      }
    }
    if (rounds > maxRounds) stopped = `stopped after ${maxRounds} rounds`;
  });

  let campaigns = [...seen.values()];
  if (status) {
    const wanted = status.toLowerCase();
    campaigns = campaigns.filter(c => c.brazeStatus === wanted);
  }
  if (limit) campaigns = campaigns.slice(0, limit);

  // Turn every campaign's href into the absolute URL the ledger stores, so the
  // table can link straight out to Braze.
  for (const campaign of campaigns) {
    campaign.url = ctx.base + paths.campaign(campaign.id, group, WIZARD.compose);
    delete campaign.href;
  }

  const unknown = campaigns.filter(c => c.brazeStatus === "unknown");
  if (unknown.length) {
    const words = [...new Set(unknown.map(c => c.statusRaw || "(empty)"))];
    ctx.log(
      `${unknown.length} campaigns have a status this flow does not recognise: ` +
        `${words.join(", ")} — they are recorded as "unknown" rather than guessed. ` +
        `Add them to STATUS in braze/flows/list-campaigns.mjs once their meaning is known.`,
      "warn"
    );
  }

  // The empirical check, and the one that does not depend on a single guessed
  // selector: this workspace's campaigns are overwhelmingly finished ones, so a
  // read that comes back entirely Active has almost certainly been served the
  // saved view rather than the whole list.
  const active = campaigns.filter(c => c.brazeStatus === "active").length;
  if (campaigns.length >= 5 && active === campaigns.length) {
    view.unfiltered = false;
    view.note = `every one of the ${campaigns.length} rows read is Active, which means the list is still filtered`;
    ctx.log(
      `all ${campaigns.length} campaigns came back Active — the dashboard's default view is Active-only, ` +
        `so the filter was not actually cleared. Nothing billable is Active, so this read is not usable.`,
      "error"
    );
  }

  if (!view.unfiltered) {
    ctx.log(
      `the campaign list may still be filtered (${view.note}) — this run will NOT be treated as ` +
        `a complete view of the workspace, so nothing will be flagged as missing. ` +
        `Braze's saved view shows Active campaigns only, and everything billable is Stopped.`,
      "warn"
    );
  }

  const result = {
    flow: "listCampaigns",
    appGroup: group,
    count: campaigns.length,
    strategy,
    headers,
    pagesClicked,
    scrolls,
    rounds,
    /** False whenever the dashboard's own filter could not be proven cleared. */
    unfiltered: view.unfiltered,
    filterNote: view.note,
    pageSize: view.pageSize,
    /** Whatever the view added to the query string — the filter's parameter. */
    filterParams: view.filterParams,
    stopped,
    unknownStatuses: unknown.length,
    syncedAt: new Date().toISOString(),
    campaigns,
  };
  ctx.log(`${campaigns.length} campaigns (${stopped}, ${pagesClicked} pages, ${scrolls} scrolls)`);
  // Single-line JSON at info level, last: this is the only way a result crosses
  // the process boundary to /api/braze/run — the return value below reaches the
  // CLI and the tests and nothing else.
  ctx.log(JSON.stringify(result));
  return result;
}

/** Name of the first readiness anchor that becomes visible, or null. */
async function firstMatchVisible(page, strategies, timeout = 15_000) {
  for (const strategy of strategies) {
    const visible = await strategy
      .locator(page)
      .waitFor({ state: "visible", timeout })
      .then(() => true)
      .catch(() => false);
    if (visible) return strategy.name;
  }
  return null;
}

/**
 * A label that is safe to click while clearing the view, and one that is not.
 * The clearing controls sit in the same toolbar as "Create campaign" and, on a
 * row, "Archive" — so a mis-resolved candidate is not a missed click, it is a
 * mutation on a production dashboard.
 */
const CLEAR_LABEL = /clear|reset|^all( campaigns)?$/i;
const DESTRUCTIVE = /delete|archive|send|launch|stop|pause|duplicate|create|new|edit|save/i;

/**
 * Open the list up before reading it: drop the dashboard's own filter and show
 * as many rows per page as it offers.
 *
 * This is the step that decides whether the ledger is worth anything. The
 * campaign index opens on the saved view, which here lists Active campaigns
 * only — and every campaign this project bills for is Stopped. Left alone, the
 * sync would faithfully record the one set of campaigns that can never be
 * invoiced and report that it worked.
 *
 * Returns what it managed to prove rather than a boolean the caller has to
 * trust: `unfiltered` is true only when a filter control was actually operated
 * AND no evidence of a remaining filter is left on screen. Anything less is
 * false, which costs nothing but a warning and the right to flag missing
 * campaigns — the conservative direction, since the alternative is a ledger
 * that quietly under-reports what is billable.
 */
async function widenTheList(ctx, page) {
  let cleared = null;

  for (const strategy of braze.campaignList.clearFilterStrategies) {
    const control = strategy.locator(page);
    if (!(await control.isVisible({ timeout: 1_000 }).catch(() => false))) continue;
    if (await control.isDisabled().catch(() => false)) continue;

    const label = (
      (await control.innerText().catch(() => "")) ||
      (await control.getAttribute("aria-label").catch(() => "")) ||
      ""
    ).trim().replace(/\s+/g, " ");

    if (DESTRUCTIVE.test(label)) {
      ctx.log(`refusing to click "${label}" while clearing filters — it is not a filter control`, "warn");
      continue;
    }
    // A chip's dismiss button is usually an unlabelled ×, so an empty label is
    // allowed for that strategy alone; every other candidate has to say what it
    // is before it gets clicked.
    if (!label && strategy.name !== "filter-chip-dismiss") continue;
    if (label && !CLEAR_LABEL.test(label) && strategy.name !== "filter-chip-dismiss") continue;

    await control.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
    cleared = `${strategy.name}${label ? ` ("${label}")` : ""}`;
    ctx.log(`cleared the list filter via ${cleared}`);
    break;
  }

  const remaining = await firstMatchVisible(page, braze.campaignList.activeFilterStrategies, 1_500);
  const pageSize = await maximisePageSize(ctx, page);

  // The index keeps its view state in the query string, so whatever clearing
  // the filter did to the URL *is* the filter's parameter — the one thing about
  // this page we cannot guess from here. It is captured, carried on every
  // subsequent navigation so paging does not silently re-filter, and logged
  // loudly so it can be pinned into paths.campaignList once seen for real.
  const filterParams = viewParams(page.url());
  if (Object.keys(filterParams).length) {
    ctx.log(`the view carries filter parameters: ${JSON.stringify(filterParams)} — pin these in braze/urls.mjs`);
  }

  const note = cleared
    ? remaining
      ? `cleared via ${cleared} but "${remaining}" still looks like an applied filter`
      : `cleared via ${cleared}`
    : "no filter control matched — the saved view was read as-is";

  return { unfiltered: Boolean(cleared) && !remaining, note, pageSize, filterParams };
}

/** The query parameters that are not ours — i.e. whatever the view added. */
const OWN_PARAMS = new Set(["locale", "start", "limit", "globalFilter", "sortby", "sortdir", "display"]);

function viewParams(url) {
  const out = {};
  try {
    for (const [key, value] of new URL(url).searchParams) {
      if (!OWN_PARAMS.has(key)) out[key] = value;
    }
  } catch {
    // A URL we cannot parse tells us nothing; the caller carries on without it.
  }
  return out;
}

/**
 * Set rows-per-page to the largest value offered. Every page boundary is a
 * click that can fail halfway and leave the ledger holding a truncated view of
 * the workspace, so the fewer of them the better. The largest option is read
 * off the control rather than assumed: Braze's page sizes are not ours to pin.
 */
async function maximisePageSize(ctx, page) {
  for (const strategy of braze.campaignList.pageSizeStrategies) {
    const control = strategy.locator(page);
    if (!(await control.isVisible({ timeout: 1_000 }).catch(() => false))) continue;

    const tag = await control.evaluate(el => el.tagName.toLowerCase()).catch(() => "");
    if (tag === "select") {
      const options = await control
        .evaluate(el => [...el.options].map(o => ({ value: o.value, text: o.textContent || "" })))
        .catch(() => []);
      const numeric = options
        .map(o => ({ ...o, n: Number.parseInt((o.text.match(/\d+/) || [])[0] ?? "", 10) }))
        .filter(o => Number.isFinite(o.n));
      if (!numeric.length) continue;
      const largest = numeric.reduce((max, o) => (o.n > max.n ? o : max));
      await control.selectOption(largest.value).catch(() => {});
      await page.waitForTimeout(2_500);
      ctx.log(`rows per page set to ${largest.n} (from ${numeric.map(o => o.n).join(", ")})`);
      return largest.n;
    }

    // A react-select style control: open it, then click the largest number in
    // the menu it paints. Nothing here types, so a menu that fails to open
    // simply leaves the default page size in place.
    await control.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
    const items = page.getByRole("option");
    const texts = await items.allInnerTexts().catch(() => []);
    const numbers = texts.map(t => Number.parseInt((t.match(/\d+/) || [])[0] ?? "", 10));
    const best = numbers.reduce((max, n, i) => (Number.isFinite(n) && n > (numbers[max] ?? -1) ? i : max), -1);
    if (best < 0) {
      await page.keyboard.press("Escape").catch(() => {});
      continue;
    }
    await items.nth(best).click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
    ctx.log(`rows per page set to ${numbers[best]} (from ${numbers.filter(Number.isFinite).join(", ")})`);
    return numbers[best];
  }

  ctx.log("no rows-per-page control matched; reading the list at its default page size", "warn");
  return null;
}

/**
 * Scroll the list and report whether that produced anything. Handles both the
 * window-scrolled and the own-viewport-scrolled shapes; a virtualised list
 * recycles its DOM nodes, so what matters is not that new elements appeared but
 * that new *ids* did, which is why `seen` is passed in.
 */
async function scrollForMore(page, seen, before) {
  let scrolled = false;
  for (const strategy of braze.campaignList.scrollStrategies) {
    const target = strategy.locator(page);
    if (!(await target.count().catch(() => 0))) continue;
    await target
      .evaluate(el => {
        const box = el.closest("[style*='overflow'], [class*='scroll']") || el;
        box.scrollTop = box.scrollHeight;
      })
      .catch(() => {});
    scrolled = true;
    break;
  }
  await page.mouse.wheel(0, 4_000).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  // Lazy loading needs a beat; the dashboard paints the new rows well after the
  // scroll event, and there is no request to wait on that reliably settles.
  await page.waitForTimeout(2_000);

  const after = await readRows(page);
  for (const row of after.rows) if (!seen.has(row.id)) seen.set(row.id, row);
  return { scrolled, more: seen.size > before };
}

/**
 * Click a paging control, if there is one that is enabled. Returns false when
 * the list does not paginate — which is a normal outcome, not an error.
 */
async function clickNext(ctx, page) {
  for (const strategy of braze.campaignList.moreStrategies) {
    const control = strategy.locator(page);
    if (!(await control.isVisible({ timeout: 500 }).catch(() => false))) continue;
    if (await control.isDisabled().catch(() => false)) continue;

    // Read-only means read-only: whatever this candidate resolved to, its own
    // label has to prove it is a paging control before it is clicked.
    const label = ((await control.innerText().catch(() => "")) ||
      (await control.getAttribute("aria-label").catch(() => "")) ||
      "").trim();
    if (braze.campaignList.neverClick.test(label)) {
      ctx.log(`refusing to click "${label}" — it is not a paging control`, "warn");
      continue;
    }
    ctx.log(`paging with "${strategy.name}" (${label || "no label"})`);
    await control.click();
    return true;
  }
  return false;
}

/**
 * Screenshot one campaign's message preview.
 *
 * Kept out of `listCampaigns` on purpose: this opens a page per campaign and
 * takes minutes over a real workspace, and the ledger sync has to stay fast and
 * has to keep working when this breaks. A campaign with no preview yields no
 * file and says so — a missing thumbnail is cosmetic, a failed sync is not.
 *
 * @param {{campaignId: string, outPath?: string}} options `outPath` is the
 *   caller's to choose, so the route can write straight into
 *   `data/assets/campaigns/<id>/preview.png`.
 */
export async function captureCampaignPreview(ctx, { campaignId, outPath } = {}) {
  if (!campaignId) throw new Error("captureCampaignPreview needs a campaignId");

  warnIfUnverified(ctx, "listCampaigns");
  await login(ctx);
  const group = await appGroup(ctx);
  const path = outPath || `${ctx.dir}/${campaignId}-preview.png`;

  return ctx.step(`capture the preview for ${campaignId}`, async p => {
    await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.compose), {
      waitUntil: "domcontentloaded",
    });
    // The composer renders the preview iframe a beat after the step itself.
    await braze.compose.preview(p).waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
    await p.waitForTimeout(4_000);

    const frame = braze.compose.preview(p);
    if (await frame.isVisible().catch(() => false)) {
      await frame.screenshot({ path });
      ctx.log(JSON.stringify({ flow: "captureCampaignPreview", campaignId, path, via: "preview-iframe" }));
      return { campaignId, path, via: "preview-iframe" };
    }
    // No iframe: a draft with no message built yet, or a moved selector. The
    // viewport is a poor thumbnail but it is also the evidence of which.
    await p.screenshot({ path });
    ctx.log(`no preview iframe for ${campaignId} — saved the page instead`, "warn");
    ctx.log(JSON.stringify({ flow: "captureCampaignPreview", campaignId, path, via: "viewport" }));
    return { campaignId, path, via: "viewport" };
  });
}
