/**
 * Interactive discovery harness. Runs a named sequence of actions against Braze
 * with the stored session, dumping the DOM after each one, so a flow can be
 * worked out a screen at a time instead of guessed at wholesale.
 *
 *   node braze/step.mjs <plan.json>
 *
 * Each action is {do, ...}: goto, click, fill, setFile, press.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR, config, requireConfig } from "./config.mjs";
import { contextOptions, saveSession } from "./auth.mjs";

requireConfig("url");
const plan = JSON.parse(readFileSync(process.argv[2], "utf8"));
const OUT = join(RUNS_DIR, plan.name || "step");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: config.headless, slowMo: 120 });
const context = await browser.newContext(contextOptions({ viewport: { width: 1600, height: 1000 } }));
const page = await context.newPage();

const dump = () =>
  page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const nm = el => (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 55);
    const main = el => !el.closest("nav, aside, [class*=sidebar], [class*=Sidebar]");
    const label = el => {
      const l = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      return (l?.innerText || el.getAttribute("aria-label") || el.closest("label")?.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40);
    };
    return {
      url: location.href,
      headings: [...document.querySelectorAll("h1,h2,h3")].filter(el => vis(el) && main(el)).map(nm).slice(0, 10),
      buttons: [...new Set([...document.querySelectorAll('button,a[role="button"],input[type="submit"],[role="menuitem"]')].filter(el => vis(el) && main(el)).map(nm).filter(Boolean))].slice(0, 35),
      inputs: [...document.querySelectorAll("input,select,textarea")].filter(el => vis(el) && main(el))
        .map(i => ({ tag: i.tagName.toLowerCase(), name: i.name || undefined, type: i.type, label: label(i) || undefined, placeholder: i.placeholder || undefined })).slice(0, 25),
      files: [...document.querySelectorAll('input[type="file"]')].map(i => ({ accept: (i.accept || "").slice(0, 60), visible: vis(i) })),
      tabs: [...document.querySelectorAll('[role="tab"]')].filter(vis).map(nm),
      iframes: [...document.querySelectorAll("iframe")].filter(vis).map(f => (f.src || f.id || "").slice(0, 80)),
    };
  });

const loc = a => {
  if (a.role) return page.getByRole(a.role, { name: new RegExp(a.name, "i") }).first();
  if (a.label) return page.getByLabel(new RegExp(a.label, "i")).first();
  if (a.text) return page.getByText(new RegExp(a.text, "i")).first();
  return page.locator(a.css).first();
};

let n = 0;
for (const action of plan.steps) {
  n++;
  const tag = `${String(n).padStart(2, "0")}-${action.do}`;
  try {
    if (action.do === "goto") await page.goto(config.url.replace(/\/$/, "") + action.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (action.do === "click") await loc(action).click({ timeout: action.timeout || 20_000 });
    if (action.do === "fill") await loc(action).fill(action.value, { timeout: 20_000 });
    if (action.do === "setFile") await page.locator('input[type="file"]').nth(action.index || 0).setInputFiles(action.path);
    if (action.do === "press") await page.keyboard.press(action.key);
    await page.waitForTimeout(action.settle ?? 2500);
    console.log(`\n===== ${tag} ${action.name || action.text || action.label || action.path || ""} =====`);
    console.log(JSON.stringify(await dump(), null, 1));
    await page.screenshot({ path: join(OUT, `${tag}.png`) });
  } catch (err) {
    console.log(`\n!! ${tag} FAILED: ${err.message.split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `${tag}-FAILED.png`) });
    break;
  }
}

await saveSession(context);
console.log(`\nartifacts in ${OUT}`);
await browser.close();
