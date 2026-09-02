import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type Role,
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
export type { Role, Session };

type Credential = { user: string; password: string; role: Role };

/**
 * A misconfigured box must fail closed. If `SESSION_SECRET` is missing every
 * cookie fails to verify — which is the safe direction — and `/api/auth`
 * refuses to sign anything rather than signing with the string "undefined",
 * which would be a well-known key.
 *
 * Two doors: `ADMIN_USER`/`ADMIN_PASSWORD` and `CLIENT_USER`/`CLIENT_PASSWORD`.
 * They open the same building — studio, ledger, invoices, issuing an invoice —
 * and differ in exactly one action, marking a fatura as paga; the rule itself
 * is in `access.mjs`. Admin plus the secret are still required to start; the
 * client pair is optional so a box without it simply has one door, not a
 * broken lock.
 */
export function authConfig(): { credentials: Credential[]; secret: string } | null {
  const admin = process.env.ADMIN_USER;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!admin || !adminPassword || !secret) return null;
  const credentials: Credential[] = [{ user: admin, password: adminPassword, role: "admin" }];
  const client = process.env.CLIENT_USER;
  const clientPassword = process.env.CLIENT_PASSWORD;
  if (client && clientPassword) credentials.push({ user: client, password: clientPassword, role: "client" });
  return { credentials, secret };
}

/**
 * Checks the submitted pair against every configured one without branching on
 * any of them. All comparisons run even after a match is found, so the
 * response time does not distinguish "wrong user" from "wrong password" from
 * "that was the other role's password" — the same thing the login page's
 * single generic message is protecting.
 */
export async function checkCredentials(
  user: unknown,
  password: unknown,
): Promise<{ user: string; role: Role } | null> {
  const config = authConfig();
  if (!config) return null;
  const results = await Promise.all(
    config.credentials.map(async credential => {
      const [userOk, passwordOk] = await Promise.all([
        secureEquals(String(user ?? ""), credential.user, config.secret),
        secureEquals(String(password ?? ""), credential.password, config.secret),
      ]);
      return userOk && passwordOk ? credential : null;
    }),
  );
  // Admin is listed first, so if both pairs are somehow identical the session
  // that comes out is deterministic rather than an accident of Promise order.
  const match = results.find(Boolean);
  return match ? { user: match.user, role: match.role } : null;
}

export async function issueSession(user: string, role: Role, secret: string): Promise<string> {
  return signSession(user, role, secret);
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
