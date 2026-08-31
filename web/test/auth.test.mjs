// Plain node:test — no build step, run with `node --test test/`.
//
// This is the only lock in the app, so the interesting cases are all the ways
// in that are not the front door: a payload edited in the browser's cookie
// jar, a signature borrowed from another secret, a cookie that has aged out,
// and the stream of junk any public endpoint gets sent. None of them may throw
// — middleware turns a `null` into a redirect and an exception into a 500 that
// takes the whole app down.
import test from "node:test";
import assert from "node:assert/strict";
import { AuthError, ROLES, SESSION_TTL_MS, secureEquals, signSession, verifySession } from "../src/lib/server/session.mjs";

const SECRET = "a-secret-that-only-this-box-knows";
const NOW = Date.parse("2026-08-25T12:00:00Z");

test("a cookie it just signed verifies, and carries the user and role back", async () => {
  for (const role of ROLES) {
    const cookie = await signSession("someone", role, SECRET, { now: NOW });
    assert.deepEqual(await verifySession(cookie, SECRET, NOW + 1000), {
      user: "someone",
      role,
      expiresAt: NOW + SESSION_TTL_MS,
    });
  }
});

test("signing refuses a role outside the closed set", async () => {
  await assert.rejects(() => signSession("admin", "root", SECRET, { now: NOW }), AuthError);
  await assert.rejects(() => signSession("admin", undefined, SECRET, { now: NOW }), AuthError);
});

test("editing the role in the payload invalidates it — a client cannot promote itself", async () => {
  const cookie = await signSession("client", "client", SECRET, { now: NOW });
  const [user, , expiry, signature] = cookie.split(".");
  assert.equal(await verifySession(`${user}.admin.${expiry}.${signature}`, SECRET, NOW), null);
  // The untouched cookie still verifies, so the refusal above is the forgery.
  assert.notEqual(await verifySession(cookie, SECRET, NOW), null);
});

test("a pre-role three-part cookie is refused, not misread", async () => {
  // The shape the app signed before roles existed; deploying roles signs
  // everyone out once, it must not let old cookies through by accident.
  assert.equal(await verifySession("YWRtaW4.1787000000000.AAAA", SECRET, NOW), null);
});

test("the expiry is inside the signed payload, not a cookie attribute", async () => {
  const cookie = await signSession("admin", "admin", SECRET, { now: NOW });
  const [, , expiry] = cookie.split(".");
  assert.equal(Number(expiry), NOW + SESSION_TTL_MS);
});

test("a user name with characters a cookie cannot hold survives the round trip", async () => {
  // The admin user comes from an env var, so it may contain `;`, `=`, a comma
  // or an accent — all of which would either truncate the cookie or be dropped
  // by the browser if the value were not encoded.
  const cookie = await signSession("joão;role=admin, ok", "client", SECRET, { now: NOW });
  assert.equal(cookie.includes("="), false);
  assert.equal(cookie.includes(";"), false);
  const session = await verifySession(cookie, SECRET, NOW);
  assert.equal(session.user, "joão;role=admin, ok");
});

test("editing the user in the payload invalidates it", async () => {
  const cookie = await signSession("guest", "client", SECRET, { now: NOW });
  const [, role, expiry, signature] = cookie.split(".");
  const forged = `${Buffer.from("admin").toString("base64url")}.${role}.${expiry}.${signature}`;
  assert.equal(await verifySession(forged, SECRET, NOW), null);
});

test("pushing the expiry out by hand invalidates it rather than extending it", async () => {
  const cookie = await signSession("admin", "admin", SECRET, { now: NOW });
  const [user, role, expiry, signature] = cookie.split(".");
  const forged = `${user}.${role}.${Number(expiry) + 86_400_000}.${signature}`;
  assert.equal(await verifySession(forged, SECRET, NOW), null);
  // And the untouched one is still fine, so the test above is not passing for
  // some unrelated reason.
  assert.notEqual(await verifySession(`${user}.${role}.${expiry}.${signature}`, SECRET, NOW), null);
});

test("a signature from a different secret is refused", async () => {
  const cookie = await signSession("admin", "admin", "the-other-box", { now: NOW });
  assert.equal(await verifySession(cookie, SECRET, NOW), null);
});

test("a truncated signature is refused, not an exception", async () => {
  const cookie = await signSession("admin", "admin", SECRET, { now: NOW });
  assert.equal(await verifySession(cookie.slice(0, -4), SECRET, NOW), null);
});

test("an expired cookie is refused the moment it is due, not a tick later", async () => {
  const cookie = await signSession("admin", "admin", SECRET, { now: NOW });
  const expiresAt = NOW + SESSION_TTL_MS;
  assert.notEqual(await verifySession(cookie, SECRET, expiresAt - 1), null);
  assert.equal(await verifySession(cookie, SECRET, expiresAt), null);
  assert.equal(await verifySession(cookie, SECRET, expiresAt + 1), null);
});

test("garbage of every shape comes back as null instead of throwing", async () => {
  const junk = [
    "",
    ".",
    "..",
    "a.b.c",
    "admin|123|deadbeef",
    "a.b.c.d",
    "a.b.c.d.e",
    // Right shape, role outside the closed set.
    "YWRtaW4.root.1787000000000.AAAA",
    // A number the signature check would never reach, but that a looser expiry
    // parse would happily read as "the year 30000".
    "YWRtaW4.admin.1e99.AAAA",
    "YWRtaW4.admin. 1.AAAA",
    "YWRtaW4.admin.-1.AAAA",
    "YWRtaW4.admin.99999999999999.!!!!",
    null,
    undefined,
    42,
    {},
    "<html>",
  ];
  for (const value of junk) {
    assert.equal(await verifySession(value, SECRET, NOW), null, `for ${JSON.stringify(value)}`);
  }
});

test("a missing secret locks everyone out instead of signing with nothing", async () => {
  const cookie = await signSession("admin", "admin", SECRET, { now: NOW });
  assert.equal(await verifySession(cookie, undefined, NOW), null);
  assert.equal(await verifySession(cookie, "", NOW), null);
  await assert.rejects(() => signSession("admin", "admin", "", { now: NOW }), AuthError);
});

test("signing refuses an empty user rather than minting an anonymous session", async () => {
  await assert.rejects(() => signSession("", "admin", SECRET, { now: NOW }), AuthError);
});

test("the credential comparison matches only on equality, whatever the lengths", async () => {
  assert.equal(await secureEquals("hunter2", "hunter2", SECRET), true);
  assert.equal(await secureEquals("hunter2", "hunter3", SECRET), false);
  assert.equal(await secureEquals("hunter", "hunter2", SECRET), false);
  assert.equal(await secureEquals("", "", SECRET), true);
  assert.equal(await secureEquals("hunter2", "hunter2", undefined), false);
  assert.equal(await secureEquals(undefined, undefined, SECRET), false);
});
