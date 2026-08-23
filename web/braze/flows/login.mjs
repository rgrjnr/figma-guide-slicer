import { config } from "../config.mjs";
import { freshTotp } from "../auth.mjs";
import { braze, okta, warnIfUnverified } from "../selectors.mjs";

const OKTA_HOST = /okta\.com|okta-emea\.com|oktapreview\.com/;

/** True when the browser is already sitting inside an authenticated dashboard. */
export async function isSignedIn(page) {
  if (OKTA_HOST.test(page.url())) return false;
  return braze.signedIn(page).isVisible({ timeout: 5_000 }).catch(() => false);
}

/**
 * Sign in through Okta. Safe to call when the stored session is still valid —
 * it notices and returns without touching the form.
 */
export async function login(ctx) {
  const { page } = ctx;
  warnIfUnverified(ctx, "login");

  await ctx.step("open Braze", async p => {
    await p.goto(config.url, { waitUntil: "domcontentloaded" });
  });

  if (await isSignedIn(page)) {
    ctx.log("already signed in — stored session is still good");
    return;
  }

  await ctx.step("wait for the identity provider", async p => {
    await p.waitForURL(OKTA_HOST, { timeout: 30_000 });
  });

  await ctx.step("enter username", async p => {
    await okta.username(p).fill(config.email);
    const next = okta.usernameNext(p);
    if (await next.isVisible().catch(() => false)) await next.click();
  });

  await ctx.step("enter password", async p => {
    const field = okta.password(p);
    await field.waitFor({ state: "visible", timeout: 15_000 });
    await field.fill(config.password);
    await okta.passwordSubmit(p).click();
  });

  await ctx.step("choose the authenticator factor if offered", async p => {
    const chooser = okta.chooseTotpFactor(p);
    if (await chooser.isVisible({ timeout: 5_000 }).catch(() => false)) await chooser.click();
    else ctx.log("no factor chooser — assuming TOTP is the only factor");
  });

  await ctx.step("enter the TOTP code", async p => {
    const field = okta.totpCode(p);
    await field.waitFor({ state: "visible", timeout: 20_000 });

    // Ticking "do not challenge me on this device" is what lets the stored
    // session skip all of this next time.
    const trust = okta.trustDevice(p);
    if (await trust.isVisible().catch(() => false)) await trust.check().catch(() => {});

    // Generated after the field is ready, so the code is as young as possible.
    await field.fill(await freshTotp());
    await okta.totpSubmit(p).click();
  });

  await ctx.step("land back on the dashboard", async p => {
    await p.waitForURL(url => !OKTA_HOST.test(String(url)), { timeout: 60_000 });
    await braze.signedIn(p).waitFor({ state: "visible", timeout: 30_000 });
  });
}
