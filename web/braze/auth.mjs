import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";
import { mkdirSync, existsSync } from "node:fs";
import { AUTH_DIR, STORAGE_STATE, config, requireConfig } from "./config.mjs";

const PERIOD_SECONDS = 30;

// otplib v13 takes its crypto and base32 implementations as plugins, and its
// `epoch` option is in seconds, not milliseconds.
const totpGenerator = new TOTP({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
});

/** The current 6-digit Okta code. Same secret an authenticator app would hold. */
export async function totp(epochSeconds) {
  requireConfig("totpSecret");
  const secret = config.totpSecret.replace(/\s+/g, "").toUpperCase();
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
