import { braze, warnIfUnverified } from "../selectors.mjs";
import { paths, WIZARD } from "../urls.mjs";
import { login, appGroup } from "./login.mjs";

/**
 * Fill in the one thing the campaign index cannot tell us: when an e-mail
 * actually went out.
 *
 * The index has no send-date column — its "Sent" column is a COUNT of e-mails,
 * and the only date it carries is the stop date. The send time lives on the
 * campaign's own delivery step, which means one navigation per campaign. At
 * roughly ten seconds each that is minutes for a workspace this size, so it is
 * deliberately NOT part of the ordinary sync: the list refresh stays fast, and
 * this runs when there are dates missing.
 *
 * It is also written to be resumable and to do the least work possible, because
 * the ledger it is filling is the source of invoice lines:
 *
 * - A campaign that Braze has STOPPED is finished. Its send date can never
 *   change again, so it is read once and never re-read.
 * - A campaign still running can still change, so it stays eligible until it
 *   stops.
 *
 * That rule lives in the ledger (campaignsNeedingDetail, src/lib/server/
 * campaigns.ts) rather than here: it is a question about stored records, and
 * this file must stay importable by the CLI alone — it pulls in Playwright.
 *
 * Read-only: it opens the delivery step and reads two inputs. It never saves,
 * and it never touches the send button.
 */

/**
 * Read one campaign's delivery step. Returns null when the step has no date to
 * give — a campaign that has never been scheduled — which is an answer, not a
 * failure, and must not stop the batch.
 */
export async function readCampaignDates(ctx, { campaignId, group }) {
  if (!campaignId) throw new Error("readCampaignDates needs a campaignId");

  await ctx.page.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.schedule), {
    waitUntil: "domcontentloaded",
  });
  // The date and time inputs are rendered from the saved entry frequency, so
  // they appear a beat after the step itself does. Same wait the refresh flow
  // uses, against the same selectors, which are the verified ones.
  await braze.schedule.entryFrequency(ctx.page).waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
  await ctx.page.waitForTimeout(4_000);

  const date = braze.schedule.date(ctx.page);
  if (!(await date.isVisible({ timeout: 15_000 }).catch(() => false))) return null;

  const day = await date.inputValue().catch(() => "");
  const time = await braze.schedule.time(ctx.page).inputValue().catch(() => "");
  if (!day) return null;
  return { date: day, time, sentAt: toIso(day, time) };
}

/**
 * Braze prints the delivery date as `yyyy/mm/dd` and the time as `h:mm am`,
 * both in the workspace's own zone. They are combined here into a plain
 * `YYYY-MM-DDTHH:MM` — deliberately WITHOUT a Z, because stamping a workspace
 * wall-clock as UTC would move every send date by the offset and put a
 * late-evening send on the wrong day of an invoice.
 */
export function toIso(date, time) {
  const day = String(date || "").trim().replace(/\//g, "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  const parsed = String(time || "").trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!parsed) return `${day}T00:00`;

  let hour = Number(parsed[1]);
  const minute = parsed[2];
  const half = (parsed[3] || "").toLowerCase();
  if (half === "pm" && hour < 12) hour += 12;
  if (half === "am" && hour === 12) hour = 0;
  return `${day}T${String(hour).padStart(2, "0")}:${minute}`;
}

/**
 * Open each campaign in turn and read its dates.
 *
 * One campaign failing must never lose the ones already read: every result is
 * accumulated as it arrives and returned even if a later navigation throws, so
 * a run that dies halfway still advances the ledger and the next run picks up
 * where it stopped.
 */
export async function detailCampaigns(ctx, { ids = [], limit = 0 } = {}) {
  warnIfUnverified(ctx, "scheduleCampaign");
  await login(ctx);
  const group = await appGroup(ctx);

  const wanted = limit > 0 ? ids.slice(0, limit) : ids;
  if (!wanted.length) {
    ctx.log("no campaigns need their dates read");
    return { flow: "detailCampaigns", campaigns: [], checkedAt: new Date().toISOString() };
  }

  const campaigns = [];
  let failed = 0;

  for (const [index, id] of wanted.entries()) {
    // Not ctx.step per campaign: that would screenshot every one of them, and
    // eighty screenshots of the same step is a slow way to fill a disk.
    try {
      const dates = await readCampaignDates(ctx, { campaignId: id, group });
      if (dates) {
        campaigns.push({ id, sentAt: dates.sentAt, scheduleDate: dates.date, scheduleTime: dates.time });
      } else {
        campaigns.push({ id, sentAt: null });
      }
      ctx.log(`${index + 1}/${wanted.length} ${id} — ${dates?.sentAt ?? "no delivery date"}`);
    } catch (err) {
      failed++;
      ctx.log(`${index + 1}/${wanted.length} ${id} — failed: ${err.message}`, "warn");
    }
  }

  const result = {
    flow: "detailCampaigns",
    campaigns,
    read: campaigns.length,
    failed,
    checkedAt: new Date().toISOString(),
  };
  ctx.log(JSON.stringify(result));
  return result;
}
