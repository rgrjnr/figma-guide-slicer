// Markup must survive a save and a reopen, because that is the whole point of
// the store: a design gets revised days after the campaign was created.
import { chromium } from "playwright";
import { goToStep, upload } from "./helpers.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.goto(process.env.BASE_URL || "http://localhost:3737");
await upload(page);

const results = [];
const check = (l, ok, d = "") => results.push([l, ok, d]);

await page.locator(".campaign-name").fill("TEST-project-20260823");
await page.getByRole("button", { name: /Detectar linhas automaticamente/i }).click();
await page.waitForTimeout(4000);
await page.waitForTimeout(500);
const guides = await page.locator(".guide:not(.proposed)").count();
const regions = await page.locator(".region").count();

await page.locator(".project-bar").getByRole("button", { name: /^Salvar/ }).click();
await page.waitForTimeout(1500);
check("save reports success", /Salvo/.test(await page.locator(".app-bar .status").innerText()));

// Reload the page entirely: this must come from the server, not from memory.
await page.reload();
await page.waitForTimeout(1500);
await page.locator(".project-bar").getByRole("button", { name: "Abrir", exact: true }).click();
await page.waitForTimeout(800);
const listed = await page.locator(".project-row").count();
check("the saved project is listed", listed >= 1, `${listed} rows`);

await page.locator(".project-row .link-btn").first().click();
await page.waitForTimeout(1500);
const status = await page.locator(".app-bar .status").innerText();
check("opening says the design has to be added again", /novamente/i.test(status), status);

// Re-upload and confirm the guides came back from the store.
await upload(page);
await page.locator(".project-bar").getByRole("button", { name: "Abrir", exact: true }).click();
await page.waitForTimeout(600);
await page.locator(".project-row .link-btn").first().click();
await page.waitForTimeout(1500);
// Reopening lands on Público; the guides are only rendered on the Arte canvas.
await goToStep(page, "Arte");
const guidesAfter = await page.locator(".guide:not(.proposed)").count();
const regionsAfter = await page.locator(".region").count();
check("guides survived the round trip", guidesAfter === guides, `${guides} -> ${guidesAfter}`);
check("rows survived the round trip", regionsAfter === regions, `${regions} -> ${regionsAfter}`);
check("no page errors", errors.length === 0, errors.join("; "));

console.log("");
let failed = 0;
for (const [l, ok, d] of results) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${ok || !d ? "" : `  (${d})`}`); if (!ok) failed++; }
await browser.close();
process.exit(failed ? 1 : 0);
