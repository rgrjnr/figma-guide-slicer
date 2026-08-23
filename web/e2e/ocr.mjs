// OCR was never verified inside the Figma iframe (CSP around the blob worker).
// This proves it works in a real page.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));

await page.goto(process.env.BASE_URL || "http://localhost:3737");
await page.setInputFiles('input[type="file"]', "../packages/slicer-core/test/fixtures/hbomax-moments-emkt.jpg");
await page.waitForSelector(".surface img");
await page.getByRole("button", { name: "Find sections" }).click();
await page.waitForSelector(".guide.proposed");
await page.getByRole("button", { name: "accept all" }).click();
await page.getByRole("button", { name: /^Slice \d+ rows?$/ }).click();
await page.waitForSelector('button:has-text("Read text (OCR)")');

await page.getByRole("button", { name: "Read text (OCR)" }).click();
await page.waitForFunction(
  () => /Read text from|OCR failed/.test(document.querySelector(".app-bar .status, .app-bar .busy")?.textContent || ""),
  null,
  { timeout: 240_000 }
);

const status = await page.locator(".app-bar .status").innerText();
console.log("status:", status);
const alts = (await page.locator("input.alt").evaluateAll(els => els.map(e => e.value))).filter(Boolean);
console.log("alt text filled on", alts.length, "rows:");
for (const a of alts) console.log("   ·", a);

const ok = /Read text from [1-9]/.test(status) && alts.length > 0 && errors.length === 0;
console.log("");
console.log(ok ? "PASS  OCR ran and produced alt text" : "FAIL  OCR did not produce usable output");
if (errors.length) console.log("errors:", errors.join("; "));
await browser.close();
process.exit(ok ? 0 : 1);
