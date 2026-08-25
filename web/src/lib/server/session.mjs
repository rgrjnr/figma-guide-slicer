/**
 * The session cookie: signing it, and verifying it.
 *
 * This file is plain ESM rather than TypeScript for two reasons that both come
 * from the outside. First, `middleware.ts` runs on the edge runtime, where
 * `node:crypto` does not exist — so everything here goes through Web Crypto,
 * which is present on the edge, in the browser and in Node. Second, the unit
 * tests run under `node --test`, and Node 20.19 has no type stripping at all
 * (`--experimental-strip-types` landed in 22.6), so a `.ts` module could not be
 * imported by a `.mjs` test. `session.d.mts` gives the TypeScript callers types.
 *
 * It is `session.mjs` rather than `auth.mjs` on purpose: webpack resolves an
 * extensionless `@/lib/server/auth` to the `.mjs` before the `.ts`, so a
 * same-named pair silently shadows `auth.ts` and every import from it comes
 * back undefined at runtime while `tsc` stays perfectly happy.
 *
 * This is a lock, not a security system: one shared credential, no user
 * management, as asked for in PLAN-BILLING.md phase C.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The cookie name is part of the contract with the e2e helper, which greps the
 * `Set-Cookie` header for exactly this prefix. Renaming it silently breaks
 * every browser suite, so it lives here as a constant and nowhere as a literal.
 */
export const SESSION_COOKIE = "studio_session";

/** A week. Long enough that nobody signs in twice a day, short enough that a
 *  cookie copied off a machine stops working on its own. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Thrown only for programmer errors — a missing secret, an empty user. A bad
 *  cookie is never an exception, it is a `null` from `verifySession`. */
export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // The padding `=` has to go: the e2e helper splits the Set-Cookie pair on the
  // first `=`, and a padded value would be truncated at its own padding.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  // `atob` is lenient about characters outside the alphabet in some runtimes,
  // so the charset is checked here rather than trusted to it.
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]+$/.test(text)) throw new AuthError("not base64url");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function keyFor(secret) {
  if (typeof secret !== "string" || secret.length === 0) throw new AuthError("SESSION_SECRET is not set");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/**
 * `user|expiry|HMAC-SHA256`, in the plan's words, encoded so that it survives a
 * cookie jar: the two payload fields are joined with `.` and the user is
 * base64url'd, because a cookie value may not contain `;`, `,`, whitespace or
 * `=` and the admin user name comes from an env var we do not control.
 *
 * The expiry is part of the signed string, never a separate attribute. A cookie
 * `Max-Age` is a request from the server that the browser is free to ignore, so
 * it can only ever be a convenience; the expiry that is enforced is this one.
 */
export async function signSession(user, secret, { now = Date.now(), ttlMs = SESSION_TTL_MS } = {}) {
  if (typeof user !== "string" || user.length === 0) throw new AuthError("user is empty");
  const expiresAt = now + ttlMs;
  const payload = `${toBase64Url(encoder.encode(user))}.${expiresAt}`;
  const signature = await crypto.subtle.sign("HMAC", await keyFor(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Returns the session, or `null` for every kind of "no". Garbage, a truncated
 * value, a re-signed payload, an expired one and a missing secret all take the
 * same exit: middleware must be able to hand this any string a client sent and
 * get a redirect out, never a 500 that reveals the shape of the cookie.
 *
 * Order matters — the signature is checked before the expiry is read, so an
 * attacker cannot extend their own session by editing the number.
 */
export async function verifySession(value, secret, now = Date.now()) {
  try {
    if (typeof value !== "string") return null;
    const parts = value.split(".");
    if (parts.length !== 3) return null;
    const [userPart, expiryPart, signaturePart] = parts;
    // Anchored digits only: `Number("12e99")` and `Number(" 1")` both parse, and
    // either would be a way to smuggle an expiry past a looser check.
    if (!/^[0-9]+$/.test(expiryPart)) return null;

    const signature = fromBase64Url(signaturePart);
    const ok = await crypto.subtle.verify(
      "HMAC",
      await keyFor(secret),
      signature,
      encoder.encode(`${userPart}.${expiryPart}`),
    );
    if (!ok) return null;

    const expiresAt = Number(expiryPart);
    if (!(expiresAt > now)) return null;

    const user = decoder.decode(fromBase64Url(userPart));
    if (user.length === 0) return null;
    return { user, expiresAt };
  } catch {
    // A malformed base64 body, a zero-length secret, a runtime that dislikes the
    // key — all of it is just "not signed in".
    return null;
  }
}

/**
 * Constant-time string comparison built out of what the edge runtime has.
 *
 * `node:crypto.timingSafeEqual` is unavailable here, and it would leak the
 * expected length anyway by throwing on a size mismatch. HMAC-ing both sides
 * under the session secret turns any two inputs into two 32-byte digests, so
 * the loop below always runs the same number of times whatever was submitted,
 * and the digests reveal nothing without the secret.
 */
export async function secureEquals(a, b, secret) {
  try {
    if (typeof a !== "string" || typeof b !== "string") return false;
    const key = await keyFor(secret);
    const [left, right] = await Promise.all([
      crypto.subtle.sign("HMAC", key, encoder.encode(a)),
      crypto.subtle.sign("HMAC", key, encoder.encode(b)),
    ]);
    const x = new Uint8Array(left);
    const y = new Uint8Array(right);
    let diff = x.length ^ y.length;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
  } catch {
    return false;
  }
}
