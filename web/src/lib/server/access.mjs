/**
 * Who may do what, as a pure function of the role and the request line.
 *
 * Plain ESM next door to `session.mjs`, for the same two reasons: `middleware.ts`
 * is bundled for the edge runtime, and `node --test` has to be able to import
 * this without a compile step. Nothing here reads a cookie, a header or an env
 * var — it is handed the role that the signed session already produced, so the
 * rule below can be read and tested on its own.
 */

/**
 * The one door the client key does not open: **settling** an invoice.
 *
 * Everything else is shared. The client works in the studio, reads the ledger —
 * which is the history of what has been sent — and issues invoices for it. The
 * single thing reserved is the claim that a bill has been PAID, because that is
 * the record that closes the money, it has no undo anywhere in this UI, and
 * nothing downstream re-checks it.
 *
 * Matched on method AND path rather than on a path prefix, which is what lets
 * the invoice documents stay open: `GET /api/invoices/INV-202609-01` is the
 * printable document and both roles need it; `PATCH` on that same URL is the
 * payment. A prefix rule cannot tell those two apart, which is exactly why the
 * previous version of this had to lock the whole billing section away.
 *
 * The route behind it accepts no other transition — `state` must be `"paid"` —
 * so "a PATCH here" and "a payment" are the same statement, and this stays true
 * as long as that remains the only PATCH the invoice API answers.
 */
const INVOICE_ID_PATH = /^\/api\/invoices\/[^/]+\/?$/;

export function isInvoiceSettlement(pathname, method) {
  return String(method ?? "").toUpperCase() === "PATCH" && INVOICE_ID_PATH.test(String(pathname ?? ""));
}

/**
 * The whole policy, in one place. No session at all is a "no" here too, so a
 * caller cannot accidentally read a missing session as an allowed one — the
 * middleware still handles the unauthenticated case separately, because a
 * missing cookie deserves a 401 and a login redirect rather than a 403.
 */
export function mayAccess(session, pathname, method) {
  if (!session) return false;
  if (session.role === "admin") return true;
  return !isInvoiceSettlement(pathname, method);
}
