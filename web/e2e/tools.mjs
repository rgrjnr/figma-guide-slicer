// Exercises the two drag tools: work area (constrains detection) and button
// (turns a drawn rect into its own full-width linked row).
import { chromium } from "playwright";

const URL_BASE = process.env.BASE_URL || "http://localhost:3737";
const FIXTURE = "../packages/slicer-core/test/fixtures/hbomax-moments-emkt.jpg";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));

await page.goto(URL_BASE);
await page.setInputFiles('input[type="file"]', FIXTURE);
await page.waitForSelector(".surface img");

const surface = page.locator(".surface");
const box = await surface.boundingBox();
// The artwork is 924 design px tall; zoom is 1 at this viewport width (600px).
const atY = y => ({ x: box.x + box.width / 2, y: box.y + y });

async function dragTo(y0, y1) {
  await page.mouse.move(...Object.values(atY(y0)));
  await page.mouse.down();
  await page.mouse.move(...Object.values(atY((y0 + y1) / 2)));
  await page.mouse.move(...Object.values(atY(y1)));
  await page.mouse.up();
}

const results = [];
const check = (label, ok, detail = "") => { results.push([label, ok, detail]); };

// --- Work area constrains detection ---
await page.getByRole("button", { name: "Work area" }).click();
await dragTo(300, 700);
const hint = await page.locator(".panel .hint").first().innerText();
check("work area recorded from the drag", /y \d+–\d+/.test(hint), hint);

await page.getByRole("button", { name: "Find sections" }).click();
await page.waitForTimeout(300);
const proposed = await page.locator(".guide.proposed").evaluateAll(els =>
  els.map(e => Math.round(parseFloat(e.style.top)))
);
check("all proposed cuts fall inside the work area",
  proposed.length > 0 && proposed.every(y => y > 300 && y < 700), JSON.stringify(proposed));

await page.getByRole("button", { name: "Find social row" }).click();
await page.waitForTimeout(300);
check("social row outside the work area is not found",
  (await page.locator(".app-bar .status").innerText()).includes("No social icon row"),
  await page.locator(".app-bar .status").innerText());

// --- Button tool ---
await page.getByRole("button", { name: "clear" }).click();
await page.getByRole("button", { name: "Button" }).click();
const before = await page.locator(".region").count();
await dragTo(430, 470);
await page.waitForTimeout(200);
const after = await page.locator(".region").count();
check("drawing a button adds a row", after > before, `${before} -> ${after}`);

const buttonCard = page.locator(".row-card", { has: page.locator('select option[value="button"]:checked') });
check("the new row is typed as a button", (await buttonCard.count()) === 1);

const label = await buttonCard.first().locator("header .dim").innerText();
check("the button row is exactly the height that was drawn", /· 40px$/.test(label), label);
check("the button row spans the full width — no x cropping",
  (await buttonCard.first().locator(".cell").count()) === 1);

check("no page errors", errors.length === 0, errors.join("; "));

console.log("");
let failed = 0;
for (const [label, ok, detail] of results) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`);
  if (!ok) failed++;
}
await browser.close();
process.exit(failed ? 1 : 0);
