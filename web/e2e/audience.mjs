import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));

await page.goto(process.env.BASE_URL || "http://localhost:3737");
await page.setInputFiles('input[type="file"]', "../packages/slicer-core/test/fixtures/hbomax-moments-emkt.jpg");
await page.waitForSelector(".surface img");
await page.locator(".steps .step").filter({ hasText: /Público/i }).first().click();
await page.waitForTimeout(400);

await page.locator(".field textarea").first().fill(
  "Ana@Example.com, bruno@example.com; ana@example.com\n<carla@example.com>\nnot-an-email\ndaniel@example.co.uk"
);
await page.waitForTimeout(150);

const hint = await page.locator(".summary").first().innerText();
console.log("summary:", hint.replace(/\s+/g, " "));

// Nothing is downloaded any more — the CSV goes straight to the import flow —
// so what is checked here is the summary the user actually sees. The CSV shape
// itself is covered by the unit tests in packages/slicer-core.
const checks = [
  ["4 unique addresses counted", /\b4\b/.test(hint)],
  ["the duplicate is reported", /1 repetido/i.test(hint)],
  ["the invalid one is reported", /1 ignorado/i.test(hint)],
  ["the invalid address is named", /not-an-email/.test(await page.locator(".hint.mono").first().innerText().catch(() => ""))],
  ["the audience name defaults to the date", /^\d{8}$/.test(
    await page.locator(".field input").last().inputValue())],
  ["no page errors", errors.length === 0],
];
console.log("");
let failed = 0;
for (const [l, ok] of checks) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}`); if (!ok) failed++; }
await browser.close();
process.exit(failed ? 1 : 0);
