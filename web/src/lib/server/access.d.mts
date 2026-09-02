/** Types for access.mjs, which is JavaScript for the same reasons as
 *  session.mjs — edge runtime, and unit tests without a compile step. */

import type { Session } from "./session.mjs";

export declare function isInvoiceSettlement(pathname: string, method: string): boolean;

export declare function mayAccess(
  session: Session | null | undefined,
  pathname: string,
  method: string,
): boolean;
