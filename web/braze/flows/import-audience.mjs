import { braze, warnIfUnverified } from "../selectors.mjs";
import { paths } from "../urls.mjs";
import { login, appGroup } from "./login.mjs";

/**
 * Upload the audience CSV the app's Audience tab produces (`email,external_id`)
 * through the dashboard's user import.
 *
 * Braze names the resulting segment after the file, which is why the existing
 * campaigns target segments called `20260810.csv`: the file name is the segment
 * name. Copy the CSV to the name you want the segment to have before calling.
 */
export async function importAudience(ctx, { csvPath, createSegment = true, timeoutMs = 600_000 }) {
  if (!csvPath) throw new Error("importAudience needs the path to a CSV");
  const fileName = csvPath.split("/").pop();

  warnIfUnverified(ctx, "importAudience");
  await login(ctx);
  const group = await appGroup(ctx);

  await ctx.step("open Import Users", async p => {
    await p.goto(ctx.base + paths.userImport(group), { waitUntil: "domcontentloaded" });
    await braze.userImport.chooseAttributes(p).waitFor({ state: "visible", timeout: 45_000 });
  });

  await ctx.step("choose Attributes and upload the CSV", async p => {
    // Browse files stays disabled until an import type is picked.
    await braze.userImport.chooseAttributes(p).click();
    await p.waitForTimeout(1_500);
    await braze.userImport.csvInput(p).setInputFiles(csvPath);
    // The wizard opens on a preview of the first ten rows.
    await braze.userImport.next(p).waitFor({ state: "visible", timeout: 60_000 });
  });

  await ctx.step("confirm the column mapping", async p => {
    await braze.userImport.next(p).click();   // file preview -> review mapping
    await p.waitForTimeout(4_000);
    await braze.userImport.next(p).click();   // review mapping -> import settings
    await p.waitForTimeout(4_000);
  });

  await ctx.step("ask for a segment to be created", async p => {
    if (!createSegment) {
      ctx.log("skipping segment creation — the import will not be targetable");
    } else {
      // The default is "Don't create a targeting filter", which imports the
      // users but leaves nothing for a campaign to point at.
      await braze.userImport.createSegment(p).click();
      await p.waitForTimeout(1_500);
    }
    await braze.userImport.next(p).click();   // import settings -> summary
    await braze.userImport.start(p).waitFor({ state: "visible", timeout: 30_000 });
  });

  await ctx.step("start the import", async p => {
    await braze.userImport.start(p).click();
    await p.waitForTimeout(8_000);
  });

  // Braze processes imports asynchronously, so finishing the upload is not the
  // same as the users existing. The history table is the source of truth.
  return ctx.step("wait for the import to finish", async p => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = braze.userImport.rowFor(p, fileName);
      const text = (await row.innerText().catch(() => "")).replace(/\s+/g, " ");
      if (/complete/i.test(text)) {
        ctx.log(text.slice(0, 140));
        return { fileName, status: /partial/i.test(text) ? "partial" : "complete", row: text.slice(0, 200) };
      }
      if (/failed|error/i.test(text)) throw new Error(`Braze reported the import failed: ${text.slice(0, 200)}`);
      if (Date.now() > deadline) throw new Error(`Import of ${fileName} did not finish within ${Math.round(timeoutMs / 1000)}s`);
      await p.waitForTimeout(10_000);
      await p.reload({ waitUntil: "domcontentloaded" });
      await p.waitForTimeout(5_000);
    }
  });
}
