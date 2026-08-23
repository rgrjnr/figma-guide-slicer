import { braze, warnIfUnverified } from "../selectors.mjs";
import { paths, WIZARD } from "../urls.mjs";
import { login, appGroup } from "./login.mjs";

/**
 * Re-read a campaign's live state from Braze.
 *
 * The local JSON store records what we told Braze; this reads back what Braze
 * actually has. They drift — someone edits the campaign in the dashboard, an
 * import finishes, a schedule is changed — and a stored value that is quietly
 * stale is worse than no value at all.
 *
 * Read-only: it opens pages and reports, and changes nothing.
 */
export async function refreshCampaign(ctx, { campaignId }) {
  if (!campaignId) throw new Error("refreshCampaign needs a campaignId");

  warnIfUnverified(ctx, "createEmailDraft");
  await login(ctx);
  const group = await appGroup(ctx);

  const compose = await ctx.step("read the compose step", async p => {
    await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.compose), { waitUntil: "domcontentloaded" });
    await braze.compose.name(p).waitFor({ state: "visible", timeout: 45_000 });
    return {
      name: await braze.compose.name(p).inputValue(),
      variants: (await braze.compose.variants(p).allInnerTexts()).map(t => t.trim().split("\n")[0]).filter(Boolean),
    };
  });

  const schedule = await ctx.step("read the delivery step", async p => {
    await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.schedule), { waitUntil: "domcontentloaded" });
    // The date and time inputs are rendered from the saved entry frequency, so
    // they appear a beat after the step itself does.
    await braze.schedule.entryFrequency(p).waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
    await p.waitForTimeout(6_000);
    const date = braze.schedule.date(p);
    if (!(await date.isVisible({ timeout: 20_000 }).catch(() => false))) return null;
    return {
      date: await date.inputValue(),
      time: await braze.schedule.time(p).inputValue().catch(() => ""),
    };
  });

  const target = await ctx.step("read the target step", async p => {
    await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.target), { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(6_000);
    const split = await braze.abTesting.percentages(p).evaluateAll(els => els.map(e => e.value)).catch(() => []);
    return {
      // More than one percentage means a control group is still in place.
      variantSplit: split,
      controlGroupPresent: split.length > 1,
      audience: (await braze.target.audienceSummary(p).innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 120),
    };
  });

  const reachableUsers = await ctx.step("read the reachable-user count", async p => {
    await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.review), { waitUntil: "domcontentloaded" });
    await braze.review.reachable(p).waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
    // Braze computes the count after painting the banner, so it reads 0 for a
    // moment. Poll until it settles rather than trusting the first value.
    let value = null;
    for (let i = 0; i < 10; i++) {
      const banner = await braze.review.reachable(p).innerText().catch(() => "");
      const found = banner.replace(/,/g, "").match(/(\d+)/);
      value = found ? Number(found[1]) : null;
      if (value) break;
      await p.waitForTimeout(3_000);
    }
    return value;
  });

  const state = {
    campaignId,
    name: compose.name,
    variants: compose.variants,
    schedule,
    controlGroupPresent: target.controlGroupPresent,
    variantSplit: target.variantSplit,
    reachableUsers,
    url: ctx.base + paths.campaign(campaignId, group, WIZARD.compose),
    checkedAt: new Date().toISOString(),
  };
  ctx.log(JSON.stringify(state));
  return state;
}
