// The Braze robot cannot be tested against Braze without credentials, but the
// wiring can: the panel must reach the API route, the route must spawn the flow,
// and the flow's output must stream back into the log.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));

await page.goto(process.env.BASE_URL || "http://localhost:3737");
await page.setInputFiles('input[type="file"]', "../packages/slicer-core/test/fixtures/hbomax-moments-emkt.jpg");
await page.waitForSelector(".surface img");
await page.locator(".steps .step").last().click();
await page.waitForTimeout(600);

const draftBtn = page.getByRole("button", { name: /Criar o rascunho no Braze/i });
const scheduleBtn = page.getByRole("button", { name: /Definir o agendamento/i });
const importBtn = page.getByRole("button", { name: /Importar o público/i });

const results = [];
const check = (l, ok, d = "") => results.push([l, ok, d]);

// The review panel is what says why a button is off, so it is checked instead
// of a warning banner that no longer exists.
check("the review flags the missing subject",
  await page.locator(".review-row.bad").first().isVisible());
check("creating the draft is blocked without a subject", await draftBtn.isDisabled());
check("importing is blocked with an empty list", await importBtn.isDisabled());
check("scheduling is blocked with no campaign yet", await scheduleBtn.isDisabled());

// With a subject filled in the draft becomes possible, which is what actually
// exercises the wiring: build the ZIP, spawn the flow, stream its log back.
await page.locator(".steps .step").filter({ hasText: /Detalhes/i }).click();
await page.getByPlaceholder(/assunto que veio no pedido/i).fill("TEST subject");
await page.locator(".steps .step").last().click();
await page.waitForTimeout(400);
check("filling the subject unblocks the draft", !(await draftBtn.isDisabled()));

await draftBtn.click();
await page.waitForFunction(
  () => [...document.querySelectorAll(".braze-log div")].some(d => /^done$|failed/.test(d.textContent.trim())),
  null,
  { timeout: 240000 }
);
const log = await page.locator(".braze-log").innerText();
check("the flow actually spawned and streamed back", /run \d{4}-|BRAZE_/.test(log), log.slice(0, 200));
check("the run reported a terminal result", /done|failed/.test(log), log.slice(-200));
check("an unconfigured setup names the variable it needs",
  !/BRAZE_/.test(log) || /BRAZE_(URL|EMAIL|TOTP_SECRET)/.test(log), log.slice(0, 200));
check("no page errors", errors.length === 0, errors.join("; "));

console.log("\nlog tail:\n" + log.split("\n").slice(-6).map(l => "   " + l).join("\n"));
console.log("");
let failed = 0;
for (const [l, ok, d] of results) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${ok || !d ? "" : `  (${d})`}`); if (!ok) failed++; }
await browser.close();
process.exit(failed ? 1 : 0);
