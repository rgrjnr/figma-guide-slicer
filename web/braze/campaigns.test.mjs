/**
 * The campaign-list parser, against static fixtures modelled on the three
 * shapes the campaigns index could plausibly be: a real <table>, an ARIA grid,
 * and a virtualised list of <div>s with no table semantics at all. Nobody has
 * seen the real DOM yet, so the point of these is not that they prove the
 * selectors right — only a run against the live dashboard can do that. The
 * point is that the *parsing* is pinned: the id comes off the href, a header
 * row never becomes a campaign, and a status nobody has taught the flow about
 * survives as "unknown" carrying its original wording.
 *
 * That last one is the one that matters. PLAN-BILLING makes `stopped` the word
 * that turns a campaign billable, so a status guessed wrong is an invoice sent
 * wrong, and these tests exist to keep the guessing out.
 *
 * Offline and deterministic: a local HTTP server, no network, no Braze.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { readRows, parseRow, mapColumns, normalizeStatus, findFilterChip } from "./flows/list-campaigns.mjs";
import { braze } from "./selectors.mjs";
import { paths } from "./urls.mjs";
import { toIso } from "./flows/campaign-detail.mjs";

const GROUP = "5f9a1b2c3d4e5f6a7b8c9d0e";
const ID = n => `0123456789abcdef${String(n).padStart(8, "0")}`;
const href = n => `/engagement/campaigns/${ID(n)}/${GROUP}?locale=en`;

const row = (n, name, status, channel, created, sent) => `
  <tr>
    <td><a href="${href(n)}">${name}</a></td>
    <td>${status}</td>
    <td>${channel}</td>
    <td>${created}</td>
    <td>${sent}</td>
  </tr>`;

const FIXTURES = {
  /** A plain table with a <thead>, which is the likeliest shape. */
  table: `<table>
    <thead><tr><th>Name</th><th>Status</th><th>Channels</th><th>Created At</th><th>Last Sent</th></tr></thead>
    <tbody>
      ${row(1, "20260801", "Stopped", "Email", "2026-08-01 09:30", "2026-08-01 10:00")}
      ${row(2, "20260815", "Draft", "Email", "2026-08-15 11:00", "—")}
      ${row(3, "Always-on welcome", "Active", "Email, Push", "2026-01-02 08:00", "2026-08-24 06:00")}
      ${row(4, "Old promo", "Archived", "Email", "2025-11-01 12:00", "2025-11-02 12:00")}
      ${row(5, "Winback", "Scheduled", "Email", "2026-08-20 12:00", "—")}
    </tbody>
  </table>`,

  /**
   * An ARIA grid, header row included as a `role="row"` — the shape that would
   * invent a campaign called "Name" if the row locator did not insist on the
   * row containing a campaign link.
   */
  grid: `<div role="grid">
    <div role="row"><span role="columnheader">Name</span><span role="columnheader">Status</span>
      <span role="columnheader">Channel</span><span role="columnheader">Created</span></div>
    <div role="row"><span role="gridcell"><a href="${href(11)}">20260901</a></span>
      <span role="gridcell">Active</span><span role="gridcell">Email</span>
      <span role="gridcell">2026-09-01 07:00</span></div>
    <div role="row"><span role="gridcell"><a href="${href(12)}">20260902</a></span>
      <span role="gridcell">Stopped</span><span role="gridcell">Email</span>
      <span role="gridcell">2026-09-02 07:00</span></div>
  </div>`,

  /** A virtualised list: no table, no roles, no headers to map columns from. */
  virtual: `<div class="list">
    <div class="vrow"><a href="${href(21)}">20261001</a><span>Stopped</span><span>Email</span></div>
    <div class="vrow"><a href="${href(22)}">20261002</a><span>Draft</span><span>Email</span></div>
  </div>`,

  /**
   * The filter chip, modelled on the real one: a rounded pill reading
   * "Status: Active" with an × beside the label. Clicking that × is the only
   * way to clear the filter, and the filter is what hides every stopped —
   * i.e. every billable — campaign from the sync.
   */
  chip: `<div class="toolbar">
    <div class="db-chip"><span>Status: Active</span><button aria-label="Remove">×</button></div>
    <div class="db-chip"><span>Channel: Email</span><button aria-label="Remove">×</button></div>
  </div>
  <table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody></tbody></table>
  <script>
    // The × has to actually remove its chip, or the fixture would pass a
    // dismiss control that does nothing — which is the very failure the flow
    // checks for before it dares call the list unfiltered.
    document.querySelectorAll(".db-chip button").forEach(b =>
      b.addEventListener("click", () => b.closest(".db-chip").remove())
    );
  </script>`,

  /** The empty state. "Found nothing" has to be an answer, not an exception. */
  empty: `<table>
    <thead><tr><th>Name</th><th>Status</th></tr></thead>
    <tbody><tr><td colspan="2">No campaigns match your filters.</td></tr></tbody>
  </table>`,
};

