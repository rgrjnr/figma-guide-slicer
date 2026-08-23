import { TOTP, NobleCryptoPlugin, ScureBase32Plugin, createGuardrails } from "otplib";
import { mkdirSync, existsSync } from "node:fs";
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
