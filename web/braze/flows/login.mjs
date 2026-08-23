import { config } from "../config.mjs";
import { freshTotp } from "../auth.mjs";
import { braze, okta, warnIfUnverified } from "../selectors.mjs";
import { appGroupFromUrl } from "../urls.mjs";

/**
 * Okta orgs run on custom domains: WBD's Braze IdP is ssobiz.wbd.com (confirmed
 * by the SAML AuthnRequest's Destination) and the end-user portal is
 * wmbiz.okta.com. Neither is reliably ".okta.com", so Okta is recognised by its
 * widget rather than its hostname. This regex is only a hint for URL waits.
 */
const OKTA_HOST_HINT = /\.okta(preview)?\.com|\.okta-emea\.com|ssobiz\.wbd\.com/;
/** The Okta end-user portal, as opposed to an app's own sign-in redirect. */
const OKTA_PORTAL = /\/enduser\/|\/app\/UserHome/;
const BRAZE_SIGN_IN = /\/sign_in|\/auth\b/;

/** Which Okta screen is showing, or null if this is not the Okta widget. */
async function currentScreen(page, timeout = 1_000) {
  for (const [name, locator] of Object.entries(okta.screens)) {
    if (await locator(page).isVisible({ timeout }).catch(() => false)) return name;
  }
  return null;
}

const onOkta = async page => (await currentScreen(page)) !== null;

/** True when the browser is sitting inside an authenticated Braze dashboard. */
export async function isSignedIn(page) {
  if (BRAZE_SIGN_IN.test(page.url()) || (await onOkta(page))) return false;
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
      await p.waitForURL(u => !/\/sign_in/.test(String(u)), { timeout: 30_000 });
    });

    // Braze then offers the configured identity providers by name rather than
    // redirecting on its own.
    if (!(await onOkta(page))) {
      await ctx.step(`choose the "${config.ssoButton}" identity provider`, async p => {
        const provider = braze.signIn.ssoProvider(p, new RegExp(config.ssoButton, "i"));
        await provider.waitFor({ state: "visible", timeout: 15_000 });
        await provider.click();
        // The SAML hand-off lands on the org's own domain, which is not
        // necessarily an okta.com one — wait for the widget, not the URL.
        await p.waitForFunction(
          () => !!document.querySelector('input[name="identifier"], input[name="credentials.passcode"]'),
          null,
          { timeout: 30_000 }
        ).catch(() => {});
      });
    }
  }

  if (await onOkta(page)) {
    await authenticate(ctx);
  } else {
    ctx.log(`no Okta widget at ${page.url()} — continuing`);
  }

  // Signing in through the portal lands on the app tiles, not inside Braze.
  if (OKTA_PORTAL.test(ctx.page.url()) || (await onOkta(ctx.page))) {
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

/**
 * The Okta widget, driven by whichever screen is actually showing rather than
 * by an assumed order. Orgs differ — some ask for the factor before the
 * password, some skip the password entirely, some show the code field straight
 * away — and a fixed sequence breaks on all of those. Each pass looks at the
 * DOM, handles that one screen, and waits for the page to change.
 */
async function authenticate(ctx) {
  const MAX_SCREENS = 8;

  for (let i = 0; i < MAX_SCREENS; i++) {
    const screen = await currentScreen(ctx.page, 2_000);
    if (!screen) {
      ctx.log("Okta widget is gone — authenticated");
      return;
    }

    const before = ctx.page.url();
    await handle[screen](ctx);
    await assertNoError(ctx, `${screen} rejected`);
    await waitForNextScreen(ctx, screen, before);
  }

  throw new Error(
    `Still on the Okta widget after ${MAX_SCREENS} screens — see the screenshots in the run directory.`
  );
}

const handle = {
  identifier: ctx =>
    ctx.step("enter username", async p => {
      await okta.identifier(p).fill(config.email);
      await okta.identifierSubmit(p).click();
    }),

  password: ctx =>
    ctx.step("enter password", async p => {
      await okta.password(p).fill(config.password);
      await okta.passwordSubmit(p).click();
    }),

  factor: ctx =>
    ctx.step("choose the code authenticator", async p => {
      // Each row has its own Select button, so the button must be scoped to the
      // row naming the authenticator — a bare "Select" would take whichever is
      // listed first, which is usually a push factor we cannot answer.
      const chooser = okta.chooseTotpFactor(p);
      if (await chooser.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await chooser.click();
      } else {
        throw new Error(
          "Okta is asking for a factor, but none of them is a code we can generate. " +
            "If this org only offers a push notification, approve it on your phone " +
            "and the run will carry on."
        );
      }
      const useCode = okta.useCodeInstead(p);
      if (await useCode.isVisible({ timeout: 3_000 }).catch(() => false)) await useCode.click();
    }),

  code: ctx =>
    ctx.step("enter the one-time code", async p => {
      // Trusting the device is what lets the stored session skip all of this
      // next time, so it is worth ticking even though it is optional.
      const trust = okta.trustDevice(p);
      if (await trust.isVisible().catch(() => false)) await trust.check().catch(() => {});

      // Generated only once the field is in hand, so the code is as young as
      // possible when it is submitted.
      await okta.totpCode(p).fill(await freshTotp());
      await okta.totpSubmit(p).click();
    }),
};

/**
 * Wait for the widget to move on. A screen that is still showing its own field
 * after this means the input was rejected without an error banner, which would
 * otherwise spin until the loop guard trips.
 */
async function waitForNextScreen(ctx, previous, previousUrl) {
  const gone = await ctx.page
    .waitForFunction(
      ([name, url]) => {
        const q = {
          identifier: 'input[name="identifier"]',
          password: 'input[name="credentials.passcode"][type="password"]',
          code: 'input[name="credentials.passcode"]:not([type="password"])',
          factor: '[data-se="authenticator-list"], .authenticator-list, .authenticator-verify-list',
        }[name];
        return location.href !== url || !document.querySelector(q);
      },
      [previous, previousUrl],
      { timeout: 30_000 }
    )
    .then(() => true)
    .catch(() => false);

  if (!gone) throw new Error(`Okta did not move past the ${previous} screen.`);
  await ctx.page.waitForLoadState("domcontentloaded").catch(() => {});
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


/**
 * The app-group id scopes every dashboard URL. It is read off wherever the
 * dashboard lands rather than configured, so the robot follows whichever
 * workspace the account opens in — override with BRAZE_APP_GROUP.
 */
export async function appGroup(ctx) {
  if (config.appGroup) return config.appGroup;
  if (ctx.appGroupId) return ctx.appGroupId;
  const found = appGroupFromUrl(ctx.page.url());
  if (found) return (ctx.appGroupId = found);
  await ctx.page.goto(config.url, { waitUntil: "domcontentloaded" });
  await ctx.page.waitForURL(/[0-9a-f]{24}/, { timeout: 30_000 });
  const id = appGroupFromUrl(ctx.page.url());
  if (!id) throw new Error("Could not determine the app-group id — set BRAZE_APP_GROUP.");
  return (ctx.appGroupId = id);
}