const server = createServer((req, res) => {
  const key = req.url.slice(1).split("?")[0] || "empty";
  res.end(`<!doctype html><meta charset="utf-8">${FIXTURES[key] ?? FIXTURES.empty}`);
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
test.after(async () => {
  await browser.close();
  server.close();
});

test("reads a plain table: id off the href, name, status, channel, dates", async () => {
  await page.goto(`${base}/table`);
  const { strategy, rows, columns } = await readRows(page);

  assert.equal(strategy, "table-tbody-tr");
  assert.deepEqual(columns, { name: 0, status: 1, channel: 2, createdAt: 3, firstSentAt: 4 });
  assert.equal(rows.length, 5, "one record per body row, and none for the header");

  const first = rows[0];
  assert.equal(first.id, ID(1));
  assert.equal(first.name, "20260801");
  assert.equal(first.brazeStatus, "stopped");
  assert.equal(first.channel, "email");
  assert.equal(Date.parse(first.createdAt), Date.parse("2026-08-01 09:30"));
  assert.equal(Date.parse(first.firstSentAt), Date.parse("2026-08-01 10:00"));
  // The raw cells travel with the record, because the dashboard renders dates
  // in the viewer's locale and a wrong one has to be traceable.
  assert.equal(first.cells.createdAt, "2026-08-01 09:30");
});

test("the header row never becomes a campaign in an ARIA grid", async () => {
  await page.goto(`${base}/grid`);
  const { strategy, rows } = await readRows(page);

  assert.equal(strategy, "role-row-with-link");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.name), ["20260901", "20260902"]);
  assert.ok(!rows.some(r => r.name === "Name"), "the columnheader row must be filtered out");
});

test("a virtualised list with no headers still yields id, name and status", async () => {
  await page.goto(`${base}/virtual`);
  const { strategy, columns, rows } = await readRows(page);

  assert.equal(strategy, "link-ancestor");
  assert.deepEqual(columns, {}, "there are no headers to map");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, ID(21));
  assert.equal(rows[0].name, "20261001");
  // Without a column map the status is recovered by recognising the word.
  assert.equal(rows[0].brazeStatus, "stopped");
  assert.equal(rows[1].brazeStatus, "draft");
});

test("an empty list reads as no campaigns rather than throwing", async () => {
  await page.goto(`${base}/empty`);
  const { rows } = await readRows(page);
  assert.deepEqual(rows, [], "a row with no campaign link is not a campaign");
});

test("a status nobody has taught it about is passed through, not guessed", async () => {
  await page.goto(`${base}/table`);
  const { rows } = await readRows(page);
  const winback = rows.find(r => r.name === "Winback");

  assert.equal(winback.brazeStatus, "unknown", '"Scheduled" is not in the ledger vocabulary');
  assert.equal(winback.statusRaw, "Scheduled", "and the dashboard's own word is kept");
});

test("normalises only the statuses it actually knows", () => {
  for (const [raw, expected] of [
    ["Draft", "draft"],
    ["  ACTIVE ", "active"],
    ["Live", "active"],
    ["Stopped", "stopped"],
    ["Completed", "completed"],
    ["Archived", "archived"],
  ]) {
    assert.equal(normalizeStatus(raw).brazeStatus, expected, raw);
  }
});

test("near-misses are unknown, because near-misses are how a wrong invoice happens", () => {
  for (const raw of ["Scheduled", "Paused", "Sent", "In progress", "Stopped (copy)", "", "Rascunho"]) {
    const { brazeStatus, statusRaw } = normalizeStatus(raw);
    assert.equal(brazeStatus, "unknown", `${raw} must not be mapped by resemblance`);
    assert.equal(statusRaw, raw.trim());
  }
});

