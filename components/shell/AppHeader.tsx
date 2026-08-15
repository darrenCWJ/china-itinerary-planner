"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountChip } from "@/components/auth/AccountChip";

const NAV = [
  { href: "/", label: "Trips" },
  { href: "/plan", label: "Plan a trip" },
] as const;

/**
 * The boarding-pass strip: brand, section nav, account chip. Hidden on auth
 * pages and public briefings, which stay chrome-free.
 */
export function AppHeader() {
  const pathname = usePathname();
  if (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname.startsWith("/b/")
  ) {
    return null;
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="bg-paper print:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex min-h-10 items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-seal font-kai text-xl text-white">
            游
          </span>
          <span className="font-display text-lg font-bold leading-tight">
            China Itinerary Planner
          </span>
        </Link>
        <nav aria-label="Sections" className="flex items-center gap-1 sm:gap-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`flex min-h-10 items-center rounded-lg px-3 text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? "bg-sky text-rail-deep"
                  : "text-ink-soft hover:bg-mist hover:text-rail"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <div className="ml-1 sm:ml-2">
            <AccountChip />
          </div>
        </nav>
      </div>
      <div aria-hidden className="border-b-2 border-dashed border-sky" />
    </header>
  );
}
