/**
 * Reports the real controls on the Braze pages the flows need, using the stored
 * session. Navigation and DOM reads only — it never clicks anything that could
 * create, modify or send.
 *
 *   node braze/explore.mjs [pageKey ...]
 *
 * Braze is a single-page app that lazy-loads each view well after networkidle,
 * so each page waits for content it is actually expected to contain rather than
 * for the network to go quiet.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR, config, requireConfig } from "./config.mjs";
import { contextOptions } from "./auth.mjs";

requireConfig("url");

const APP_GROUP = process.env.BRAZE_APP_GROUP || "";
const base = config.url.replace(/\/$/, "");

/** Real paths, read off the sidebar rather than guessed. */
const PAGES = {
  home: { path: g => `/dashboard/app_usage/${g}?locale=en`, expect: /Hello|Performance overview/i },
  campaigns: { path: g => `/engagement/campaigns/campaigns/${g}?locale=en`, expect: /create campaign/i },
  segments: { path: g => `/engagement/segmenter/segmenter/${g}?locale=en`, expect: /segment/i },
  import: { path: g => `/users/user_import/${g}?locale=en`, expect: /import|csv/i },
  media: { path: g => `/engagement/templates_and_media/media_library/${g}?locale=en`, expect: /media|upload/i },
  templates: { path: g => `/engagement/templates_and_media/email_templates/${g}?locale=en`, expect: /template/i },
  calendar: { path: g => `/engagement/campaigns/future_send_calendar/${g}?locale=en`, expect: /calendar|scheduled/i },
};

const OUT = join(RUNS_DIR, "explore");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: config.headless });
const context = await browser.newContext(contextOptions({ viewport: { width: 1600, height: 1000 } }));
const page = await context.newPage();

/** Discover the app-group id from wherever the dashboard lands. */
async function appGroup() {
  if (APP_GROUP) return APP_GROUP;
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForURL(/[0-9a-f]{24}/, { timeout: 30_000 }).catch(() => {});
  const found = page.url().match(/[0-9a-f]{24}/);
  if (!found) throw new Error("Could not work out the app-group id — set BRAZE_APP_GROUP.");
  return found[0];
}

const summarise = () =>
  page.evaluate(() => {
    const vis = el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const name = el =>
      (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 45);
    // The left sidebar is on every page; it is noise once you have seen it.
    const inMain = el => !el.closest("nav, aside, header, [class*=sidebar], [class*=Sidebar]");
    return {
      url: location.href,
      buttons: [...new Set([...document.querySelectorAll('button, a[role="button"], input[type="submit"]')]
        .filter(el => vis(el) && inMain(el)).map(name).filter(Boolean))].slice(0, 30),
      links: [...new Set([...document.querySelectorAll("a")]
        .filter(el => vis(el) && inMain(el)).map(name).filter(Boolean))].slice(0, 25),
      inputs: [...document.querySelectorAll("input, select, textarea")].filter(el => vis(el) && inMain(el))
        .map(i => ({ tag: i.tagName.toLowerCase(), name: i.name || undefined, type: i.type, placeholder: i.placeholder || undefined })).slice(0, 20),
      fileInputs: [...document.querySelectorAll('input[type="file"]')].map(i => ({ name: i.name, accept: i.accept })),
      tabs: [...document.querySelectorAll('[role="tab"]')].filter(vis).map(name),
      iframes: [...document.querySelectorAll("iframe")].map(f => (f.src || f.id || "").slice(0, 80)),
    };
  });

const group = await appGroup();
console.log(`app group: ${group}\n`);

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PAGES);
const report = {};

for (const key of wanted) {
  const spec = PAGES[key];
  if (!spec) { console.log(`unknown page "${key}"`); continue; }
  try {
    await page.goto(base + spec.path(group), { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Wait for the view's own content, not for the network — Braze keeps
    // polling, so networkidle either fires early or never.
    await page.getByText(spec.expect).first().waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => console.log(`  (${key}: expected content never appeared — reporting what is there)`));
    await page.waitForTimeout(1_500);
    report[key] = await summarise();
    await page.screenshot({ path: join(OUT, `${key}.png`), fullPage: false });
  } catch (err) {
    report[key] = { error: err.message.split("\n")[0] };
  }
}

for (const [key, value] of Object.entries(report)) {
  console.log(`===== ${key} =====`);
  if (value.error) { console.log(`  ERROR: ${value.error}\n`); continue; }
  console.log(`  url:     ${value.url}`);
  if (value.buttons.length) console.log(`  buttons: ${value.buttons.join(" | ")}`);
  if (value.links.length) console.log(`  links:   ${value.links.join(" | ")}`);
  if (value.tabs.length) console.log(`  tabs:    ${value.tabs.join(" | ")}`);
  if (value.inputs.length) console.log(`  inputs:  ${JSON.stringify(value.inputs)}`);
  if (value.fileInputs.length) console.log(`  files:   ${JSON.stringify(value.fileInputs)}`);
  if (value.iframes.length) console.log(`  iframes: ${value.iframes.join(" | ")}`);
  console.log("");
}
console.log(`screenshots in ${OUT}`);
await browser.close();
