import { SESSION_COOKIE } from "../src/lib/server/session.mjs";

/** Shared driving of the step UI, so a wording change lands in one place. */
export const FIXTURE = "../packages/slicer-core/test/fixtures/hbomax-moments-emkt.jpg";

/**
 * Get past the lock on the door, before the first navigation.
 *
 * `middleware.ts` ships no bypass flag on purpose — a stray `AUTH_DISABLED` in a
 * .env on the box would open the app's only lock with nothing rendering or
 * logging differently — so the suites hold a real credential instead, and every
 * one of them doubles as a smoke test for the middleware.
 *
 * The POST goes out from node rather than being typed into the login form: the
 * form is itself behind the redirect this exists to avoid, and seeding the
 * cookie is one request instead of a fill-and-submit in all eight suites. Call
 * it after `newPage` and *before* the first `goto`, or that goto is the redirect.
 *
 * ADMIN_USER and ADMIN_PASSWORD have to be in this process's environment. Next
 * reads .env.local for the server, but the runner is a plain node process and
 * does not — see the note at the bottom of web/.env.example.
 */
export async function signIn(page, base = process.env.BASE_URL || "http://localhost:3737") {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (!user || !password) {
    throw new Error(
      "e2e needs ADMIN_USER and ADMIN_PASSWORD in its own environment — the app has no bypass flag. " +
        "Try: env $(grep -E '^ADMIN_(USER|PASSWORD)=' .env.local | xargs) npm run e2e"
    );
  }

  const response = await fetch(new URL("/api/auth", base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, password }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(`e2e could not sign in (${response.status}): ${detail.error || response.statusText}`);
  }

  // The cookie name comes from session.mjs rather than being spelled again
  // here, because that module names this helper as the reason it is a constant.
  const header = response.headers;
  const all = typeof header.getSetCookie === "function" ? header.getSetCookie() : [header.get("set-cookie") || ""];
  const pair = all.map(c => c.split(";")[0]).find(c => c.startsWith(`${SESSION_COOKIE}=`));
  if (!pair) throw new Error(`no ${SESSION_COOKIE} cookie in the /api/auth response`);

  // Split on the first `=` only. The value is base64url with its padding
  // stripped for exactly this reason, but the name is fixed-length anyway.
  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value: pair.slice(SESSION_COOKIE.length + 1),
      domain: new URL(base).hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

export async function upload(page, fixture = FIXTURE) {
  // The app opens on Público; the design lands on the Arte step.
  await goToStep(page, "Arte");
  await page.setInputFiles('.step-body input[type="file"]', fixture);
  await page.waitForSelector(".surface img");
}

/** The single button that runs both detection passes. */
export async function autoDetect(page) {
  await page.getByRole("button", { name: /Detectar linhas automaticamente/i }).click();
  await page.waitForFunction(() => !document.querySelector("button.primary.big-btn[disabled]"), null, { timeout: 60_000 });
  await page.waitForTimeout(800);
}

export const step = (page, name) =>
  page.locator(".steps .step").filter({ hasText: new RegExp(name, "i") }).first();

export async function goToStep(page, name) {
  await step(page, name).click();
  await page.waitForTimeout(500);
}

export const guides = page => page.locator(".guide:not(.proposed)").count();
export const regions = page => page.locator(".region").count();

/**
 * Give a row a link the way a person does: click its circle on the artwork,
 * then type into the field that appears in the side panel.
 */
export async function setRowLink(page, index, url) {
  const row = page.locator(".region").nth(index);
  await row.hover();
  await row.locator(".row-actions .round.link").click();
  const field = page.locator(".link-row.focused input.url").first();
  await field.waitFor({ state: "visible" });
  await field.fill(url);
  await field.blur();
  await page.waitForTimeout(300);
}
