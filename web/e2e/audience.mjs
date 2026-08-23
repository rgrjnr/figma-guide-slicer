import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));

await page.goto(process.env.BASE_URL || "http://localhost:3737");
await page.setInputFiles('input[type="file"]', "../packages/slicer-core/test/fixtures/hbomax-moments-emkt.jpg");
await page.waitForSelector(".surface img");
await page.getByRole("button", { name: /^Audience/ }).click();

await page.locator(".audience textarea").fill(
  "Ana@Example.com, bruno@example.com; ana@example.com\n<carla@example.com>\nnot-an-email\ndaniel@example.co.uk"
);
await page.waitForTimeout(150);

const hint = await page.locator(".audience .hint").first().innerText();
console.log("summary:", hint.replace(/\s+/g, " "));

const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: /^Download CSV/ }).click(),
]);
const stream = await download.createReadStream();
let csv = "";
for await (const chunk of stream) csv += chunk;
console.log("csv:\n" + csv.split("\n").map(l => "   " + l).join("\n"));

const lines = csv.split("\n");
const checks = [
  ["header is email,external_id", lines[0] === "email,external_id"],
  ["4 unique addresses kept", lines.length === 5],
  ["lowercased", csv.includes("ana@example.com,ana@example.com")],
  ["duplicate dropped", (csv.match(/ana@example\.com/g) || []).length === 2],
  ["angle brackets stripped", csv.includes("carla@example.com")],
  ["invalid rejected", !csv.includes("not-an-email")],
  ["counted 1 duplicate and 1 invalid", /1 duplicate/.test(hint) && /1 invalid/.test(hint)],
  ["no page errors", errors.length === 0],
];
console.log("");
let failed = 0;
for (const [l, ok] of checks) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}`); if (!ok) failed++; }
await browser.close();
process.exit(failed ? 1 : 0);
