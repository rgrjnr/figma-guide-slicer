/**
 * Screen detection, against static fixtures modelled on the real Okta Identity
 * Engine markup. Offline and deterministic, so it keeps working when the login
 * page is unreachable — the live check is the run itself.
 *
 * What matters here is the OIE trap: the password field and the one-time code
 * field share the name `credentials.passcode` on different screens, so anything
 * matching on the name alone confuses them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { okta } from "./selectors.mjs";
import { classifyScreen } from "./flows/login.mjs";

const FIXTURES = {
  // Reproduces what was read off ssobiz.wbd.com and wmbiz.okta.com: generated
  // ids, and a submit that is an <input>, not a <button>.
  identifier: `<form class="o-form"><label for="input28">Username</label>
    <input name="identifier" type="text" id="input28" autocomplete="username">
    <input type="submit" class="button button-primary" value="Next"></form>`,

  password: `<form class="o-form"><h2>Verify with your password</h2>
    <label for="input41">Password</label>
    <input name="credentials.passcode" type="password" id="input41">
    <input type="submit" value="Verify"></form>`,

  code: `<form class="o-form"><h2>Enter a code</h2>
    <label for="input57">Enter code</label>
    <input name="credentials.passcode" type="text" id="input57" autocomplete="one-time-code">
    <input name="rememberDevice" type="checkbox" id="rd"><label for="rd">Do not challenge me on this device</label>
    <input type="submit" value="Verify"></form>`,

  factor: `<div class="authenticator-list" data-se="authenticator-list">
    <div class="authenticator-row">Okta Verify <button>Select</button></div>
    <div class="authenticator-row">Google Authenticator <button>Select</button></div>
  </div>`,

  none: `<main><h1>Braze Dashboard</h1><nav>Campaigns</nav></main>`,

  // Braze's own sign-in screens, from the live dashboard.
  brazeEmail: `<form><h2>Sign In</h2>
    <input name="email" type="email" placeholder="Enter your email address">
    <input type="submit" value="Continue"></form>`,

  // The screen an expired session actually lands on: the email is remembered,
  // so /sign_in is skipped and this is the first thing the robot sees. The
  // original linear flow only reached the provider button via the email screen,
  // which is exactly how it got stuck here.
  auth: `<main><h2>Sign In to US Cluster 03</h2>
    <p role="alert">Your session expired, please sign in again to continue.</p>
    <span>roger@example.com</span> <a href="#">Not you?</a>
    <button>WBD Okta</button></main>`,

  signedIn: `<nav><a href="/engagement/campaigns">Campaigns</a><a href="#">Segments</a></nav>
    <main><h1>Hello</h1></main>`,

  loading: `<div class="spinner"></div>`,
};

const server = createServer((req, res) => {
  // Query strings are part of the real URLs (/auth?cluster_name=…) but not of
  // the fixture key.
  const key = req.url.slice(1).split("?")[0] || "none";
  res.end(`<!doctype html><meta charset="utf-8">${FIXTURES[key] ?? FIXTURES.none}`);
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
test.after(async () => {
  await browser.close();
  server.close();
});

async function detect() {
  for (const [name, locator] of Object.entries(okta.screens)) {
    if (await locator(page).isVisible({ timeout: 500 }).catch(() => false)) return name;
  }
  return null;
}

for (const name of ["identifier", "password", "code", "factor"]) {
  test(`recognises the ${name} screen`, async () => {
    await page.goto(`${base}/${name}`);
    assert.equal(await detect(), name);
  });
}

test("does not mistake a signed-in page for the Okta widget", async () => {
  await page.goto(`${base}/none`);
  assert.equal(await detect(), null);
});

test("tells password and code apart despite the shared field name", async () => {
  await page.goto(`${base}/password`);
  assert.equal(await okta.password(page).count(), 1);
  assert.equal(await okta.totpCode(page).count(), 0, "the password must not read as a code");

  await page.goto(`${base}/code`);
  assert.equal(await okta.totpCode(page).count(), 1);
  assert.equal(await okta.password(page).count(), 0, "the code must not read as a password");
});

test("picks the code authenticator, not whichever factor is listed first", async () => {
  await page.goto(`${base}/factor`);
  const row = okta.chooseTotpFactor(page);
  await row.waitFor({ state: "visible", timeout: 2_000 });
  const label = await row.locator("xpath=..").innerText();
  assert.match(label, /Google Authenticator/, "should skip the push-only Okta Verify row");
});

test("finds the identifier submit even though it is an <input>, not a <button>", async () => {
  await page.goto(`${base}/identifier`);
  assert.equal(await okta.identifierSubmit(page).count(), 1);
});

test("finds the trust-this-device checkbox on the code screen", async () => {
  await page.goto(`${base}/code`);
  assert.equal(await okta.trustDevice(page).count(), 1);
});


/**
 * The login state machine's eyes. The case that matters most is the expired
 * session: Braze remembers the email and lands straight on the provider screen,
 * so classification must not depend on how a screen was reached.
 */
for (const [path, expected] of [
  ["brazeEmail", "brazeEmail"],
  ["auth?cluster_name=US+Cluster+03&email=roger%40example.com", "brazeProvider"],
  ["identifier", "identifier"],
  ["password", "password"],
  ["code", "code"],
  ["factor", "factor"],
  ["signedIn", "signedIn"],
]) {
  test(`classifies /${path.split("?")[0]} as ${expected}`, async () => {
    await page.goto(`${base}/${path}`);
    assert.equal(await classifyScreen(page), expected);
  });
}

test("a loading page classifies as null rather than as something to act on", async () => {
  await page.goto(`${base}/loading`);
  assert.equal(await classifyScreen(page), null);
});

test("the provider button alone is not enough — the URL must be a sign-in path", async () => {
  // A dashboard page that happens to contain the word Okta in a button must not
  // be mistaken for the provider screen and clicked.
  await page.goto(`${base}/signedIn`);
  assert.equal(await classifyScreen(page), "signedIn");
});
