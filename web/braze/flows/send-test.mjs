import { braze, warnIfUnverified } from "../selectors.mjs";
import { paths, WIZARD } from "../urls.mjs";
import { login, appGroup } from "./login.mjs";

/**
 * Send a proof to specific addresses.
 *
 * This is the one flow that puts mail in someone's inbox, so it is opt-in:
 * `confirm: true` has to be passed, and without it everything is set up and the
 * Send Test button is left unclicked. That keeps the "look at it before it goes
 * out" step a deliberate act rather than a side effect of running a pipeline.
 *
 * A subject is required — Braze will not send a test without one, and the
 * campaign is flagged until it has one.
 */
export async function sendTest(ctx, { campaignId, recipients, confirm = false }) {
  if (!campaignId) throw new Error("sendTest needs a campaignId");

  // The box accepts several addresses; a pasted block separated by line breaks
  // is the usual way in, so both that and an array are accepted here.
  const addresses = (Array.isArray(recipients) ? recipients : String(recipients || "").split(/[\n,;]+/))
    .map(a => a.trim())
    .filter(Boolean);
  if (addresses.length === 0) throw new Error("sendTest needs at least one recipient address");

  warnIfUnverified(ctx, "createEmailDraft");
  await login(ctx);
  const group = await appGroup(ctx);

  await ctx.step("open Preview and test", async p => {
    await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.compose), { waitUntil: "domcontentloaded" });
    await braze.testSend.openPreview(p).waitFor({ state: "visible", timeout: 45_000 });
    await braze.testSend.openPreview(p).click();
    await braze.testSend.tab(p).waitFor({ state: "visible", timeout: 30_000 });
    await braze.testSend.tab(p).click();
    await braze.testSend.recipients(p).waitFor({ state: "visible", timeout: 20_000 });
  });

  await ctx.step(`add ${addresses.length} recipient(s)`, async p => {
    const field = braze.testSend.recipients(p);
    for (const address of addresses) {
      await field.fill(address);
      // Each address is committed as its own entry before the next is typed.
      await p.keyboard.press("Enter");
      await p.waitForTimeout(600);
    }
  });

  const ready = await ctx.step("check Braze will accept the test", async p => {
    // Send Test stays disabled until there is a recipient and a subject.
    const enabled = await braze.testSend.send(p).isEnabled().catch(() => false);
    if (!enabled) {
      throw new Error(
        "Send Test is disabled. Braze needs at least one recipient and a subject line on the variant."
      );
    }
    return true;
  });

  if (!confirm) {
    ctx.log(`ready to send to ${addresses.join(", ")} — not sending, because confirm was not set`, "warn");
    return { campaignId, recipients: addresses, sent: false, ready };
  }

  await ctx.step(`send the test to ${addresses.join(", ")}`, async p => {
    await braze.testSend.send(p).click();
    await p.waitForTimeout(6_000);
  });

  ctx.log(`test sent to ${addresses.join(", ")}`);
  return { campaignId, recipients: addresses, sent: true };
}
