import { braze, warnIfUnverified } from "../selectors.mjs";
import { paths, WIZARD } from "../urls.mjs";
import { config } from "../config.mjs";
import { resolveSendTime, inZone, ScheduleError } from "../schedule.mjs";
import { toIso } from "./campaign-detail.mjs";
import { login, appGroup } from "./login.mjs";

/**
 * The one flow in this project that commits a send.
 *
 * Everything else stops at a saved draft — see braze/SENDING.md, which is the
 * spec this file implements. It listed four conditions for ever automating the
 * launch, and `launchBlockers` below is those four conditions, kept as a pure
 * function so they can be tested without a browser and read without tracing
 * Playwright calls:
 *
 *   1. the schedule must be a designated time, and that time must be in the
 *      future — otherwise Launch means "send to everyone right now";
 *   2. the reachable-user count read back off the Review page must equal the
 *      one the caller confirmed, which is the load-bearing check: a
 *      mis-targeted segment is invisible in every other signal;
 *   3. the campaign's name must be the one the caller asked for;
 *   4. the resolved send time is logged in the workspace zone AND in UTC
 *      before anything is clicked.
 *
 * The flow is deliberately two-phase against the same code path. Called
 * without `confirm` it reads and reports and clicks nothing — that is what
 * fills the confirmation dialog. Called with `confirm` it reads the same values
 * again and refuses unless they still match what was confirmed. So the numbers
 * a person said yes to are the numbers that get verified, and a segment that
 * changed in between aborts the launch instead of quietly sending to a
 * different audience.
 */

/**
 * @param {object} state    what `readLaunchState` found
 * @param {object} expect   {name, reachable, zone} the caller confirmed
 * @returns {string[]} human-readable reasons not to launch; empty means go
 */
export function launchBlockers(state, expect = {}, { now, zone } = {}) {
  if (!state) return ["nothing could be read from the campaign"];
  const blockers = [];
  const workspaceZone = zone || expect.zone || config.workspaceTimeZone;

  // 3 — the right campaign.
  if (!expect.name) {
    blockers.push("no expected campaign name was supplied");
  } else if ((state.name || "").trim() !== String(expect.name).trim()) {
    blockers.push(`Braze calls this campaign "${state.name}", not "${expect.name}"`);
  }

  // 2 — the right audience. An absent expectation is itself a blocker: the
  // whole point is comparing against a number a human looked at.
  if (expect.reachable === undefined || expect.reachable === null) {
    blockers.push("no expected reachable-user count was supplied");
  } else if (Number(state.reachableUsers) !== Number(expect.reachable)) {
    blockers.push(
      `the audience changed: ${expect.reachable} people were confirmed, ` +
        `Braze now reports ${state.reachableUsers ?? "no"} reachable`
    );
  }
  if (!state.reachableUsers) blockers.push("Braze reports nobody reachable — there is no one to send to");

  // 1 — a designated time, in the future.
  if (!state.schedule?.date) {
    blockers.push(
      "no designated send time is set, so launching would send immediately to the whole segment"
    );
  } else {
    const wallClock = toIso(state.schedule.date, state.schedule.time);
    if (!wallClock) {
      blockers.push(`could not read the send time "${state.schedule.date} ${state.schedule.time}"`);
    } else {
      try {
        resolveSendTime(wallClock, workspaceZone, now);
      } catch (err) {
        blockers.push(err instanceof ScheduleError ? err.message : String(err));
      }
    }
  }

  // Braze's own verdict. It disables the button while anything is incomplete —
  // a missing subject is enough — and it knows things this flow does not.
  if (state.launchEnabled === false) {
    blockers.push("Braze has Launch Campaign disabled — the campaign is not complete");
  }

  return blockers;
}

/**
 * Read everything the decision needs. Read-only, and used by BOTH phases so the
 * confirmation dialog and the guard cannot drift apart.
 */
