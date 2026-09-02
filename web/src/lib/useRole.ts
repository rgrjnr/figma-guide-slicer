"use client";

import { useEffect, useState } from "react";
import type { Role } from "@/lib/server/session.mjs";

/**
 * The role the login handed out, read from the readable `studio_role` cookie.
 *
 * It decides what to DRAW and never what is allowed: enforcement reads the
 * signed session cookie in the middleware, so editing this one buys a button
 * that answers 403. `null` means "not read yet" — the server render has no
 * `document`, so the effect is the first chance to know — and every caller
 * treats that as "not admin", which is the safe way round for a control that
 * only appears for the admin.
 *
 * A `import type` so nothing from `session.mjs` reaches the browser bundle.
 */
export function useRole(): Role | null {
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    const match = /(?:^|;\s*)studio_role=(admin|client)(?:;|$)/.exec(document.cookie);
    setRole(match ? (match[1] as Role) : null);
  }, []);

  return role;
}
