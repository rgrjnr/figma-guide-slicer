import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/server/auth";

/**
 * The lock on the door (PLAN-BILLING.md phase C). One shared credential, so
 * there is nothing to check here beyond "is this cookie one we signed, and is
 * the expiry inside it still in the future".
 *
 * Middleware always runs on the edge runtime, which has no `node:crypto`; the
 * verification underneath is Web Crypto for exactly that reason.
 *
 * There is deliberately no `AUTH_DISABLED` escape hatch. A bypass flag would
 * ship in the production bundle, and its failure mode is silent — one stray
 * line in a `.env` on the box and the only lock in the app is open with nothing
 * rendering or logging differently. The e2e suites get in by signing in for
 * real and reusing the cookie (see `e2e/helpers.mjs`), which means the gate is
 * knowledge of ADMIN_PASSWORD rather than the value of a variable, and it also
 * means every browser suite is a smoke test for this file.
 */
export async function middleware(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(cookie, process.env.SESSION_SECRET);
  if (session) return NextResponse.next();

  const { pathname, search } = request.nextUrl;

  /**
   * An unauthenticated API call must be a 401 with a JSON body, never a
   * redirect. `src/lib/projects.ts` and `page.tsx` both `await response.json()`
   * unconditionally, so a 307 landing on the HTML login page turns a clean
   * "you are logged out" into `SyntaxError: Unexpected token '<'` thrown from a
   * random component — an error that says nothing about what went wrong.
   */
  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  }

  /**
   * A page, on the other hand, redirects — which incidentally keeps the e2e
   * runner's liveness probe working: `run-all.mjs` decides a server is up from
   * `response.ok`, and `fetch` follows redirects, so `GET /` lands on `/login`
   * with a 200. A 401 here would make it conclude the port was dead and start
   * a second dev server on top of the first.
   */
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  /**
   * What is let through, and why each one:
   *
   * - `_next/` in full, not just `_next/static`. Locking the chunks out would
   *   serve an unstyled, non-interactive login page; and `_next/webpack-hmr`
   *   sits outside `_next/static`, so a narrower rule breaks fast refresh on
   *   the one page you are allowed to see while logged out.
   * - `tesseract/` because OCR loads its worker, wasm and traineddata from
   *   `public/tesseract/` — `scripts/copy-tesseract.mjs` exists precisely so it
   *   does not depend on a CDN. Those requests would carry the cookie anyway
   *   once signed in, but 401-ing them fails in a way that looks nothing like
   *   auth, and this makes that impossible rather than unlikely.
   * - `login` and `api/auth`, or there is no way to ever get a cookie.
   * - `favicon.ico`, so the tab is not a broken icon on the login screen.
   */
  matcher: ["/((?!_next/|tesseract/|favicon.ico|login|api/auth).*)"],
};
