import { TOTP, NobleCryptoPlugin, ScureBase32Plugin, createGuardrails } from "otplib";
import { mkdirSync, existsSync, rmSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_DIR, STORAGE_STATE, config, requireConfig } from "./config.mjs";

const PERIOD_SECONDS = 30;

/**
 * RFC 4226 says a shared secret MUST be at least 128 bits, and otplib v13
 * enforces that. Okta hands out 80-bit secrets (16 base32 characters) for
 * authenticator-app enrolment, so the default guardrail rejects a secret that
 * is perfectly valid and that every authenticator app accepts. We have to
 * interoperate with what Okta actually issued, so the floor is lowered to 10
 * bytes — verified against a hand-rolled RFC 4226 implementation, and the
 * 160-bit reference vectors still pass unchanged.
 */
const MIN_SECRET_BYTES = 10;

// otplib v13 takes its crypto and base32 implementations as plugins, and its
// `epoch` option is in seconds, not milliseconds.
const totpGenerator = new TOTP({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
  guardrails: createGuardrails({ MIN_SECRET_BYTES }),
});

/** Base32 as authenticator apps use it: A-Z and 2-7, optionally padded. */
const BASE32 = /^[A-Z2-7]+=*$/;

function cleanSecret() {
  requireConfig("totpSecret");
  const secret = config.totpSecret.replace(/[\s-]+/g, "").toUpperCase();
  if (!BASE32.test(secret)) {
    const bad = [...new Set(secret.replace(/[A-Z2-7=]/g, ""))].join(" ");
    throw new Error(
      `BRAZE_TOTP_SECRET is not base32${bad ? ` (unexpected: ${bad})` : ""}. ` +
        "It should be only A-Z and 2-7 — the string Okta shows when you pick " +
        "\"can't scan the QR code\", not the QR image or an otpauth:// URL."
    );
  }
  const bytes = Math.floor((secret.length * 5) / 8);
  if (bytes < MIN_SECRET_BYTES) {
    throw new Error(
      `BRAZE_TOTP_SECRET decodes to ${bytes} bytes; Okta secrets are at least ` +
        `${MIN_SECRET_BYTES} (16 base32 characters). It looks truncated.`
    );
  }
  return secret;
}

/** The current 6-digit Okta code. Same secret an authenticator app would hold. */
export async function totp(epochSeconds) {
  const secret = cleanSecret();
  return totpGenerator.generate(
    epochSeconds === undefined ? { secret } : { secret, epoch: epochSeconds }
  );
}

/** Seconds until the current code rolls over. */
export function totpTimeRemaining(nowSeconds = Math.floor(Date.now() / 1000)) {
  return PERIOD_SECONDS - (nowSeconds % PERIOD_SECONDS);
}

/**
 * A code about to expire will have rolled over by the time it is typed and
 * submitted, and the retry costs a full round trip through Okta. Waiting out
 * the window is cheaper than being rejected.
 */
export async function freshTotp(minSeconds = 5) {
  const remaining = totpTimeRemaining();
  if (remaining < minSeconds) {
    await new Promise(r => setTimeout(r, (remaining + 1) * 1000));
  }
  return totp();
}

export function hasStoredSession() {
  return existsSync(STORAGE_STATE);
}

export async function saveSession(context) {
  mkdirSync(AUTH_DIR, { recursive: true });
  await context.storageState({ path: STORAGE_STATE });
}

/** Reuse a stored session when there is one. */
export function contextOptions(extra = {}) {
  return { ...(hasStoredSession() ? { storageState: STORAGE_STATE } : {}), ...extra };
}


/**
 * Flows now run in parallel lanes (the audience import beside the draft
 * build), and two of them logging in at once is the one thing that cannot be
 * allowed: both would submit the same TOTP code, and Okta rejects a code it
 * has already seen. So login is a critical section, guarded by a directory —
 * mkdir is atomic, which is the whole trick.
 */
const LOGIN_LOCK = join(AUTH_DIR, "login.lock");
const LOCK_STALE_MS = 4 * 60_000;

export function acquireLoginLock() {
  mkdirSync(AUTH_DIR, { recursive: true });
  try {
    mkdirSync(LOGIN_LOCK);
    return true;
  } catch {
    // A crashed run must not deadlock everyone after it.
    try {
      if (Date.now() - statSync(LOGIN_LOCK).mtimeMs > LOCK_STALE_MS) {
        rmSync(LOGIN_LOCK, { recursive: true, force: true });
        mkdirSync(LOGIN_LOCK);
        return true;
      }
    } catch {
      /* lost the race to another waiter — that is fine */
    }
    return false;
  }
}

export function releaseLoginLock() {
  rmSync(LOGIN_LOCK, { recursive: true, force: true });
}

export function loginLockHeld() {
  return existsSync(LOGIN_LOCK);
}

/**
 * After waiting out another run's login, this run's context still holds the
 * dead cookies it started with — storageState is read once, at creation. Pull
 * the fresh ones the other run saved.
 */
export async function reloadSessionInto(context) {
  if (!existsSync(STORAGE_STATE)) return false;
  try {
    const state = JSON.parse(readFileSync(STORAGE_STATE, "utf8"));
    if (state.cookies?.length) {
      await context.addCookies(state.cookies);
      return true;
    }
  } catch {
    /* an unreadable state file just means a full login */
  }
  return false;
}
