import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type Session,
  secureEquals,
  signSession,
  verifySession,
} from "@/lib/server/session.mjs";

/**
 * The environment-facing half of the lock. The signing itself lives in
 * `session.mjs` next door, which is deliberately free of `process.env`, `node:*`
 * and Next so that it can run on the edge runtime and be imported by a plain
 * `node --test` file. Nothing here touches the filesystem either — this module
 * is pulled into `middleware.ts`, which is bundled for the edge.
 */

export { SESSION_COOKIE, SESSION_TTL_MS, verifySession };
export type { Session };

/**
 * A misconfigured box must fail closed. If `SESSION_SECRET` is missing every
 * cookie fails to verify — which is the safe direction — and `/api/auth`
 * refuses to sign anything rather than signing with the string "undefined",
 * which would be a well-known key.
 */
export function authConfig(): { user: string; password: string; secret: string } | null {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!user || !password || !secret) return null;
  return { user, password, secret };
}

/**
 * Checks the submitted pair against the configured one without branching on
 * either. Both fields are compared even when the first already failed, so the
 * response time does not distinguish "wrong user" from "wrong password" — the
 * same thing the login page's single generic message is protecting.
 */
export async function checkCredentials(user: unknown, password: unknown): Promise<string | null> {
  const config = authConfig();
  if (!config) return null;
  const [userOk, passwordOk] = await Promise.all([
    secureEquals(String(user ?? ""), config.user, config.secret),
    secureEquals(String(password ?? ""), config.password, config.secret),
  ]);
  return userOk && passwordOk ? config.user : null;
}

export async function issueSession(user: string, secret: string): Promise<string> {
  return signSession(user, secret);
}

/**
 * `SameSite=Lax` and `Path=/` are load-bearing rather than habit: the OCR
 * worker, the tesseract wasm and every static asset are same-origin GETs, and
 * this is what makes them carry the cookie without any fetch of ours having to
 * opt in with `credentials`.
 *
 * `Secure` is conditional because a `Secure` cookie is silently dropped on
 * `http://localhost`, which is where the app is developed and where the e2e
 * suites run — an unconditional flag would look like a login that never takes.
 */
export function sessionCookieHeader(value: string, request: Request, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === "https:";
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}
