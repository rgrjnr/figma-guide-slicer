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

test("tolerates a secret pasted with spaces and in lower case", async () => {
  config.totpSecret = "gezd gnbv gy3t qojq gezd gnbv gy3t qojq";
  assert.equal(await totp(59), "287082");
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
