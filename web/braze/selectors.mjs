/**
 * Every Braze- and Okta-specific locator in the project, in one file.
 *
 * These are best-effort, written from how the dashboard is normally laid out.
 * They have NOT been checked against the real DOM — that is what
 * `npm run braze:record` is for. Expect several to be wrong on the first run.
 *
 * When you fix one, fix it here, not in a flow. And prefer role- and
 * label-based locators over CSS: Braze ships class names that change between
 * releases, but the accessible name of "Save as Draft" is stable.
 *
 * `VERIFIED` gates a loud warning at the start of every run. Flip a section to
 * true once you have watched that flow work end to end.
 */

export const VERIFIED = {
  /** Identifier screen read off the real wmbiz.okta.com widget. The screens
   *  behind it (password, factor) still need a recording session. */
  oktaIdentifier: true,
  brazeSignIn: true,
  login: false,
  createEmailDraft: false,
  importAudience: false,
  scheduleCampaign: false,
};

/**
 * Okta Identity Engine, identifier-first: username -> Next -> password -> factor.
 *
 * Verified against https://wmbiz.okta.com: the username field is
 * `input[name="identifier"]` labelled "Username", and the submit is an
 * `<input type="submit" value="Next">`, not a <button>. Element ids are
 * generated per render (`input28`, `form20`) — never select on them.
 */
export const okta = {
  /**
   * Which screen is showing, decided by the DOM rather than the URL. Okta orgs
   * use custom domains — WBD's Braze IdP is ssobiz.wbd.com, and the end-user
   * portal is wmbiz.okta.com — so nothing may key off the hostname. The widget
   * is identical on both.
   */
  screens: {
    identifier: p => p.locator('input[name="identifier"]'),
    password: p => p.locator('input[name="credentials.passcode"][type="password"]'),
    code: p => p.locator('input[name="credentials.passcode"]:not([type="password"])'),
    factor: p =>
      p.locator('[data-se="authenticator-list"], .authenticator-list, .authenticator-verify-list'),
  },

  identifier: p => p.locator('input[name="identifier"]'),
  identifierSubmit: p => p.locator('input[type="submit"], button[type="submit"]').first(),

  // OIE reuses the name `credentials.passcode` for BOTH the password field and
  // the one-time code field, on different screens. They are told apart by input
  // type: the password is type=password, the code is not.
  password: p => p.locator('input[name="credentials.passcode"][type="password"]'),
  passwordSubmit: p => p.locator('input[type="submit"], button[type="submit"]').first(),

  totpCode: p => p.locator('input[name="credentials.passcode"]:not([type="password"])'),
  totpSubmit: p => p.locator('input[type="submit"], button[type="submit"]').first(),

  /**
   * The factor chooser only appears when more than one authenticator is
   * enrolled. Each option is a row with its own "Select" button, so the button
   * has to be scoped to the row naming the authenticator — a bare "Select"
   * would pick whichever happens to be first, which may be a push factor.
   */
  chooseTotpFactor: p =>
    p.locator(".authenticator-row, .authenticator-list li, li")
      .filter({ hasText: /google authenticator|okta verify|security key|enter a code/i })
      .filter({ hasText: /google authenticator|enter a code/i })
      .first()
      .getByRole("button", { name: /select|choose/i }),

  /** Okta Verify offers push and code separately; we want the code. */
  useCodeInstead: p => p.getByRole("link", { name: /enter a code|use a different/i }).first(),

  /** Ticking this is what makes the stored session worth keeping. */
  trustDevice: p => p.locator('input[name="rememberDevice"], input[type="checkbox"]').first(),

  /** Shown when a code or password is rejected. */
  error: p => p.locator('[role="alert"], .infobox-error, .okta-form-infobox-error').first(),

  /** The end-user dashboard, when sign-in lands on the portal instead of an app. */
  appTile: (p, name) => p.getByRole("link", { name }).first(),
};

