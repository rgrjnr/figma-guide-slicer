/** Types for session.mjs, which is JavaScript so that Node 20 can unit-test it
 *  and so that the edge runtime can import it from middleware. */

export type Role = "admin" | "client";

export interface Session {
  user: string;
  role: Role;
  /** Epoch milliseconds, read out of the signed payload. */
  expiresAt: number;
}

export declare const SESSION_COOKIE: string;
export declare const SESSION_TTL_MS: number;
export declare const ROLES: readonly Role[];
export declare class AuthError extends Error {}

export declare function signSession(
  user: string,
  role: Role,
  secret: string,
  options?: { now?: number; ttlMs?: number },
): Promise<string>;

export declare function verifySession(
  value: string | undefined | null,
  secret: string | undefined,
  now?: number,
): Promise<Session | null>;

export declare function secureEquals(a: string, b: string, secret: string | undefined): Promise<boolean>;
