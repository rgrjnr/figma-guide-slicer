import { config } from "../config.mjs";
import {
  freshTotp,
  acquireLoginLock,
  releaseLoginLock,
  loginLockHeld,
  reloadSessionInto,
} from "../auth.mjs";
import { braze, okta, warnIfUnverified } from "../selectors.mjs";
import { appGroupFromUrl } from "../urls.mjs";

/** The Okta end-user portal, as opposed to an app's own sign-in redirect. */
const OKTA_PORTAL = /\/enduser\/|\/app\/UserHome/;
const BRAZE_SIGN_IN = /\/sign_in|\/auth\b/;

/**
 * Name whichever sign-in screen is showing, or null while a redirect settles.
 *
 * Login used to be a linear script — email, provider, Okta, dashboard — which
 * worked exactly once, on a cold start. An expired session enters the chain at
 * an arbitrary point depending on which cookies survived: Braze remembered the
 * email and jumped straight to the "Sign In to US Cluster 03" provider screen,
 * the script only clicked the provider when it had come through the email
 * screen, and the run sat waiting for a dashboard that was never coming. So the
 * screen is classified from the DOM every time, and order of appearance stops
 * mattering.
 *
 * Checked most-specific first: the Okta widget's fields, then Braze's own
 * sign-in screens, then the portal, then the signed-in dashboard.
 */
export async function classifyScreen(page, quick = 400) {
  for (const [name, locator] of Object.entries(okta.screens)) {
    if (await locator(page).isVisible({ timeout: quick }).catch(() => false)) return name;
  }
  if (await braze.signIn.email(page).isVisible({ timeout: quick }).catch(() => false)) {
    return "brazeEmail";
  }
  if (
    BRAZE_SIGN_IN.test(page.url()) &&
    (await braze.signIn
      .ssoProvider(page, new RegExp(config.ssoButton, "i"))
      .isVisible({ timeout: quick })
      .catch(() => false))
  ) {
    return "brazeProvider";
  }
  if (OKTA_PORTAL.test(page.url())) return "portal";
  if (await braze.signedIn(page).isVisible({ timeout: quick * 2 }).catch(() => false)) {
    return "signedIn";
  }
  return null;
}

/** True when the browser is sitting inside an authenticated Braze dashboard. */
export async function isSignedIn(page) {
  return (await classifyScreen(page)) === "signedIn";
}

const OKTA_SCREENS = new Set(["identifier", "password", "factor", "code"]);

/**
 * Sign in, from wherever the session happens to be. Safe to call when the
 * stored session is still valid — the first classification says so and the
 * flow returns without touching anything.
 */
export async function login(ctx) {
  warnIfUnverified(ctx, "login");

  const entry = config.url || config.oktaUrl;
  if (!entry) throw new Error("Set BRAZE_URL (or BRAZE_OKTA_URL) in web/.env.local");

  await ctx.step("open the entry point", async p => {
    await p.goto(entry, { waitUntil: "domcontentloaded" });
  });

  const MAX_SCREENS = 15;
  // Redirect chains (Braze -> Okta -> SAML -> Braze) show nothing recognisable
  // for a few seconds; only a *sustained* unknown means we are actually stuck.
  let unknownStreak = 0;
  // Parallel lanes must not log in at the same time: both would submit the
  // same TOTP code and Okta refuses a code it has already seen. Whoever gets
  // the lock signs in; everyone else waits and inherits the fresh session.
  let holdingLock = false;

  try {
  for (let i = 0; i < MAX_SCREENS; i++) {
    const screen = await classifyScreen(ctx.page, 1_000);

    if (screen === "signedIn") {
      ctx.log(i === 0 ? "already signed in — the stored session is still good" : "signed in");
      return;
    }

    if (screen !== null && !holdingLock) {
      if (acquireLoginLock()) {
        holdingLock = true;
      } else {
        await ctx.step("wait for the login already in progress", async p => {
          const deadline = Date.now() + 5 * 60_000;
          while (loginLockHeld() && Date.now() < deadline) await p.waitForTimeout(3_000);
          // The context still holds the dead cookies it started with; adopt
          // the session the other run just saved, then look again.
          await reloadSessionInto(p.context());
          await p.goto(entry, { waitUntil: "domcontentloaded" });
        });
        continue;
      }
    }

    if (screen === null) {
      if (++unknownStreak >= 8) {
        throw new Error(
          `Stuck on an unrecognised screen at ${ctx.page.url()} — ` +
            "see the last screenshot in the run directory and braze/selectors.mjs."
        );
      }
      await ctx.page.waitForTimeout(3_000);
      continue;
    }
    unknownStreak = 0;

    const beforeUrl = ctx.page.url();
    await handle[screen](ctx);

    if (OKTA_SCREENS.has(screen)) {
      // Okta reports a bad password or code inline rather than by failing to
      // navigate; without this it surfaces later as a baffling timeout.
      await assertNoError(ctx, `${screen} rejected`);
      await waitForNextScreen(ctx, screen, beforeUrl);
    }
  }

  throw new Error(
    `Still not inside Braze after ${MAX_SCREENS} screens — see the screenshots in the run directory.`
  );
  } finally {
    if (holdingLock) releaseLoginLock();
  }
}

const handle = {
  brazeEmail: ctx =>
    ctx.step("enter the email on the Braze sign-in page", async p => {
      await braze.signIn.email(p).fill(config.email);
      await braze.signIn.submit(p).click();
      await p.waitForTimeout(3_000);
    }),

  brazeProvider: ctx =>
    ctx.step(`choose the "${config.ssoButton}" identity provider`, async p => {
      await braze.signIn.ssoProvider(p, new RegExp(config.ssoButton, "i")).click();
      // The SAML hand-off crosses domains; give it a moment before the loop
      // looks at what arrived.
      await p.waitForTimeout(3_000);
    }),

  portal: ctx =>
    ctx.step(`click the "${config.appTile}" tile`, async p => {
      await okta.appTile(p, config.appTile).click();
      // Tiles usually open the app in a new tab; follow it if one appears.
      const opened = await p.context().waitForEvent("page", { timeout: 15_000 }).catch(() => null);
      if (opened) {
        await opened.waitForLoadState("domcontentloaded");
        ctx.page = opened;
      }
    }),

  identifier: ctx =>
    ctx.step("enter username", async p => {
      await okta.identifier(p).fill(config.email);
      await okta.identifierSubmit(p).click();
    }),

  password: ctx =>
    ctx.step("enter password", async p => {
      if (!config.password) {
        throw new Error("Okta is asking for the password, but BRAZE_PASSWORD is not set in web/.env.local.");
      }
      await okta.password(p).fill(config.password);
      await okta.passwordSubmit(p).click();
    }),

  factor: ctx =>
    ctx.step("choose the code authenticator", async p => {
      // Scoped to the row naming the authenticator — a bare "Select" would take
      // whichever factor is listed first, usually a push we cannot answer.
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
 * Wait for the Okta widget to move on. A screen still showing its own field
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
