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
  // 2026-08-24: driven end to end against a genuinely expired session —
  // provider screen, username, password, Google Authenticator code, dashboard.
  // Every Braze selector below was read off the live dashboard and driven end
  // to end: a real campaign was composed from a ZIP, scheduled, targeted at a
  // segment, and saved as a draft; a real CSV was imported.
  createEmailDraft: true,
  scheduleCampaign: true,
  importAudience: true,
  login: true,
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
   * against dashboard-03.braze.com/sign_in.
   */
  signIn: {
    email: p => p.locator('input[name="email"]'),
    submit: p => p.locator('input[type="submit"], button[type="submit"]').first(),
    /** Present exactly when we are NOT signed in. */
    isShowing: p => p.locator('input[name="email"]'),
    /**
     * A third screen sits between the email and Okta: "Sign In to US Cluster 03"
     * with one button per configured identity provider — WBD's is "WBD Okta".
     * Read off a screenshot rather than the DOM: the page is client-rendered
     * from the previous step's state and comes back blank on a direct GET.
     */
    ssoProvider: (p, name) =>
      p.getByRole("button", { name }).or(p.getByRole("link", { name })).first(),
  },

  /** The left rail only renders once the workspace has loaded. */
  signedIn: p => p.getByRole("link", { name: /^Campaigns$/i }).first(),

  campaigns: {
    create: p => p.getByRole("button", { name: /^Create campaign$/i }).first(),
    /** "Create campaign" opens a channel menu; Email is one of its entries. */
    chooseEmail: p => p.getByRole("button", { name: /^Email$/i }).first(),
    search: p => p.getByPlaceholder(/^Search$/i).first(),
    byName: (p, name) => p.getByRole("link", { name }).first(),
  },

  /**
   * The compose step. Note the whole of it has to happen in one page session:
   * an uploaded message that has not been saved is discarded on reload.
   */
  compose: {
    name: p => p.locator('input[name="name"]'),
    /** Hidden behind a styled control; setInputFiles drives it regardless. */
    zipInput: p => p.locator('input[type="file"][accept=".zip"]').first(),
    /** Appears in the upload dialog once the archive has been unpacked. */
    buildMessage: p => p.getByRole("button", { name: /^Build message$/i }).first(),
    /** Closes the editor drawer. Used by both the editor and sending info. */
    done: p => p.getByRole("button", { name: /^Done$/i }).first(),
    editSendingInfo: p => p.getByRole("button", { name: /^Edit sending info$/i }).first(),

    // Subject and preheader are both textareas carrying aria-label "Liquid text
    // area", so the accessible name cannot tell them apart. Their id prefixes
    // can; the numeric suffix is regenerated per render.
    subject: p => p.locator('textarea[id^="sending-info-subject-input"]'),
    preheader: p => p.locator('textarea[id^="sending-info-preheader-input"]'),
    fromAddress: p => p.locator('input[id^="sending-info-from-address-select"]'),
    replyTo: p => p.locator('input[id^="sending-info-reply-to-address-select"]'),

    preview: p => p.locator("#preview-iframe, iframe[id*=preview]").first(),

    /**
     * Variants. When a design changes, the campaign is kept and its message
     * replaced: add a fresh variant, build it from the new ZIP, then remove the
     * old one. The `db-` class names are Braze's own semantics rather than the
     * hashed styled-components ones beside them, so they are the stable anchor.
     *
     * "Remove Variant" exists once per variant, so it must always be scoped to
     * the row being removed — an unscoped match deletes whichever comes first.
     */
    variants: p => p.locator("li.db-variant-item"),
    variantNamed: (p, name) => p.locator("li.db-variant-item").filter({ hasText: name }).first(),
    addVariant: p => p.locator('button[aria-label="Add variant"]').first(),
    /** A copy would carry over the very HTML being replaced. */
    composeBlank: p => p.getByText(/^Compose blank Email message$/i).first(),
    copyFromVariant: p => p.getByText(/^Copy from /i).first(),
    renameVariantIn: row => row.locator('button[aria-label="Rename Variant"]').first(),
    /**
     * Renaming happens in a small popover with its own Save and Cancel buttons.
     * Enter does not commit it and neither does blurring — the change is
     * discarded unless Save is clicked. Braze gives this one a data-testid,
     * which is the most stable anchor in the whole composer.
     */
    renamePopover: p => p.locator('[data-testid="variant-item-rename-popover-body"]'),
    variantNameInput: p =>
      p.locator('[data-testid="variant-item-rename-popover-body"] input').first(),
    renameSave: p =>
      p.locator('[data-testid="variant-item-rename-popover-body"] button[aria-label="Save"]').first(),
    removeVariantIn: row => row.locator('button[aria-label="Remove Variant"]').first(),
  },

  /**
   * The schedule step. There is no time-zone control: a designated time is
   * interpreted in the workspace's own zone (see BRAZE_WORKSPACE_TZ), unless
   * "local time zone" is ticked, which sends at that wall-clock time in each
   * recipient's zone instead.
   */
  schedule: {
    entryFrequency: p => p.locator("#entry-frequency"),
    /** The date and time fields only render once a frequency is chosen. */
    date: p => p.locator('input[placeholder="yyyy/mm/dd"]').first(),
    time: p => p.locator('input[placeholder="h:mm am"]').first(),
    localTimeZone: p => p.getByLabel(/local time zone/i).first(),
  },

  /**
   * A/B Testing on the Target step. Braze defaults to a 20% Control Group,
   * which means a fifth of the audience is deliberately sent nothing. That is
   * almost never wanted for a one-off broadcast, and it is invisible unless you
   * scroll to it — the reachable-user count on Review does not reflect it.
   */
  abTesting: {
    /** An <a> with no href, so it has no link role; match it by text. */
    removeControlGroup: p => p.getByText("Remove Control Group", { exact: true }).first(),
    distributeEvenly: p => p.getByText("Distribute Variants Evenly", { exact: true }).first(),
    percentages: p => p.locator('input[type="number"]'),
  },

  /**
   * Test sends. The recipient box takes several addresses, and Send Test stays
   * disabled until at least one is entered. A subject is required too — without
   * one Braze flags the campaign and will not send anything, test or otherwise.
   */
  testSend: {
    openPreview: p => p.getByRole("button", { name: /^Preview and test$/i }).first(),
    tab: p => p.getByRole("tab", { name: /^Test Send$/i }).first(),
    recipients: p => p.locator('input[id^="test-send-recipient-input-"]').first(),
    contentTestGroup: p => p.locator('input[id^="test-send-user-group-select-"]').first(),
    send: p => p.getByRole("button", { name: /^Send Test$/i }).first(),
  },

  target: {
    /**
     * react-select paints a placeholder div over its own input, so a click is
     * intercepted; typing into the input opens the menu just the same.
     */
    segment: p => p.getByLabel(/Target Users By Segment/i).first(),
    audienceSummary: p => p.getByText(/Email Reachable Users/i).first(),
  },

  review: {
    reachable: p => p.getByText(/Reachable users is/i).first(),
    /**
     * THE SEND. Nothing in this project ever clicks it — see braze/SENDING.md
     * for what it does and how to do it by hand.
     */
    launch: p => p.getByRole("button", { name: /^Launch Campaign$/i }).first(),
  },

  saveDraft: p => p.getByRole("button", { name: /^Save Draft$/i }).first(),

  userImport: {
    /** "Browse files" stays disabled until an import type is chosen. */
    chooseAttributes: p => p.getByText("Attributes", { exact: true }).first(),
    csvInput: p => p.locator('input[type="file"]').first(),
    next: p => p.getByRole("button", { name: /^Next$/i }).first(),
    /**
     * The default is "Don't create a targeting filter", which imports the users
     * but leaves nothing to target. This is the option that produces the
     * per-file segment the campaign is then pointed at.
     */
    createSegment: p => p.getByText(/^Create targeting filter and segment$/i).first(),
    start: p => p.getByRole("button", { name: /^Start Import$/i }).first(),
    /** The history table on the landing page; first row is the newest import. */
    rowFor: (p, fileName) => p.locator("tr").filter({ hasText: fileName }).first(),
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
