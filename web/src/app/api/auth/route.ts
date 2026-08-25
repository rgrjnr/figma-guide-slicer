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
  const user = await checkCredentials(body.user, body.password);
  if (!user) {
    await sleep(FAILURE_DELAY_MS);
    // One message for both failures. Telling someone the user name was right
    // hands them half the credential.
    return Response.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
  }

  const value = await issueSession(user, config.secret);
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookieHeader(value, request, Math.floor(SESSION_TTL_MS / 1000)) } },
  );
}

/** Sign out. `Max-Age=0` with the same Path/SameSite, which is what makes the
 *  browser drop it — a differing Path would leave the old cookie in place. */
export async function DELETE(request: Request) {
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookieHeader("", request, 0) } },
  );
}
