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
  login: false,
  createEmailDraft: false,
  importAudience: false,
  scheduleCampaign: false,
};

export const okta = {
  // Okta usually splits identity and password across two screens.
  username: p => p.getByLabel(/username|email/i).first(),
  usernameNext: p => p.getByRole("button", { name: /next|sign in/i }).first(),
  password: p => p.getByLabel(/password/i).first(),
  passwordSubmit: p => p.getByRole("button", { name: /verify|sign in|next/i }).first(),
  // The factor list only appears when more than one factor is enrolled.
  chooseTotpFactor: p => p.getByRole("link", { name: /google authenticator|okta verify|enter a code/i }).first(),
  totpCode: p => p.getByLabel(/code|passcode/i).first(),
  totpSubmit: p => p.getByRole("button", { name: /verify|sign in/i }).first(),
  // Ticking this is what makes storageState worth keeping.
  trustDevice: p => p.getByLabel(/do not challenge me|trust this device|remember/i).first(),
};

export const braze = {
  // A reliable "we are signed in and on the dashboard" signal.
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
