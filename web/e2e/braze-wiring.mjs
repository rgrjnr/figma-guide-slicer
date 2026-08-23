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
await page.getByRole("button", { name: "Braze" }).click();

const results = [];
const check = (l, ok, d = "") => results.push([l, ok, d]);

check("Create draft is disabled without a campaign name",
  await page.getByRole("button", { name: "Create draft" }).isDisabled());
check("Import audience is disabled with an empty list",
  await page.getByRole("button", { name: /Import audience/ }).isDisabled());
check("Schedule is disabled without a time",
  await page.getByRole("button", { name: "Schedule" }).isDisabled());

// Without a ZIP, Create draft must refuse before spawning anything.
await page.getByLabel("Campaign name").fill("TEST-wiring");
await page.getByRole("button", { name: "Create draft" }).click();
await page.waitForFunction(() => document.querySelector(".braze-log .err"), null, { timeout: 20000 });
const zipError = await page.locator(".braze-log .err").first().innerText();
check("refuses to build a draft before the email is sliced", /[Ss]lice the email/.test(zipError), zipError);

// Test sign-in reaches the real flow. What it then does depends on whether
// .env.local is filled in, so the assertions below hold either way: what is
// being tested here is the wiring, not Braze.
await page.getByRole("button", { name: "Test sign-in" }).click();
await page.waitForFunction(
  () => [...document.querySelectorAll(".braze-log div")].some(d => /finished|failed/.test(d.textContent)),
  null,
  { timeout: 60000 }
);
const log = await page.locator(".braze-log").innerText();
check("the flow actually spawned and streamed back", /run \d{4}-|BRAZE_/.test(log), log.slice(0, 200));
check("the run reported a terminal result", /finished|failed/.test(log), log.slice(-200));
check("an unconfigured setup names the variable it needs",
  !/BRAZE_/.test(log) || /BRAZE_(URL|EMAIL|TOTP_SECRET)/.test(log), log.slice(0, 200));
check("no page errors", errors.length === 0, errors.join("; "));

console.log("\nlog tail:\n" + log.split("\n").slice(-6).map(l => "   " + l).join("\n"));
console.log("");
let failed = 0;
for (const [l, ok, d] of results) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${ok || !d ? "" : `  (${d})`}`); if (!ok) failed++; }
await browser.close();
process.exit(failed ? 1 : 0);
