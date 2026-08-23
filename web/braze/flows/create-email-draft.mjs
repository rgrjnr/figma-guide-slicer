import { braze, warnIfUnverified } from "../selectors.mjs";
import { login } from "./login.mjs";

/**
 * Create an email campaign from a built ZIP and stop at a saved draft.
 *
 * This flow deliberately does not send, schedule, or launch anything. Getting
 * to a draft is the automatable part; deciding it is good is not.
 */
export async function createEmailDraft(ctx, opts) {
  const { name, subject, preheader, fromAddress, replyTo, zipPath } = opts;
  if (!name) throw new Error("createEmailDraft needs a campaign name");
  if (!zipPath) throw new Error("createEmailDraft needs the path to a built ZIP");

  warnIfUnverified(ctx, "createEmailDraft");
  await login(ctx);

  await ctx.step("open Campaigns", async p => {
    await braze.campaigns.nav(p).click();
    await p.waitForLoadState("networkidle");
  });

  await ctx.step("start a new email campaign", async p => {
    await braze.campaigns.create(p).click();
    await braze.campaigns.chooseEmail(p).click();
  });

  await ctx.step(`name it "${name}"`, async p => {
    await braze.campaigns.nameField(p).fill(name);
  });

  await ctx.step("switch to the HTML editor", async p => {
    await braze.email.chooseHtmlEditor(p).click();
  });

  await ctx.step("upload the ZIP", async p => {
    // The visible control is usually a styled label over a hidden input;
    // setInputFiles drives the input directly, so the styling does not matter.
    await braze.email.zipInput(p).setInputFiles(zipPath);
    // Braze rewrites the image src attributes to its own CDN as it unpacks,
    // which takes a moment on a large build.
    await p.waitForLoadState("networkidle");
  });

  await ctx.step("fill the header fields", async p => {
    const fields = [
      [braze.email.subject, subject],
      [braze.email.preheader, preheader],
      [braze.email.fromAddress, fromAddress],
      [braze.email.replyTo, replyTo],
    ];
    for (const [locator, value] of fields) {
      if (!value) continue;
      const field = locator(p);
      if (await field.isVisible().catch(() => false)) await field.fill(value);
      else ctx.log(`could not find a field for "${value}" — skipped`, "warn");
    }
  });

  await ctx.step("save as draft", async p => {
    await braze.email.saveDraft(p).click();
    await braze.email.savedConfirmation(p).waitFor({ state: "visible", timeout: 30_000 });
  });

  ctx.log(`draft "${name}" saved — open it in Braze and check it before scheduling`);
  return { name, url: ctx.page.url() };
}
