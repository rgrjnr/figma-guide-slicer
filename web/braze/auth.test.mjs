import test from "node:test";
import assert from "node:assert/strict";
import { config } from "./config.mjs";
import { totp, totpTimeRemaining } from "./auth.mjs";

// RFC 6238 appendix B, SHA-1: the secret "12345678901234567890" as base32.
// Proves the code handed to Okta is generated the way an authenticator app
// does, without a real secret ever going near the repo.
const REFERENCE_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("matches the RFC 6238 reference vectors", async () => {
  config.totpSecret = REFERENCE_SECRET;
  for (const [epochSeconds, expected] of [
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ]) {
    assert.equal(await totp(epochSeconds), expected, `at t=${epochSeconds}`);
  }
});

test("tolerates a secret pasted with spaces, dashes, or in lower case", async () => {
  config.totpSecret = "gezd-gnbv gy3t qojq GEZD GNBV gy3t-qojq";
  assert.equal(await totp(59), "287082");
});

/**
 * Okta issues 80-bit secrets (16 base32 characters) for authenticator-app
 * enrolment. RFC 4226 says a secret MUST be at least 128 bits and otplib v13
 * enforces that, so the default guardrail rejects a secret that is valid in
 * practice and that every authenticator app accepts. The expected value below
 * was computed independently, straight from RFC 4226 with node's crypto.
 */
test("accepts the 80-bit secrets Okta actually hands out", async () => {
  config.totpSecret = "GEZDGNBVGY3TQOJQ";
  assert.equal(await totp(59), "263420");
});

test("rejects a truncated secret with an explanation", async () => {
  config.totpSecret = "GEZDGNBV"; // 8 chars = 5 bytes
  await assert.rejects(() => totp(59), /decodes to 5 bytes.*truncated/s);
});

test("rejects something that is not base32, naming the bad characters", async () => {
  config.totpSecret = "otpauth://totp/Okta:roger?secret=GEZDGNBVGY3TQOJQ";
  await assert.rejects(() => totp(59), /not base32.*can't scan/s);
});

test("refuses to generate without a secret configured", async () => {
  config.totpSecret = "";
  await assert.rejects(() => totp(), /BRAZE_TOTP_SECRET/);
  config.totpSecret = REFERENCE_SECRET;
});

test("reports the time left in the current 30s window", () => {
  assert.equal(totpTimeRemaining(0), 30);
  assert.equal(totpTimeRemaining(29), 1);
  assert.equal(totpTimeRemaining(30), 30);
  assert.equal(totpTimeRemaining(45), 15);
});

/**
 * A second implementation, written from RFC 4226 with node's own crypto, kept
 * as an independent check on the library. If an otplib upgrade ever changes
 * behaviour, this disagrees rather than silently generating wrong codes.
 */
test("agrees with a hand-rolled RFC 4226 implementation", async () => {
  const { createHmac } = await import("node:crypto");

  const decodeBase32 = s => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const c of s.replace(/=+$/, "")) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
  };

  const reference = (secret, epochSeconds) => {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(epochSeconds / 30)));
    const hash = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
    const offset = hash[hash.length - 1] & 0xf;
    const value =
      ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
    return String(value % 1e6).padStart(6, "0");
  };

  for (const secret of ["GEZDGNBVGY3TQOJQ", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"]) {
    config.totpSecret = secret;
    for (const t of [59, 1111111109, 1234567890, 2000000000, 1798761600]) {
      assert.equal(await totp(t), reference(secret, t), `${secret.length}-char secret at t=${t}`);
    }
  }
});
