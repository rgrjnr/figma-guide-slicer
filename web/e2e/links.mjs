// The links panel lists only rows someone has pointed at — the circle buttons
// on the artwork are the way in, and a row stays listed once it has a link or
// is social. Listing every row buried the handful that matter.
import { chromium } from "playwright";
import { signIn, autoDetect, upload } from "./helpers.mjs";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
// The middleware redirects every page to /login; seed the cookie first.
await signIn(p);

await p.goto(process.env.BASE_URL || "http://localhost:3737");
await upload(p);
await autoDetect(p);

const results = [];
const check = (l, ok, d="") => results.push([l, ok, d]);

// Only the detected social row should be listed to start with.
const shown = await p.locator(".link-row").count();
const total = await p.locator(".region").count();
check("only marked rows are listed, not every row", shown < total && shown >= 1, `${shown} of ${total}`);

// Clicking a row's link circle adds it to the panel with the field focused.
const row = p.locator(".region").nth(1);
await row.hover();
await row.locator(".row-actions .round.link").click();
await p.waitForTimeout(500);
check("the link circle opens a field for that row", (await p.locator(".link-row").count()) === shown + 1);
check("the new field has focus", await p.evaluate(() =>
  document.activeElement?.classList.contains("url")));

// Type a link; the row must stay listed after deselecting.
await p.locator(".link-row.focused input.url").fill("example.com/promo");
await p.locator(".link-row.focused input.url").blur();
const other = p.locator(".region").nth(3);
await other.hover();
await other.locator(".row-actions .round.link").click();
await p.waitForTimeout(400);
await p.keyboard.press("Escape");
check("a row with a link stays listed", await p.evaluate(() =>
  [...document.querySelectorAll(".link-row input.url")].some(i => i.value.includes("example.com/promo"))));

// The social circle still works.
const last = p.locator(".region").last();
await last.hover();
await last.locator(".row-actions .round.social").click();
await p.waitForTimeout(800);
check("the social circle marks the row", /social|Redes/i.test(await p.locator(".app-bar .status").innerText()));
check("no page errors", errs.length === 0, errs.join("; "));

let failed = 0;
for (const [l, ok, d] of results) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${ok||!d?"":`  (${d})`}`); if (!ok) failed++; }
await b.close();
process.exit(failed ? 1 : 0);
