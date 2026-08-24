// Undo has to step back whole gestures, not individual pointer events — a guide
// drag fires continuously, and one undo per pixel would be useless.
import { chromium } from "playwright";
import { upload } from "./helpers.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.goto(process.env.BASE_URL || "http://localhost:3737");
await upload(page);

const results = [];
const check = (l, ok, d = "") => results.push([l, ok, d]);
const guides = () => page.locator(".guide:not(.proposed)").count();
const undo = async () => { await page.keyboard.press("Meta+z"); await page.waitForTimeout(350); };
const redo = async () => { await page.keyboard.press("Meta+Shift+z"); await page.waitForTimeout(350); };

check("undo starts disabled", await page.locator('.undo-group button').first().isDisabled());

const box = await page.locator(".surface").boundingBox();
const at = y => ({ x: box.x + box.width / 2, y: box.y + y });

// Three separate guide clicks.
for (const y of [200, 400, 600]) {
  await page.mouse.click(at(y).x, at(y).y);
  await page.waitForTimeout(400);
}
check("three guides added", (await guides()) === 3, String(await guides()));

await undo();
check("one undo removes one guide", (await guides()) === 2, String(await guides()));
await undo(); await undo();
check("undoing back to the start clears them", (await guides()) === 0, String(await guides()));
check("undo is disabled at the start", await page.locator('.undo-group button').first().isDisabled());

await redo();
check("redo restores one", (await guides()) === 1, String(await guides()));

// A drag must collapse into a single undo step.
await page.mouse.move(at(300).x, at(300).y);
await page.mouse.down();
for (const y of [320, 340, 360, 380, 400]) { await page.mouse.move(at(y).x, at(y).y); await page.waitForTimeout(60); }
await page.mouse.up();
await page.waitForTimeout(500);
const afterDrag = await guides();
const draggedTo = await page.locator(".guide:not(.proposed)").evaluateAll(els => els.map(e => e.style.top));
await undo();
const afterUndo = await guides();
const afterTops = await page.locator(".guide:not(.proposed)").evaluateAll(els => els.map(e => e.style.top));
// Click-then-drag is one gesture: a single undo must remove the guide it
// created, not just rewind the drag by one pointer move.
check("a click-and-drag is exactly one undo step", afterUndo === afterDrag - 1,
  `${afterDrag} -> ${afterUndo}; ${JSON.stringify(draggedTo)} -> ${JSON.stringify(afterTops)}`);

// Detection is one step too.
await page.getByRole("button", { name: /Detectar linhas automaticamente/i }).click();
await page.waitForTimeout(4000);
await page.waitForTimeout(600);
const many = await guides();
await undo();
check("accepting all detected cuts undoes as one step", (await guides()) < many, `${many} -> ${await guides()}`);

check("no page errors", errors.length === 0, errors.join("; "));
console.log("");
let failed = 0;
for (const [l, ok, d] of results) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${ok || !d ? "" : `  (${d})`}`); if (!ok) failed++; }
await browser.close();
process.exit(failed ? 1 : 0);
