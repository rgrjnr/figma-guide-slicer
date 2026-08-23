import { braze, warnIfUnverified } from "../selectors.mjs";
import { paths, WIZARD } from "../urls.mjs";
import { resolveSendTime, inZone } from "../schedule.mjs";
import { config } from "../config.mjs";
import { login, appGroup } from "./login.mjs";

/**
 * Set a draft's delivery time and target segment, and save it — still a draft.
 *
 * Braze's schedule step has no time-zone control: a designated time is read in
 * the workspace's own zone. So `sendAt`/`timeZone` are resolved to an instant
 * and then converted into workspace-local wall clock before being typed in.
 * Passing the time through unconverted would schedule it hours out whenever the
 * two zones differ, which is most of the time.
 *
 * `localTimeDelivery` instead sends at that wall-clock time in each recipient's
 * own zone, and Braze handles the conversion itself.
 */
export async function scheduleCampaign(ctx, opts) {
  const {
    campaignId, sendAt, timeZone, segment,
    localTimeDelivery = false,
    removeControlGroup = true,
  } = opts;
  if (!campaignId) throw new Error("scheduleCampaign needs a campaignId");

  const when = resolveSendTime(sendAt, timeZone);
  const workspaceZone = config.workspaceTimeZone;
  const local = inZone(when, workspaceZone);
  const [localDate, localTime] = local.split(" ");

  ctx.log(`requested ${when.describe()}`);
  ctx.log(`workspace (${workspaceZone}) sees that as ${local} — that is what goes in the form`);
  if (when.skippedByDst) {
    ctx.log(`${sendAt} does not exist in ${timeZone}; the clocks jump over it.`, "warn");
  }

  warnIfUnverified(ctx, "scheduleCampaign");
  await login(ctx);
  const group = await appGroup(ctx);

  await ctx.step("open the delivery step", async p => {
    await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.schedule), { waitUntil: "domcontentloaded" });
    await braze.schedule.entryFrequency(p).waitFor({ state: "visible", timeout: 45_000 });
  });

  await ctx.step("set entry frequency to Once", async p => {
    await braze.schedule.entryFrequency(p).click();
    await p.getByRole("option", { name: /^Once$/i }).first().click();
    // Date and time only render once a frequency has been chosen.
    await braze.schedule.date(p).waitFor({ state: "visible", timeout: 20_000 });
  });

  await ctx.step(`set ${localDate} ${localTime} (${workspaceZone})`, async p => {
    await braze.schedule.date(p).fill(localDate.replace(/-/g, "/"));
    await p.keyboard.press("Escape");
    await braze.schedule.time(p).fill(to12Hour(localTime));
    await p.keyboard.press("Escape");

    if (localTimeDelivery) {
      await braze.schedule.localTimeZone(p).check().catch(() => {
        ctx.log("could not tick local-time delivery", "warn");
      });
    }
  });

  // Each wizard step has to be saved before leaving it. Navigating straight to
  // Target discards the schedule silently: the next Save Draft persists only
  // whatever step it was fired from.
  await ctx.step("save the schedule", async p => {
    await braze.saveDraft(p).click();
    await p.waitForTimeout(8_000);
  });

  if (segment) {
    await ctx.step(`target the "${segment}" segment`, async p => {
      await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.target), { waitUntil: "domcontentloaded" });
      const field = braze.target.segment(p);
      await field.waitFor({ state: "visible", timeout: 45_000 });
      // Typing rather than clicking: react-select's placeholder div sits over
      // its own input and swallows the click.
      await field.fill(segment);
      await p.waitForTimeout(3_000);
      await p.keyboard.press("Enter");
      await p.waitForTimeout(4_000);
    });
  }

  // Braze puts 20% of the audience in a control group by default — a fifth of
  // them are sent nothing. It sits off-screen unless you scroll, and the
  // reachable-user count does not account for it, so it goes unless asked for.
  const controlGroupRemoved = await ctx.step("remove the A/B control group", async p => {
    const link = braze.abTesting.removeControlGroup(p);
    if (!removeControlGroup) {
      ctx.log("leaving the control group in place, as asked", "warn");
      return false;
    }
    if (!(await link.isVisible({ timeout: 8_000 }).catch(() => false))) {
      ctx.log("no control group present");
      return false;
    }
    await link.click();
    await p.waitForTimeout(2_500);
    const split = await braze.abTesting.percentages(p).evaluateAll(els => els.map(e => e.value));
    if (split.length !== 1 || split[0] !== "100") {
      throw new Error(`Removing the control group left the split at ${split.join("/")}, not 100.`);
    }
    ctx.log("control group removed — the single variant is 100%");
    return true;
  });

  const reach = await ctx.step("read back the audience", async p => {
    return braze.target.audienceSummary(p).innerText().catch(() => "");
  });
  if (reach) ctx.log(reach.replace(/\s+/g, " ").slice(0, 120));

  await ctx.step("save the targeting", async p => {
    await braze.saveDraft(p).click();
    await p.waitForTimeout(8_000);
  });

  // Read the schedule back from a fresh load: filling a field is not the same
  // as Braze having kept it, and this is the assertion that caught it.
  const saved = await ctx.step("verify the schedule persisted", async p => {
    await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.schedule), { waitUntil: "domcontentloaded" });
    await braze.schedule.date(p).waitFor({ state: "visible", timeout: 45_000 });
    return {
      date: await braze.schedule.date(p).inputValue(),
      time: await braze.schedule.time(p).inputValue(),
    };
  });

  const wantDate = localDate.replace(/-/g, "/");
  const wantTime = to12Hour(localTime);
  if (saved.date !== wantDate || saved.time.toLowerCase() !== wantTime.toLowerCase()) {
    throw new Error(
      `Braze kept ${saved.date} ${saved.time}, not ${wantDate} ${wantTime}. The schedule did not save.`
    );
  }
  ctx.log(`Braze has it as ${saved.date} ${saved.time} ${workspaceZone}`);

  // The Review step states how many people would actually receive this. It is
  // the one figure worth carrying back: a mis-targeted segment is invisible in
  // every other signal.
  const reachableUsers = await ctx.step("read the reachable-user count", async p => {
    await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.review), { waitUntil: "domcontentloaded" });
    const banner = await braze.review.reachable(p).innerText({ timeout: 45_000 }).catch(() => "");
    const found = banner.replace(/,/g, "").match(/(\d+)/);
    return found ? Number(found[1]) : null;
  });
  if (reachableUsers !== null) ctx.log(`Reachable users: ${reachableUsers.toLocaleString()}`);

  ctx.log("still a draft — nothing has been sent. See braze/SENDING.md to launch it.");
  return {
    campaignId,
    reachableUsers,
    controlGroupRemoved,
    requested: when.iso,
    utc: when.utc,
    workspaceLocal: local,
    workspaceZone,
    localTimeDelivery,
    reviewUrl: ctx.base + paths.campaign(campaignId, group, WIZARD.review),
  };
}

/** Braze's time field wants "9:30 am", not "09:30". */
function to12Hour(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}
