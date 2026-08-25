/**
 * OCR must not depend on a CDN at run time. tesseract.js is installed from
 * npm, but unless told otherwise it loads its worker and wasm core from
 * jsdelivr on every run — which made alt text hinge on a third-party CDN and
 * failed exactly that way in CI. This copies the runtime files into public/
 * (gitignored; rebuilt on npm install) so they are served like any other
 * asset — including the por+eng language data, which is also on npm.
 */
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "tesseract");
mkdirSync(out, { recursive: true });

copyFileSync(
  join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"),
  join(out, "worker.min.js")
);

const coreDir = join(root, "node_modules", "tesseract.js-core");
for (const name of readdirSync(coreDir)) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(name)) {
    copyFileSync(join(coreDir, name), join(out, name));
  }
}
const langOut = join(out, "lang");
mkdirSync(langOut, { recursive: true });
for (const lang of ["por", "eng"]) {
  const pkg = join(root, "node_modules", "@tesseract.js-data", lang, "4.0.0_best_int");
  for (const name of readdirSync(pkg)) {
    if (name.endsWith(".traineddata.gz")) copyFileSync(join(pkg, name), join(langOut, name));
  }
}
console.log(`tesseract runtime copied to ${out}`);
