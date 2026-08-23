import { braze, warnIfUnverified } from "../selectors.mjs";
import { paths, WIZARD } from "../urls.mjs";
import { login, appGroup } from "./login.mjs";

/**
 * Swap a campaign's artwork without creating a new campaign.
 *
 * A design usually changes after the campaign already exists — the audience is
 * imported, the schedule is set, people have the link. Braze bakes the uploaded
 * HTML into a variant, so the message is replaced by adding a fresh variant
 * built from the new ZIP and removing the old one, rather than editing in place.
 *
 * The new variant is built first and the old one removed only once the new one
 * is composed and saved, so a failure halfway leaves the campaign with its
 * original message intact rather than with none at all.
 */
export async function replaceMessage(ctx, opts) {
  const { campaignId, zipPath, subject, preheader, variantName } = opts;
  if (!campaignId) throw new Error("replaceMessage needs a campaignId");
  if (!zipPath) throw new Error("replaceMessage needs the path to a built ZIP");

  warnIfUnverified(ctx, "createEmailDraft");
  await login(ctx);
  const group = await appGroup(ctx);

  const before = await ctx.step("open the campaign", async p => {
    await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.compose), { waitUntil: "domcontentloaded" });
    await braze.compose.addVariant(p).waitFor({ state: "visible", timeout: 45_000 });
    return braze.compose.variants(p).allInnerTexts();
  });
  const existing = before.map(t => t.trim().split("\n")[0]).filter(Boolean);
  ctx.log(`existing variants: ${existing.join(", ") || "(none)"}`);

  await ctx.step("add a blank variant", async p => {
    await braze.compose.addVariant(p).click();
    await braze.compose.composeBlank(p).click();
    await p.waitForTimeout(4_000);
    const now = await braze.compose.variants(p).count();
    if (now <= existing.length) throw new Error("The new variant was not added.");
  });

  // The new variant is selected on creation, so the upload lands in it.
  await ctx.step("upload the new ZIP", async p => {
    await braze.compose.zipInput(p).setInputFiles(zipPath);
    await braze.compose.buildMessage(p).waitFor({ state: "visible", timeout: 180_000 });
    await braze.compose.buildMessage(p).click();
    await braze.compose.done(p).waitFor({ state: "visible", timeout: 120_000 });
    await braze.compose.done(p).click();
    await braze.compose.editSendingInfo(p).waitFor({ state: "visible", timeout: 60_000 });
  });

  // Sending info belongs to the variant, so the new one needs its own subject.
  await ctx.step("set subject and preheader on the new variant", async p => {
    await braze.compose.editSendingInfo(p).click();
    const field = braze.compose.subject(p);
    await field.waitFor({ state: "visible", timeout: 30_000 });
    await field.fill(subject || `Updated ${new Date().toISOString().slice(0, 10)}`);
    if (preheader) await braze.compose.preheader(p).fill(preheader);
    await braze.compose.done(p).click();
    await p.waitForTimeout(3_000);
  });

  await ctx.step("save the new variant before removing the old one", async p => {
    await braze.saveDraft(p).click();
    await p.waitForTimeout(8_000);
  });

  for (const name of existing) {
    await ctx.step(`remove "${name}"`, async p => {
      const row = braze.compose.variantNamed(p, name);
      if (!(await row.isVisible({ timeout: 8_000 }).catch(() => false))) {
        ctx.log(`"${name}" is already gone`);
        return;
      }
      // The rename and remove controls only render on hover, so the row has to
      // be pointed at before its remove button can be clicked.
      await row.hover();
      await p.waitForTimeout(800);
      // Scoped to this row: the remove control exists once per variant.
      await braze.compose.removeVariantIn(row).click();
      await p.waitForTimeout(2_500);
      // Braze may ask to confirm.
      const confirm = p.getByRole("button", { name: /^(Remove|Delete|Confirm)$/i }).first();
      if (await confirm.isVisible({ timeout: 3_000 }).catch(() => false)) await confirm.click();
      await p.waitForTimeout(3_000);
    });
  }

  // Braze calls a blank variant "Unnamed Variant N", which says nothing about
  // which artwork it holds. Name it after the build instead.
  const label = variantName || `Updated ${new Date().toISOString().slice(0, 10)}`;
  await ctx.step(`rename the variant to "${label}"`, async p => {
    const row = braze.compose.variants(p).first();
    await row.hover();
    await p.waitForTimeout(800);
    await braze.compose.renameVariantIn(row).click();
    const field = braze.compose.variantNameInput(p);
    await field.waitFor({ state: "visible", timeout: 10_000 });
    await field.click();
    // Select-all is Meta+a on macOS; Control+a leaves the old name in place and
    // the new one gets prepended to it.
    await field.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
    await field.pressSequentially(label, { delay: 20 });
    // Neither Enter nor blur commits this popover — only its Save button does.
    await braze.compose.renameSave(p).click();
    await p.waitForTimeout(2_500);
  });

  await ctx.step("save", async p => {
    await braze.saveDraft(p).click();
    await p.waitForTimeout(8_000);
  });

  const after = await ctx.step("verify one variant is left", async p => {
    await p.goto(ctx.base + paths.campaign(campaignId, group, WIZARD.compose), { waitUntil: "domcontentloaded" });
    await braze.compose.addVariant(p).waitFor({ state: "visible", timeout: 45_000 });
    return (await braze.compose.variants(p).allInnerTexts()).map(t => t.trim().split("\n")[0]).filter(Boolean);
  });

  if (after.length !== 1) {
    throw new Error(`Expected one variant after the swap, found ${after.length}: ${after.join(", ")}`);
  }
  if (existing.includes(after[0])) {
    throw new Error(`The old variant "${after[0]}" is still the one in place — the swap did not take.`);
  }
  if (after[0] !== label) {
    ctx.log(`variant is named "${after[0]}", not "${label}" — the rename did not stick`, "warn");
  }

  ctx.log(`message replaced; the campaign now has a single variant "${after[0]}"`);
  return { campaignId, removed: existing, variant: after[0] };
}
