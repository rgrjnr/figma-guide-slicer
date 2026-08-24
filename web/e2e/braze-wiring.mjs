// UI gating for the Braze pipeline — deliberately WITHOUT triggering any real
// flow. The credentials in .env.local are real, so an e2e suite that clicks the
// live buttons creates campaigns in the actual dashboard (it happened; the
// strays had to be deleted by hand). The flows themselves are exercised by real
// use; what regresses silently is the gating, so that is what is pinned here.
import { chromium } from "playwright";
import { goToStep } from "./helpers.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
// Belt and braces: fail loudly if anything tries to start a real run.
await page.route("**/api/braze/run", route => {
  errors.push("a real Braze run was triggered by the test");
  route.abort();
});

await page.goto(process.env.BASE_URL || "http://localhost:3737");
await page.waitForTimeout(800);

const results = [];
const check = (l, ok, d = "") => results.push([l, ok, d]);

check("the app opens on the audience step",
  await page.locator(".steps .step.active").innerText().then(t => /Público/.test(t)));

// Advancing with an empty audience must not start an import.
await page.getByRole("button", { name: /Avançar/ }).click();
await page.waitForTimeout(600);
check("an empty audience does not start an import",
  !(await page.locator(".busy").isVisible().catch(() => false)));

await goToStep(page, "Enviar ao Braze");
const testBtn = page.getByRole("button", { name: /Enviar e-mail de teste/ });
const scheduleBtn = page.getByRole("button", { name: /Agendar envio/ });
check("the test send is blocked with no campaign and no recipients", await testBtn.isDisabled());
check("scheduling is blocked with no campaign", await scheduleBtn.isDisabled());
check("the missing artwork is explained",
  /arte ainda não/i.test(await page.locator(".review").innerText()));

// Chips: type two addresses separated by a comma, remove one with its ×.
const chipInput = page.locator(".chips input");
await chipInput.fill("ana@wbd.com");
await chipInput.press("Enter");
await chipInput.pressSequentially("bruno@wbd.com,", { delay: 15 });
await page.waitForTimeout(300);
check("separators turn addresses into chips", (await page.locator(".chip").count()) === 2);
await page.locator(".chip").first().locator("button").click();
check("the × removes a chip", (await page.locator(".chip").count()) === 1);
check("a chip that is not an address is marked", await (async () => {
  await chipInput.fill("not-an-email");
  await chipInput.press("Enter");
  return page.locator(".chip.bad").count().then(n => n === 1);
})());
check("recipients alone do not unblock the test send", await testBtn.isDisabled());

check("no page errors and no real runs", errors.length === 0, errors.join("; "));

console.log("");
let failed = 0;
for (const [l, ok, d] of results) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${ok || !d ? "" : `  (${d})`}`); if (!ok) failed++; }
await browser.close();
process.exit(failed ? 1 : 0);