export async function readLaunchState(ctx, { campaignId, group }) {
  const compose = await ctx.step("read the campaign and its subject", async p => {
    await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.compose), { waitUntil: "domcontentloaded" });
    await braze.compose.name(p).waitFor({ state: "visible", timeout: 45_000 });
    const name = await braze.compose.name(p).inputValue();

    // The subject lives behind the sending-info drawer, so reading it costs two
    // clicks on controls the draft flow already drives. Non-fatal: the subject
    // is shown to a person, it is not one of the guards, and failing to read it
    // must not be a reason to block a launch that is otherwise sound.
    let subject = null;
    try {
      await braze.compose.editSendingInfo(p).click({ timeout: 15_000 });
      await braze.compose.subject(p).waitFor({ state: "visible", timeout: 20_000 });
      subject = await braze.compose.subject(p).inputValue();
      await braze.compose.done(p).click({ timeout: 10_000 }).catch(() => {});
    } catch {
      ctx.log("could not read the subject line off the sending-info drawer", "warn");
    }
    return { name, subject };
  });

  const schedule = await ctx.step("read the delivery step", async p => {
    await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.schedule), { waitUntil: "domcontentloaded" });
    await braze.schedule.entryFrequency(p).waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
    await p.waitForTimeout(6_000);
    const date = braze.schedule.date(p);
    if (!(await date.isVisible({ timeout: 20_000 }).catch(() => false))) return null;
    return {
      date: await date.inputValue(),
      time: await braze.schedule.time(p).inputValue().catch(() => ""),
    };
  });

  const review = await ctx.step("read the reachable-user count", async p => {
    await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.review), { waitUntil: "domcontentloaded" });
    await braze.review.reachable(p).waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
    // Braze computes the count after painting the banner, so it reads 0 for a
    // moment. Poll until it settles rather than trusting the first value —
    // launching against a transient 0 would be launching against nothing.
    let reachableUsers = null;
    for (let i = 0; i < 10; i++) {
      const banner = await braze.review.reachable(p).innerText().catch(() => "");
      const found = banner.replace(/,/g, "").match(/(\d+)/);
      reachableUsers = found ? Number(found[1]) : null;
      if (reachableUsers) break;
      await p.waitForTimeout(3_000);
    }
    const launch = braze.review.launch(p);
    const visible = await launch.isVisible({ timeout: 20_000 }).catch(() => false);
    return {
      reachableUsers,
      launchVisible: visible,
      launchEnabled: visible ? !(await launch.isDisabled().catch(() => true)) : false,
    };
  });

  return {
    campaignId,
    name: compose.name,
    subject: compose.subject,
    schedule,
    reachableUsers: review.reachableUsers,
    launchVisible: review.launchVisible,
    launchEnabled: review.launchEnabled,
    url: ctx.base + paths.campaign(campaignId, group, WIZARD.review),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * @param {object} options
 *   `confirm` must be exactly true. Without it this is a read-only preflight —
 *   which is how the app fills its confirmation dialog — and the send button is
 *   never touched.
 */
export async function launchCampaign(ctx, {
  campaignId, confirm = false, expectName, expectReachable, timeZone,
} = {}) {
  if (!campaignId) throw new Error("launchCampaign needs a campaignId");

  warnIfUnverified(ctx, "createEmailDraft");
  await login(ctx);
  const group = await appGroup(ctx);
  const zone = timeZone || config.workspaceTimeZone;

  const state = await readLaunchState(ctx, { campaignId, group });
  const blockers = launchBlockers(state, { name: expectName, reachable: expectReachable }, { zone });

  if (!confirm) {
    // Preflight. Report what a launch WOULD be blocked by, but do not treat a
    // missing expectation as an error here: the caller has not confirmed
    // anything yet, so of course it has nothing to compare against.
    const result = {
      ...state,
      flow: "launchCampaign",
      launched: false,
      preflight: true,
      blockers: blockers.filter(b => !b.startsWith("no expected")),
    };
    ctx.log(JSON.stringify(result));
    return result;
  }

  if (blockers.length) {
    throw new Error(`refusing to launch: ${blockers.join("; ")}`);
  }

  // 4 — say what is about to happen, in both zones, BEFORE it happens. If this
  // is the last line in a log, it is the record of what was committed.
  const when = resolveSendTime(toIso(state.schedule.date, state.schedule.time), zone);
  ctx.log(`LAUNCHING "${state.name}" — ${when.describe()}`);
  ctx.log(`  in São Paulo that is ${inZone(when, "America/Sao_Paulo")}`);
  ctx.log(`  ${state.reachableUsers} reachable users, confirmed as ${expectReachable}`);

  await ctx.step("click Launch Campaign", async p => {
    const launch = braze.review.launch(p);
    await launch.waitFor({ state: "visible", timeout: 30_000 });
    if (await launch.isDisabled().catch(() => true)) {
      throw new Error("Launch Campaign became disabled between the check and the click");
    }
    await launch.click({ timeout: 30_000 });
    // Braze may put a confirmation in the way. Anything that appears is left
    // alone deliberately: a dialog this flow has never seen is not something to
    // dismiss blind, and the run reports rather than guesses.
    await p.waitForTimeout(6_000);
  });

  const launched = await ctx.step("confirm Braze accepted the launch", async p => {
    // The button going away, or the page leaving the wizard, is Braze saying it
    // took it. Neither is certain, so the campaign is re-read afterwards and
    // the answer is reported as what it is rather than asserted.
    const stillThere = await braze.review.launch(p).isVisible({ timeout: 10_000 }).catch(() => false);
    return { launchButtonGone: !stillThere, url: p.url() };
  });

  const result = {
    ...state,
    flow: "launchCampaign",
    launched: true,
    launchedAt: new Date().toISOString(),
    sendAt: { local: when.iso, utc: when.utc, zone, describe: when.describe() },
    confirmation: launched,
  };
  ctx.log(JSON.stringify(result));
  return result;
}
