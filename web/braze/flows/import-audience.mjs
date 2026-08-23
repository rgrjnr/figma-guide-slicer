import { braze, warnIfUnverified } from "../selectors.mjs";
import { login } from "./login.mjs";

/**
 * Upload the audience CSV produced by the app's Audience tab
 * (`email,external_id`) through the dashboard's user import.
 *
 * Braze processes imports asynchronously, so this waits for a terminal state
 * rather than assuming the upload finishing means the users exist.
 */
export async function importAudience(ctx, { csvPath, timeoutMs = 300_000 }) {
  if (!csvPath) throw new Error("importAudience needs the path to a CSV");

  warnIfUnverified(ctx, "importAudience");
  await login(ctx);

  await ctx.step("open the user import page", async p => {
    await braze.audience.nav(p).click();
    await p.waitForLoadState("networkidle");
  });

  await ctx.step("upload the CSV", async p => {
    await braze.audience.csvInput(p).setInputFiles(csvPath);
    await braze.audience.submit(p).click();
  });

  return ctx.step("wait for the import to finish", async p => {
    const done = braze.audience.complete(p);
    const failed = braze.audience.failed(p);
    const outcome = await Promise.race([
      done.waitFor({ state: "visible", timeout: timeoutMs }).then(() => "complete"),
      failed.waitFor({ state: "visible", timeout: timeoutMs }).then(() => "failed"),
    ]);
    if (outcome === "failed") {
      throw new Error(`Braze reported the import failed: ${await failed.innerText()}`);
    }
    return { status: "complete" };
  });
}
