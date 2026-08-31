import { SESSION_TTL_MS, authConfig, checkCredentials, issueSession, sessionCookieHeader } from "@/lib/server/auth";

export const runtime = "nodejs";

/** A failed attempt is held for this long before answering. It is not rate
 *  limiting — it just makes an online guessing run against a single shared
 *  password cost hours instead of seconds, and nobody notices a third of a
 *  second on the one attempt a human ever makes. */
const FAILURE_DELAY_MS = 300;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Sign in. Takes JSON and answers with the `Set-Cookie` on a 200 rather than a
 * form POST plus a redirect, because the e2e helper logs in through this same
 * endpoint from bare `fetch` and reads the header off the response — the
 * suites use the front door instead of a bypass flag, so this shape is part of
 * the test contract, not just a convenience for the login page.
 */
export async function POST(request: Request) {
  const config = authConfig();
  if (!config) {
    // Failing closed and saying so: without the three env vars there is no
    // secret to sign with, and signing with a default would be worse than not
    // starting. The message names the file because the only person who can see
    // it is whoever is running the box.
    return Response.json(
      { error: "Autenticação não configurada — defina ADMIN_USER, ADMIN_PASSWORD e SESSION_SECRET." },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const match = await checkCredentials(body.user, body.password);
  if (!match) {
    await sleep(FAILURE_DELAY_MS);
    // One message for both failures. Telling someone the user name was right
    // hands them half the credential.
    return Response.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
  }

  const value = await issueSession(match.user, match.role, config.secret);
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const headers = new Headers();
  headers.append("Set-Cookie", sessionCookieHeader(value, request, maxAge));
  // A second, readable cookie carrying only the role, so the nav can decide
  // which links to draw without a round trip. It is decoration, not a lock —
  // anyone can edit it and all they get is a link to a page the middleware
  // will bounce them off, because enforcement only ever reads the signed one.
  headers.append("Set-Cookie", roleHintCookieHeader(match.role, request, maxAge));
  return Response.json({ ok: true, role: match.role }, { headers });
}

/** Sign out. `Max-Age=0` with the same Path/SameSite, which is what makes the
 *  browser drop it — a differing Path would leave the old cookie in place. */
export async function DELETE(request: Request) {
  const headers = new Headers();
  headers.append("Set-Cookie", sessionCookieHeader("", request, 0));
  headers.append("Set-Cookie", roleHintCookieHeader("", request, 0));
  return Response.json({ ok: true }, { headers });
}

/** Same attributes as the session cookie except `HttpOnly` — being readable
 *  from the page is this cookie's entire reason to exist. */
function roleHintCookieHeader(role: string, request: Request, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === "https:";
  return [`studio_role=${role}`, "Path=/", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`, secure ? "Secure" : null]
    .filter(Boolean)
    .join("; ");
}