test("a row without a campaign link parses to nothing", () => {
  assert.equal(parseRow({ href: "", cells: ["Name", "Status"] }, { name: 0, status: 1 }), null);
  assert.equal(parseRow({ href: "/engagement/segments/abc/def", cells: ["x"] }, {}), null);
});

test("empty and placeholder dates are null rather than a bogus timestamp", () => {
  const record = parseRow(
    { href: href(9), cells: ["Campanha sem data", "Draft", "Email", "—", ""] },
    { name: 0, status: 1, channel: 2, createdAt: 3, firstSentAt: 4 }
  );
  assert.equal(record.createdAt, null);
  assert.equal(record.firstSentAt, null);
});

/**
 * The campaign table has no creation-date column at all — the closest it comes
 * is "Created by", which is a person. Our own campaigns carry the date in the
 * name, and that is the date the invoice line needs.
 */
test("a YYYYMMDD name supplies the creation date the table does not have", () => {
  const named = parseRow(
    { href: href(9), cells: ["20260101 OSCARS 2026", "Draft", "Email", "—", ""] },
    { name: 0, status: 1, channel: 2, createdAt: 3, firstSentAt: 4 }
  );
  assert.equal(named.createdAt, "2026-01-01T00:00:00.000Z");

  // Nothing is invented for a campaign that does not follow the convention.
  const other = parseRow(
    { href: href(8), cells: ["Always-on welcome", "Active", "Email", "—", ""] },
    { name: 0, status: 1, channel: 2, createdAt: 3, firstSentAt: 4 }
  );
  assert.equal(other.createdAt, null);
});

/**
 * The real header row, read off the dashboard. Three of its columns are traps:
 * "Created by" and "Last edited by" hold people, and "Sent" is a count that
 * reads 0 — and Date.parse("0") is the first of January 2000, which is how
 * every campaign in the workspace came to be stamped as sent that day.
 */
test("the real header row maps to dates, not to people or counts", () => {
  const headers = ["", "Name", "", "Status", "Stop date", "Campaign type", "Entry schedule",
    "Sent", "Teams", "Last edited by", "Last edited", "Created by", ""];
  const columns = mapColumns(headers);

  assert.equal(columns.name, 1);
  assert.equal(columns.status, 3);
  assert.equal(columns.stoppedAt, 4);
  assert.equal(columns.scheduledFor, 6);
  assert.equal(columns.sentCount, 7);
  assert.equal(columns.lastEditedAt, 10, '"Last edited", not "Last edited by"');
  assert.equal(columns.createdAt, undefined, "there is no creation-date column to map");

  const record = parseRow({
    href: href(9),
    cells: ["", "20260323 OSCARS 2026", "", "Stopped", "2026-03-24 10:00", "Email",
      "2026-03-23 09:30", "0", "", "Roger Junior", "2026-03-24 11:00", "Roger Junior", ""],
  }, columns);

  assert.equal(record.brazeStatus, "stopped");
  assert.equal(record.sentCount, 0);
  assert.equal(Date.parse(record.stoppedAt), Date.parse("2026-03-24 10:00"));
  // The stop date stands in for a send date: the table has no "sent on" column.
  assert.equal(Date.parse(record.firstSentAt), Date.parse("2026-03-24 10:00"));
  assert.equal(record.createdAt, "2026-03-23T00:00:00.000Z", "from the name");
  assert.ok(!Object.values(record).includes("Roger Junior"), "a person is never a date");
});

test("a date the parser cannot read survives as its own text", () => {
  // Braze renders in the viewer's locale; dropping an unparseable cell would
  // show on the ledger as "never sent", which reads as a fact.
  const record = parseRow({ href: href(9), cells: ["x", "Draft", "ontem às 9h"] }, { name: 0, status: 1, createdAt: 2 });
  assert.equal(record.createdAt, "ontem às 9h");
});

test("column mapping tolerates the labels being reworded or reordered", () => {
  assert.deepEqual(mapColumns(["Status", "Campaign Name", "Last Modified", "Start Date"]), {
    status: 0,
    name: 1,
    lastEditedAt: 2,
    scheduledFor: 3,
  });
  assert.deepEqual(mapColumns(["", "Something Else"]), {});
});

