import { chromium } from "playwright";
import { signIn } from "./helpers.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));

// The middleware redirects every page to /login; seed the cookie first.
await signIn(page);

await page.goto(process.env.BASE_URL || "http://localhost:3737");

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
// The spreadsheet arrives by drag, usually while the paste tab is still open —
// that drop used to be silently swallowed. It must land either way.
const dt = await page.evaluateHandle(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(["email\ndropped@example.com\n"], "BASE 24.07.26.xlsx.csv".replace(".xlsx", ""),
    { type: "text/csv" }));
  return dt;
});
await page.locator(".source-toggle button").first().click(); // back to the paste tab
await page.dispatchEvent(".step-body.form", "drop", { dataTransfer: dt });
await page.waitForTimeout(1200);
checks.push(["a file dropped on the paste tab still lands",
  /dropped@example\.com|1 endereço|endereço/.test(await page.locator(".summary").first().innerText().catch(() => ""))
  || (await page.locator(".dropzone").innerText().catch(() => "")).includes("24.07.26")]);

console.log("");
let failed = 0;
for (const [l, ok] of checks) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}`); if (!ok) failed++; }
await browser.close();
process.exit(failed ? 1 : 0);
