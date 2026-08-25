// OCR no longer has a button: alt text is filled in while the email is built,
// because it is required for accessibility and there is nothing for a person to
// decide about it. What matters now is that it still happens, and lands in the
// HTML — so this drives the build and reads the alt attributes back out.
import { chromium } from "playwright";
import JSZip from "jszip";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoDetect, goToStep, upload } from "./helpers.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));

await page.goto(process.env.BASE_URL || "http://localhost:3737");
await upload(page);
await autoDetect(page);


const dir = mkdtempSync(join(tmpdir(), "ocr-"));
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 300_000 }),
  page.evaluate(() => window.__downloadZip()),
]);
const path = join(dir, download.suggestedFilename());
await download.saveAs(path);

const zip = await JSZip.loadAsync(readFileSync(path));
const html = await zip.file("index.html").async("string");
const alts = [...html.matchAll(/alt="([^"]*)"/g)].map(m => m[1]).filter(Boolean);

console.log(`alt text on ${alts.length} of ${[...html.matchAll(/<img /g)].length} images:`);
for (const a of alts.slice(0, 6)) console.log("   ·", a);

// The preview line should have been taken from the artwork too.
await goToStep(page, "Detalhes");
const preheader = await page.getByPlaceholder(/texto da arte/i).inputValue();
console.log("preview text:", preheader || "(empty)");

const checks = [
  ["alt text was filled in without anyone asking", alts.length >= 3, `${alts.length} filled`],
  ["it reads the Portuguese copy", alts.some(a => /[çãõáéí]/i.test(a)), alts.join(" | ").slice(0, 80)],
  ["the preview line came from the artwork", preheader.length > 10, preheader],
  ["no page errors", errors.length === 0, errors.join("; ")],
];
console.log("");
let failed = 0;
for (const [l, ok, d] of checks) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${ok || !d ? "" : `  (${d})`}`); if (!ok) failed++; }
await browser.close();
process.exit(failed ? 1 : 0);
