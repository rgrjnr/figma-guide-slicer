/** Shared driving of the step UI, so a wording change lands in one place. */
export const FIXTURE = "../packages/slicer-core/test/fixtures/hbomax-moments-emkt.jpg";

export async function upload(page, fixture = FIXTURE) {
  // The app opens on Público; the design lands on the Arte step.
  await goToStep(page, "Arte");
  await page.setInputFiles('.step-body input[type="file"]', fixture);
  await page.waitForSelector(".surface img");
}

/** The single button that runs both detection passes. */
export async function autoDetect(page) {
  await page.getByRole("button", { name: /Detectar linhas automaticamente/i }).click();
  await page.waitForFunction(() => !document.querySelector("button.primary.big-btn[disabled]"), null, { timeout: 60_000 });
  await page.waitForTimeout(800);
}

export const step = (page, name) =>
  page.locator(".steps .step").filter({ hasText: new RegExp(name, "i") }).first();

export async function goToStep(page, name) {
  await step(page, name).click();
  await page.waitForTimeout(500);
}

export const guides = page => page.locator(".guide:not(.proposed)").count();
export const regions = page => page.locator(".region").count();

/**
 * Give a row a link the way a person does: click its circle on the artwork,
 * then type into the field that appears in the side panel.
 */
export async function setRowLink(page, index, url) {
  const row = page.locator(".region").nth(index);
  await row.hover();
  await row.locator(".row-actions .round.link").click();
  const field = page.locator(".link-row.focused input.url").first();
  await field.waitFor({ state: "visible" });
  await field.fill(url);
  await field.blur();
  await page.waitForTimeout(300);
}
