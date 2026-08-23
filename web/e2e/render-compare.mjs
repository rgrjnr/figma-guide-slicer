// Renders the generated index.html at 600px and diffs it against the source
// artwork. If slicing and reassembly are correct these are the same picture.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { PNG } from "pngjs";

const zipPath = process.argv[2];
const srcPath = process.argv[3];
if (!zipPath || !srcPath) {
  console.error("usage: node e2e/render-compare.mjs <build.zip> <source-image>");
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "render-"));
const zip = await JSZip.loadAsync(readFileSync(zipPath));
mkdirSync(join(dir, "images"), { recursive: true });
for (const [name, file] of Object.entries(zip.files)) {
  if (file.dir) continue;
  writeFileSync(join(dir, name), await file.async("nodebuffer"));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 600, height: 800 } });
await page.goto("file://" + join(dir, "index.html"));
await page.waitForLoadState("networkidle");
const shot = join(dir, "rendered.png");
await page.locator("body > table").screenshot({ path: shot });
await browser.close();

const a = PNG.sync.read(readFileSync(shot));
const b = PNG.sync.read(readFileSync(srcPath));
console.log(`rendered ${a.width}x${a.height}   source ${b.width}x${b.height}`);

if (a.width !== b.width || a.height !== b.height) {
  console.log("FAIL  dimensions differ");
  process.exit(1);
}

// The slices are re-encoded as JPEG, so exact equality is not the bar; what
// matters is that nothing is shifted, dropped, or duplicated.
let diff = 0;
let worst = 0;
for (let i = 0; i < a.data.length; i += 4) {
  const d = (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i+1] - b.data[i+1]) + Math.abs(a.data[i+2] - b.data[i+2])) / 3;
  if (d > 12) diff++;
  if (d > worst) worst = d;
}
const pct = (diff / (a.width * a.height)) * 100;
console.log(`differing pixels: ${diff} (${pct.toFixed(3)}%)   worst channel delta: ${worst.toFixed(0)}`);
console.log(pct < 1 ? "PASS  reassembled render matches the source" : "FAIL  render diverges from the source");
console.log("artifacts in", dir);
process.exit(pct < 1 ? 0 : 1);
