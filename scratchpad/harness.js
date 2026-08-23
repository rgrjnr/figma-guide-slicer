// Node harness: pulls the detection code straight out of src/ui.html and runs
// it against a rendered email image, mirroring handleAnalyzeFrame.
// Usage: node harness.js <image.jpg|png> [minGutter] [minSection]
const fs = require("fs");
const path = require("path");

const uiPath = path.join(__dirname, "..", "src", "ui.html");
const ui = fs.readFileSync(uiPath, "utf8");

const start = ui.indexOf("const SECTION_UNIFORM_TOL");
const end = ui.indexOf("// ---- Entry point ----");
if (start < 0 || end < 0) throw new Error("markers not found in ui.html");
const code = ui.slice(start, end);

const sandbox = {};
new Function(
  "exports",
  code +
    "\nObject.assign(exports, { detectSectionOffsets, detectSocialBand, buildInkMask, findBands, detectInBand });"
)(sandbox);

const file = process.argv[2] || "/Users/rogerjunior/Downloads/hbomax-moments-emkt.jpg";
const minGutter = Number(process.argv[3] || 12);
const minSection = Number(process.argv[4] || 60);

let img;
if (/\.png$/i.test(file)) {
  img = require("pngjs").PNG.sync.read(fs.readFileSync(file));
} else {
  img = require("jpeg-js").decode(fs.readFileSync(file), { useTArray: true });
}
const imageData = { width: img.width, height: img.height, data: img.data };
const scale = 1; // image is at frame resolution

const sections = sandbox.detectSectionOffsets(imageData, scale, img.height, minGutter, minSection);
console.log("sections:", sections.join(", ") || "(none)");

const band = sandbox.detectSocialBand(imageData, scale, img.width, img.height);
if (!band || !band.found) {
  console.log("social: NO ICON ROW FOUND");
} else {
  console.log(`social: band y ${band.top}-${band.bottom} (pad ${band.padTop}-${band.padBottom})`);
  for (const c of band.cells)
    console.log(`  x ${c.x0}-${c.x1} ${c.isIcon ? "icon " + (c.platform || "?") : "gap"}`);
}
