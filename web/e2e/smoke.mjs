// End-to-end check of the slicing pipeline against a real email render:
// upload -> detect sections -> detect social -> slice -> download ZIP,
// then assert the ZIP's shape and the generated HTML.
import { chromium } from "playwright";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { autoDetect, goToStep, setRowLink, upload } from "./helpers.mjs";

const URL_BASE = process.env.BASE_URL || "http://localhost:3737";
const FIXTURE = process.argv[2] || "../packages/slicer-core/test/fixtures/hbomax-moments-emkt.jpg";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => m.type() === "error" && errors.push(m.text()));

await page.goto(URL_BASE);
await upload(page, FIXTURE);
console.log("upload: ok —", await page.locator(".editor-bar .dim").first().innerText());

await autoDetect(page);
console.log("auto-detect:", await page.locator(".app-bar .status").innerText());
console.log("after detect:", await page.locator(".guide:not(.proposed)").count(), "splits,",
  await page.locator(".region").count(), "rows");

// The social row is the one that ended up with more than one field.
const socialCells = await page.evaluate(() =>
  Math.max(1, ...[...document.querySelectorAll(".link-row")].map(r => r.querySelectorAll(".link-field").length))
);
console.log("social row cells:", socialCells);

// Give the first row a link, to prove <a> wrapping survives to the HTML.
await setRowLink(page, 0, "example.com/hero");

await goToStep(page, "Enviar ao Braze");
await page.locator(".escape-hatch summary").click();
const dir = mkdtempSync(join(tmpdir(), "studio-"));
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 180_000 }),
  page.getByRole("button", { name: /Baixar o arquivo/i }).click(),
]);
const zipPath = join(dir, download.suggestedFilename());
await download.saveAs(zipPath);

console.log("  saved to:", zipPath);
const zip = await JSZip.loadAsync(readFileSync(zipPath));
const names = Object.keys(zip.files).filter(n => !zip.files[n].dir).sort();
const html = await zip.file("index.html").async("string");

console.log("\nZIP:", download.suggestedFilename());
console.log("  entries:", names.length);
console.log("  images:", names.filter(n => n.startsWith("images/")).length);
console.log("  first few:", names.slice(0, 4).join(", "));

const checks = [
  ["index.html at root", names.includes("index.html")],
  ["all other files under images/", names.every(n => n === "index.html" || n.startsWith("images/"))],
  ["no absolute image URLs", !/src="https?:\/\//.test(html)],
  ["every img src resolves in the zip",
    [...html.matchAll(/src="([^"]+)"/g)].every(m => names.includes(m[1]))],
  ["image count matches img tags",
    names.filter(n => n.startsWith("images/")).length === [...html.matchAll(/<img /g)].length],
  ["hero link wrapped in an anchor", html.includes('<a href="https://example.com/hero"')],
  ["footer merge tag present", html.includes("{{${email_footer}}}")],
  // A split row is an outer <td> carrying the row gradient, wrapping a nested
  // table whose single <tr> holds one <td> per cell.
  ["social row nests one <td> per cell", (() => {
    const nested = html.split("<tr>").filter(r => (r.match(/<td /g) || []).length > 1);
    return nested.length === 1 && (nested[0].match(/<td /g) || []).length === socialCells;
  })()],
  ["column widths sum to 600", (() => {
    const row = html.split("<tr>").find(r => (r.match(/<td /g) || []).length > 1);
    if (!row) return false;
    const w = [...row.matchAll(/<td[^>]*width="(\d+)"/g)].map(m => +m[1]);
    return w.reduce((a, b) => a + b, 0) === 600;
  })()],
  ["no page errors", errors.length === 0],
];

console.log("");
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
}
if (errors.length) console.log("\nconsole errors:\n  " + errors.join("\n  "));
if (failed && process.env.DUMP_HTML) {
  console.log("\n--- index.html ---\n" + html);
}
await browser.close();
process.exit(failed ? 1 : 0);
