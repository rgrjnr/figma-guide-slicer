// The role rule on its own: no server, no cookies, no Next. `access.mjs` is
// plain ESM precisely so this file can import it directly.
import test from "node:test";
import assert from "node:assert/strict";
import { isInvoiceSettlement, mayAccess } from "../src/lib/server/access.mjs";

const admin = { user: "spicycomm", role: "admin", expiresAt: Date.now() + 1000 };
const client = { user: "cliente", role: "client", expiresAt: Date.now() + 1000 };

/** Everything the client is explicitly meant to reach. */
const OPEN = [
  ["GET", "/"],
  ["GET", "/campaigns"],
  ["GET", "/api/campaigns"],
  ["POST", "/api/campaigns"],
  ["GET", "/invoices"],
  ["GET", "/invoices/new"],
  ["GET", "/api/invoices"],
  // Issuing an invoice — the client bills for its own work.
  ["POST", "/api/invoices"],
  // The printable document, same URL as the payment but a different method.
  ["GET", "/api/invoices/INV-202609-01"],
  ["GET", "/invoices/INV-202609-01"],
  ["POST", "/api/braze/run"],
  ["PATCH", "/api/projects/abc"],
];

test("the client key opens everything except settling an invoice", () => {
  for (const [method, path] of OPEN) {
    assert.equal(mayAccess(client, path, method), true, `${method} ${path} should be open to the client`);
  }
  assert.equal(mayAccess(client, "/api/invoices/INV-202609-01", "PATCH"), false);
});

test("the admin key opens the payment too", () => {
  for (const [method, path] of [...OPEN, ["PATCH", "/api/invoices/INV-202609-01"]]) {
    assert.equal(mayAccess(admin, path, method), true, `${method} ${path} should be open to the admin`);
  }
});

test("no session is a no, whatever the path", () => {
  assert.equal(mayAccess(null, "/", "GET"), false);
  assert.equal(mayAccess(undefined, "/api/campaigns", "GET"), false);
});

test("the settlement rule keys on method and on the id segment, not on a prefix", () => {
  assert.equal(isInvoiceSettlement("/api/invoices/INV-202609-01", "PATCH"), true);
  // A trailing slash is the same URL to Next; it must not be a way past.
  assert.equal(isInvoiceSettlement("/api/invoices/INV-202609-01/", "PATCH"), true);
  // Lower case reaches middleware only through a non-browser client, but the
  // rule must not care.
  assert.equal(isInvoiceSettlement("/api/invoices/INV-202609-01", "patch"), true);

  assert.equal(isInvoiceSettlement("/api/invoices/INV-202609-01", "GET"), false);
  // The collection itself has no PATCH; if one is ever added it is not a
  // payment, and this is the assertion that will say so.
  assert.equal(isInvoiceSettlement("/api/invoices", "PATCH"), false);
  // Nothing deeper than the id is the invoice's own resource.
  assert.equal(isInvoiceSettlement("/api/invoices/INV-202609-01/lines", "PATCH"), false);
  // A path that merely starts with the same characters is a different route.
  assert.equal(isInvoiceSettlement("/api/invoices-export/x", "PATCH"), false);
});

test("garbage in the request line is refused rather than thrown on", () => {
  assert.equal(isInvoiceSettlement(undefined, undefined), false);
  assert.equal(mayAccess(client, undefined, undefined), true);
});
