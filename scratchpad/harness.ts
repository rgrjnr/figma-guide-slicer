// Ad-hoc detector runner: point it at a rendered email and see what the
// algorithms propose. Same job as the old harness.js, but it imports
// @slicer/core instead of string-slicing the detection block out of ui.html.
//
// Usage: npx vite-node scratchpad/harness.ts <image.jpg|png> [minGutter] [minSection]
import { readFileSync } from "node:fs";
import { decode } from "jpeg-js";
import { PNG } from "pngjs";
import { detectSectionOffsets, detectSocialBand, type RasterImage } from "../packages/slicer-core/src/index";

const file = process.argv[2];
if (!file) {
  console.error("usage: npx vite-node scratchpad/harness.ts <image> [minGutter] [minSection]");
  process.exit(1);
}
const minGutter = Number(process.argv[3] || 12);
const minSection = Number(process.argv[4] || 60);

const buf = readFileSync(file);
const img: RasterImage = /\.png$/i.test(file)
  ? PNG.sync.read(buf)
  : decode(buf, { useTArray: true });

const scale = 1; // the image is assumed to be at frame resolution

const sections = detectSectionOffsets(img, scale, img.height, minGutter, minSection);
console.log("sections:", sections.join(", ") || "(none)");

const band = detectSocialBand(img, scale, img.width, img.height);
if (!band || !band.found) {
  console.log("social: NO ICON ROW FOUND");
} else {
  console.log(`social: band y ${band.top}-${band.bottom} (pad ${band.padTop}-${band.padBottom})`);
  for (const c of band.cells) {
    console.log(`  x ${c.x0}-${c.x1} ${c.isIcon ? "icon " + (c.platform || "?") : "gap"}`);
  }
}
