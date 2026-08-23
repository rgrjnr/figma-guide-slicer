import esbuild from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { watch as watchFile } from "node:fs";

const watch = process.argv.includes("--watch");

// The UI is a single inlined HTML file, so slicer-core has to be bundled into
// it as a global rather than imported. This plugin does that on every rebuild:
// src/ui.html keeps a <!--@SLICER_CORE_BUNDLE@--> placeholder and dist/ui.html
// is what manifest.json actually loads.
async function buildUi() {
  const core = await esbuild.build({
    entryPoints: ["packages/slicer-core/src/index.ts"],
    bundle: true,
    write: false,
    target: "es2017",
    format: "iife",
    globalName: "SlicerCore",
    minify: true,
  });
  const html = await readFile("src/ui.html", "utf8");
  const bundle = core.outputFiles[0].text;
  if (!html.includes("<!--@SLICER_CORE_BUNDLE@-->")) {
    throw new Error("src/ui.html is missing the <!--@SLICER_CORE_BUNDLE@--> placeholder");
  }
  await writeFile("dist/ui.html", html.replace("<!--@SLICER_CORE_BUNDLE@-->", () => bundle));
  console.log(`  inlined slicer-core into dist/ui.html (${(bundle.length / 1024).toFixed(1)} kB)`);
}

const inlineCoreIntoUi = {
  name: "inline-core-into-ui",
  setup(build) {
    // Fires whenever code.ts or anything it imports (including slicer-core)
    // changes. ui.html is not in that graph, so it gets its own watcher below.
    build.onEnd(async result => {
      if (result.errors.length) return;
      await buildUi();
    });
  },
};

const ctx = await esbuild.context({
  entryPoints: ["src/code.ts"],
  bundle: true,
  outfile: "dist/code.js",
  target: "es2017",
  format: "iife",
  logLevel: "info",
  plugins: [inlineCoreIntoUi],
});

if (watch) {
  await ctx.watch();
  let pending = null;
  watchFile("src/ui.html", () => {
    clearTimeout(pending);   // editors write in bursts
    pending = setTimeout(() => buildUi().catch(err => console.error(err.message)), 50);
  });
  console.log("Watching for changes...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
