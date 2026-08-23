import { braze, warnIfUnverified } from "../selectors.mjs";
import { paths, WIZARD, campaignIdFromUrl } from "../urls.mjs";
import { login, appGroup } from "./login.mjs";

/**
 * Create an email campaign from a built ZIP and stop at a saved draft.
 *
 * The compose step has to run in one continuous page session: an uploaded
 * message that has not been saved is discarded on reload, so there is no
 * resuming halfway through. Everything up to the first Save Draft is therefore
 * one unbroken sequence.
 *
 * This never sends. Getting to a reviewable draft is the automatable part;
 * deciding it is good is not.
 */
export async function createEmailDraft(ctx, opts) {
  const { name, subject, preheader, zipPath } = opts;
  if (!name) throw new Error("createEmailDraft needs a campaign name");
  if (!zipPath) throw new Error("createEmailDraft needs the path to a built ZIP");

  warnIfUnverified(ctx, "createEmailDraft");
  await login(ctx);
  const group = await appGroup(ctx);

  await ctx.step("open Campaigns", async p => {
    await p.goto(ctx.base + paths.campaigns(group), { waitUntil: "domcontentloaded" });
    await braze.campaigns.create(p).waitFor({ state: "visible", timeout: 45_000 });
  });

  // Choosing the channel creates the campaign immediately, so the id only
  // exists from here on.
  const campaignId = await ctx.step("start an email campaign", async p => {
    await braze.campaigns.create(p).click();
    await braze.campaigns.chooseEmail(p).click();
    await braze.compose.name(p).waitFor({ state: "visible", timeout: 45_000 });
    const id = campaignIdFromUrl(p.url());
    if (!id) throw new Error(`No campaign id in ${p.url()}`);
    return id;
  });
  ctx.log(`campaign ${campaignId}`);

  await ctx.step(`name it "${name}"`, async p => {
    await braze.compose.name(p).fill(name);
  });

  await ctx.step("upload the ZIP", async p => {
    await braze.compose.zipInput(p).setInputFiles(zipPath);
    // Braze unpacks the archive and rewrites the image srcs to its own CDN,
    // which takes a while on a build with large slices. The dialog's action
    // button appearing is the signal that it has finished.
    await braze.compose.buildMessage(p).waitFor({ state: "visible", timeout: 180_000 });
  });

  await ctx.step("build the message", async p => {
    await braze.compose.buildMessage(p).click();
    await braze.compose.done(p).waitFor({ state: "visible", timeout: 120_000 });
    await braze.compose.done(p).click();
    await braze.compose.editSendingInfo(p).waitFor({ state: "visible", timeout: 60_000 });
  });

  await ctx.step("fill subject and preheader", async p => {
    await braze.compose.editSendingInfo(p).click();
    const field = braze.compose.subject(p);
    await field.waitFor({ state: "visible", timeout: 30_000 });
    // A campaign with no subject cannot be launched; Braze flags it as an issue.
    await field.fill(subject || name);
    if (preheader) await braze.compose.preheader(p).fill(preheader);
    await braze.compose.done(p).click();
    await p.waitForTimeout(3_000);
  });

  await ctx.step("save as draft", async p => {
    await braze.saveDraft(p).click();
    await p.waitForTimeout(8_000);
  });

  const url = ctx.base + paths.campaign(campaignId, group, WIZARD.compose);
  ctx.log(`draft "${name}" saved — open it and check it before scheduling: ${url}`);
  return { campaignId, name, url };
}
