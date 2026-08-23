import { config } from "../config.mjs";
import { freshTotp } from "../auth.mjs";
import { braze, okta, warnIfUnverified } from "../selectors.mjs";

const OKTA_HOST = /\.okta(preview)?\.com|\.okta-emea\.com/;
/** The Okta end-user portal, as opposed to an app's own sign-in redirect. */
const OKTA_PORTAL = /\/enduser\/|\/app\/UserHome/;
const BRAZE_SIGN_IN = /\/sign_in/;

const onOkta = page => OKTA_HOST.test(page.url());

/** True when the browser is sitting inside an authenticated Braze dashboard. */
export async function isSignedIn(page) {
  if (onOkta(page) || BRAZE_SIGN_IN.test(page.url())) return false;
  return braze.signedIn(page).isVisible({ timeout: 5_000 }).catch(() => false);
}

/**
 * Sign in through Okta Identity Engine.
 *
 * Two entry paths are supported, because which one applies depends on how the
 * tenant is set up: going to Braze and being redirected to Okta, or signing
 * into the Okta portal and clicking the Braze tile. The flow starts at Braze
 * when BRAZE_URL is set and falls back to the portal if it ends up there.
 *
 * Safe to call when the stored session is still valid — it notices and returns
 * without touching the form.
 */
export async function login(ctx) {
  const { page } = ctx;
  warnIfUnverified(ctx, "login");

  const entry = config.url || config.oktaUrl;
  if (!entry) throw new Error("Set BRAZE_URL (or BRAZE_OKTA_URL) in web/.env.local");

  await ctx.step("open the entry point", async p => {
    await p.goto(entry, { waitUntil: "domcontentloaded" });
  });

  if (await isSignedIn(page)) {
    ctx.log("already signed in — the stored session is still good");
    return;
  }

  // Braze does not redirect to Okta on its own: its sign-in page asks for the
  // email address first, recognises the SSO domain, and only then hands off.
  if (await braze.signIn.isShowing(page).isVisible({ timeout: 5_000 }).catch(() => false)) {
    await ctx.step("hand off to SSO from the Braze sign-in page", async p => {
      await braze.signIn.email(p).fill(config.email);
      await braze.signIn.submit(p).click();
      await p.waitForURL(u => OKTA_HOST.test(String(u)) || !BRAZE_SIGN_IN.test(String(u)), {
        timeout: 30_000,
      });
    });

    // Braze then offers the configured identity providers by name rather than
    // redirecting on its own.
    if (!onOkta(page)) {
      await ctx.step(`choose the "${config.ssoButton}" identity provider`, async p => {
        const provider = braze.signIn.ssoProvider(p, new RegExp(config.ssoButton, "i"));
        await provider.waitFor({ state: "visible", timeout: 15_000 });
        await provider.click();
        await p.waitForURL(u => OKTA_HOST.test(String(u)), { timeout: 30_000 });
      });
    }
  }

  if (onOkta(page)) {
    await authenticate(ctx);
  } else {
    ctx.log(`no Okta redirect from ${page.url()} — continuing`);
  }

  // Signing in through the portal lands on the app tiles, not inside Braze.
  if (OKTA_PORTAL.test(page.url()) || onOkta(page)) {
    await ctx.step(`click the "${config.appTile}" tile`, async p => {
      await okta.appTile(p, config.appTile).click();
      // Tiles usually open the app in a new tab.
      const opened = await p.context().waitForEvent("page", { timeout: 15_000 }).catch(() => null);
      if (opened) {
        await opened.waitForLoadState("domcontentloaded");
        ctx.page = opened;
      }
    });
  }

  await ctx.step("confirm we are inside Braze", async () => {
    await braze.signedIn(ctx.page).waitFor({ state: "visible", timeout: 30_000 });
  });
}

/** The Okta widget itself: username -> password -> second factor. */
async function authenticate(ctx) {
  const { page } = ctx;

  await ctx.step("enter username", async p => {
    const field = okta.identifier(p);
    await field.waitFor({ state: "visible", timeout: 30_000 });
    await field.fill(config.email);
    await okta.identifierSubmit(p).click();
  });

  await ctx.step("enter password", async p => {
    const field = okta.password(p);
    await field.waitFor({ state: "visible", timeout: 20_000 });
    await field.fill(config.password);
    await okta.passwordSubmit(p).click();
    await assertNoError(ctx, "password rejected");
  });

  await ctx.step("select the code authenticator if offered", async p => {
    // The chooser is skipped entirely when only one factor is enrolled, and the
    // code field may already be on screen.
    if (await okta.totpCode(p).isVisible({ timeout: 3_000 }).catch(() => false)) {
      ctx.log("code field already showing — no factor chooser");
      return;
    }
    const chooser = okta.chooseTotpFactor(p);
    if (await chooser.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await chooser.click();
    }
    // Okta Verify defaults to a push; we want the code we can generate.
    const useCode = okta.useCodeInstead(p);
    if (await useCode.isVisible({ timeout: 3_000 }).catch(() => false)) await useCode.click();
  });

  await ctx.step("enter the one-time code", async p => {
    const field = okta.totpCode(p);
    await field.waitFor({ state: "visible", timeout: 20_000 });

    // Trusting the device is what lets the stored session skip all of this
    // next time, so it is worth ticking even though it is optional.
    const trust = okta.trustDevice(p);
    if (await trust.isVisible().catch(() => false)) await trust.check().catch(() => {});

    // Generated only once the field is ready, so the code is as young as
    // possible when it is submitted.
    await field.fill(await freshTotp());
    await okta.totpSubmit(p).click();
    await assertNoError(ctx, "one-time code rejected");
  });

  await ctx.step("wait for Okta to hand off", async p => {
    await p.waitForURL(url => !/\/(signin|authorize)/.test(String(url)), { timeout: 60_000 });
  });
}

/**
 * Okta reports a bad password or code inline rather than by failing to
 * navigate, so a silent wrong answer would otherwise surface much later as a
 * confusing timeout on the next step.
 */
async function assertNoError(ctx, what) {
  const error = okta.error(ctx.page);
  if (await error.isVisible({ timeout: 3_000 }).catch(() => false)) {
    throw new Error(`${what}: ${(await error.innerText()).trim().replace(/\s+/g, " ")}`);
  }
}