export const braze = {
  /**
   * Braze's own sign-in is identifier-first too: you enter the email address,
   * it recognises the SSO domain, and only then hands off to Okta. Verified
   * against dashboard-03.braze.com/sign_in — `input[name="email"]` and an
   * `<input type="submit" value="Continue">`.
   */
  signIn: {
    email: p => p.locator('input[name="email"]'),
    submit: p => p.locator('input[type="submit"], button[type="submit"]').first(),
    /** Present exactly when we are NOT signed in. */
    isShowing: p => p.locator('input[name="email"]'),

    /**
     * A third screen sits between the email and Okta: "Sign In to US Cluster 03"
     * with one button per configured identity provider — here, "WBD Okta".
     * Read off a screenshot rather than the DOM: the page is client-rendered
     * from the previous step's state and comes back blank on a direct GET, so
     * it cannot be probed in isolation. Override the name with
     * BRAZE_SSO_BUTTON if it does not match.
     */
    ssoProvider: (p, name) =>
      p.getByRole("button", { name }).or(p.getByRole("link", { name })).first(),
  },

  // Signed-in is judged by URL first — the sign-in path is unambiguous, whereas
  // the dashboard's own chrome is not verified yet.
  signedIn: p => p.getByRole("navigation").first(),

  campaigns: {
    nav: p => p.getByRole("link", { name: /^campaigns$/i }).first(),
    create: p => p.getByRole("button", { name: /create campaign/i }).first(),
    chooseEmail: p => p.getByRole("link", { name: /^email$/i }).first(),
    nameField: p => p.getByLabel(/campaign name/i).first(),
    search: p => p.getByPlaceholder(/search/i).first(),
    byName: (p, name) => p.getByRole("link", { name }).first(),
  },

  email: {
    // Braze offers several editors; the ZIP goes into the HTML one.
    chooseHtmlEditor: p => p.getByRole("button", { name: /html editor|upload html/i }).first(),
    // The upload control is often a hidden <input type=file>, which
    // setInputFiles drives directly without needing the visible button.
    zipInput: p => p.locator('input[type="file"]').first(),
    subject: p => p.getByLabel(/^subject/i).first(),
    preheader: p => p.getByLabel(/preheader|preview text/i).first(),
    fromAddress: p => p.getByLabel(/from address|sender/i).first(),
    replyTo: p => p.getByLabel(/reply.?to/i).first(),
    saveDraft: p => p.getByRole("button", { name: /save as draft|save draft/i }).first(),
    savedConfirmation: p => p.getByText(/saved|draft saved/i).first(),
  },

  audience: {
    nav: p => p.getByRole("link", { name: /import users|user import/i }).first(),
    csvInput: p => p.locator('input[type="file"]').first(),
    submit: p => p.getByRole("button", { name: /import|upload/i }).first(),
    // Braze processes imports asynchronously; this is the terminal state.
    complete: p => p.getByText(/import (complete|finished|succeeded)/i).first(),
    failed: p => p.getByText(/import failed|error/i).first(),
  },

  schedule: {
    tab: p => p.getByRole("tab", { name: /schedule|delivery/i }).first(),
    scheduledOption: p => p.getByRole("radio", { name: /scheduled/i }).first(),
    date: p => p.getByLabel(/date/i).first(),
    time: p => p.getByLabel(/time/i).first(),
    timeZone: p => p.getByLabel(/time ?zone/i).first(),
    localTimeDelivery: p => p.getByLabel(/local time ?zones?|in each user/i).first(),
    confirm: p => p.getByRole("button", { name: /schedule|confirm/i }).first(),
  },
};

export function warnIfUnverified(ctx, flow) {
  if (VERIFIED[flow]) return;
  ctx.log(
    `selectors for "${flow}" are UNVERIFIED — they were written from assumptions, not from the real DOM. ` +
      `If this run stops early, check the screenshot in the run directory and fix braze/selectors.mjs.`,
    "warn"
  );
}
