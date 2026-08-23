/**
 * Dump the form structure of whatever page the robot is stuck on.
 *
 *   node braze/probe.mjs                      # BRAZE_URL, using the stored session
 *   node braze/probe.mjs <url>
 *
 * Reads the DOM only — nothing is typed and nothing is submitted. This is the
 * fastest way to fix a selector: run it, see the real names and labels, edit
 * selectors.mjs. It is also how the Okta identifier screen was verified without
 * ever signing in.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR, config } from "./config.mjs";
import { contextOptions } from "./auth.mjs";

const target = process.argv[2] || config.url;
if (!target) {
  console.error("Give a URL, or set BRAZE_URL in web/.env.local");
  process.exit(1);
}

const browser = await chromium.launch({ headless: config.headless });
const context = await browser.newContext(contextOptions({ viewport: { width: 1600, height: 1000 } }));
const page = await context.newPage();

await page.goto(target, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(2_000);

console.log(`url:   ${page.url()}`);
console.log(`title: ${await page.title()}\n`);

const report = await page.evaluate(() => {
  const visible = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const labelOf = el => {
    const forLabel = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    return (forLabel?.innerText || el.getAttribute("aria-label") || el.closest("label")?.innerText || "")
      .trim().replace(/\s+/g, " ");
  };
  return {
    headings: [...document.querySelectorAll("h1,h2,h3")].filter(visible).map(h => h.innerText.trim()),
    // An iframe is the usual reason a "correct" selector finds nothing: the
    // content is in a separate document and needs frameLocator().
    iframes: [...document.querySelectorAll("iframe")].map(f => ({
      name: f.name, id: f.id, src: (f.src || "").slice(0, 100), visible: visible(f),
    })),
    inputs: [...document.querySelectorAll("input, textarea, select")].filter(visible).map(i => ({
      tag: i.tagName.toLowerCase(), name: i.name, type: i.type,
      label: labelOf(i), placeholder: i.placeholder || undefined,
    })),
    fileInputs: [...document.querySelectorAll('input[type="file"]')].map(i => ({
      name: i.name, accept: i.accept, visible: visible(i),
    })),
    buttons: [...document.querySelectorAll('button, input[type="submit"], [role="button"]')]
      .filter(visible)
      .map(b => ({ tag: b.tagName.toLowerCase(), text: (b.innerText || b.value || "").trim().slice(0, 60) }))
      .filter(b => b.text),
    tabs: [...document.querySelectorAll('[role="tab"]')].filter(visible).map(t => t.innerText.trim()),
  };
});

for (const [section, value] of Object.entries(report)) {
  if (!value || (Array.isArray(value) && value.length === 0)) continue;
  console.log(`${section}:`);
  console.log(JSON.stringify(value, null, 2).split("\n").map(l => "  " + l).join("\n"));
  console.log("");
}

if (report.iframes.length) {
  console.log("NOTE: this page has iframes. If a selector finds nothing, the control is");
  console.log("      probably inside one — reach it with page.frameLocator(...).\n");
}

mkdirSync(RUNS_DIR, { recursive: true });
const shot = join(RUNS_DIR, "probe.png");
await page.screenshot({ path: shot, fullPage: true });
console.log(`screenshot: ${shot}`);
await browser.close();
