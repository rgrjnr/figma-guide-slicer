"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Estúdio" },
  { href: "/campaigns", label: "Campanhas" },
  { href: "/invoices", label: "Faturas" },
];

/**
 * The app was one route until billing arrived, so this is the first navigation
 * it has ever had. It lives in the layout because the ledger and the invoices
 * are siblings of the studio, not steps inside it — the pill rail under the
 * studio's header is wizard progress and must not be confused with this.
 *
 * A client component because the current item and the login exception both need
 * the path, and a layout is a server component: `metadata` cannot be exported
 * from a client module, so the layout stays on the server and only this strip
 * ships to the browser.
 */
export function AppNav() {
  const pathname = usePathname();

  // The lock on the door has no way in if the door is decorated with links to
  // rooms behind it; /login renders its own bare header instead.
  if (pathname === "/login") return null;

  // The studio is the only exact match: everything under /invoices, including
  // /invoices/<id>, should keep Faturas lit.
  const current = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav className="site-nav">
      {ITEMS.map(item => (
        <Link key={item.href} href={item.href} className={current(item.href) ? "current" : ""}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