/**
 * The index keeps paging, sorting and filtering in the query string — this URL
 * is off the real dashboard:
 *
 *   ...?start=0&limit=96&globalFilter=&sortby=last_edited&sortdir=-1&display=list
 *
 * so the window can be asked for outright instead of hunting for a Next button.
 * `extra` is how the status filter's parameter gets carried once a live run has
 * shown us what it is called: without it, page two would quietly go back to the
 * dashboard's Active-only default while page one was unfiltered.
 */
test("the campaign index URL carries the whole view state", () => {
  const group = "60106fe73d519f17d1749fd6";
  const first = new URL(`https://x.test${paths.campaignList(group)}`);
  assert.equal(first.pathname, `/engagement/campaigns/campaigns/${group}`);
  assert.equal(first.searchParams.get("start"), "0");
  assert.equal(first.searchParams.get("limit"), "100");
  assert.equal(first.searchParams.get("sortby"), "last_edited");
  assert.equal(first.searchParams.get("display"), "list");
  assert.equal(first.searchParams.get("globalFilter"), "");

  const second = new URL(`https://x.test${paths.campaignList(group, { start: 200, limit: 200 })}`);
  assert.equal(second.searchParams.get("start"), "200");
  assert.equal(second.searchParams.get("limit"), "200");

  const filtered = new URL(`https://x.test${paths.campaignList(group, { extra: { archived: "true" } })}`);
  assert.equal(filtered.searchParams.get("archived"), "true");
});

/**
 * The chip is the whole ballgame. Braze's saved view filters the campaign
 * index to Status: Active, and everything this project bills for is stopped —
 * so a sync that cannot find and dismiss this chip reads the one set of
 * campaigns that can never be invoiced, and reports success while doing it.
 */
test("the Status filter chip is found by its own text, and its × is inside it", async () => {
  await page.goto(`${base}/chip`);

  const found = await findFilterChip(page);
  assert.ok(found, "the Status chip has to be findable");
  // The chip has to resolve to the whole pill — label AND ×, hence the ×
  // showing up in its text — because the dismiss is looked for inside it.
  assert.match(found.text, /^Status: Active\s*×$/);
  assert.equal(found.strategy, "status-chip-by-text");

  // The dismiss control must resolve INSIDE the chip: scoping it there is what
  // makes clicking an unlabelled × safe, since a chip holds nothing but its
  // label and its own button.
  const dismiss = braze.campaignList.chipDismiss(found.chip);
  assert.equal(await dismiss.count(), 1);
  assert.equal((await dismiss.getAttribute("aria-label")) ?? "", "Remove");

  await dismiss.click();
  const next = await findFilterChip(page);
  assert.ok(next, "the second chip is still there — one click clears one filter");
  assert.match(next.text, /Channel: Email/);

  await braze.campaignList.chipDismiss(next.chip).click();
  assert.equal(await findFilterChip(page), null, "with no chips left, nothing is filtered");
});

test("a page with no chips reports no filter rather than throwing", async () => {
  await page.goto(`${base}/table`);
  assert.equal(await findFilterChip(page), null);
});

/**
 * Braze prints the delivery date as yyyy/mm/dd and the time as "h:mm am", both
 * in the workspace's own zone. Appending a Z would move every send by the
 * offset and put a late-evening send on the wrong day of an invoice — which is
 * why toIso deliberately produces a zoneless stamp.
 */
test("the delivery date and time combine without inventing a timezone", () => {
  assert.equal(toIso("2026/03/23", "9:30 am"), "2026-03-23T09:30");
  assert.equal(toIso("2026/03/23", "12:05 am"), "2026-03-23T00:05");
  assert.equal(toIso("2026/03/23", "12:05 pm"), "2026-03-23T12:05");
  assert.equal(toIso("2026/03/23", "7:45 pm"), "2026-03-23T19:45");
  assert.equal(toIso("2026/03/23", "19:45"), "2026-03-23T19:45");
  assert.ok(!String(toIso("2026/03/23", "9:30 am")).endsWith("Z"), "never claims UTC");

  // A date with no readable time still dates the e-mail; junk does not.
  assert.equal(toIso("2026/03/23", ""), "2026-03-23T00:00");
  assert.equal(toIso("", "9:30 am"), null);
  assert.equal(toIso("tomorrow", "9:30 am"), null);
});
