"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/authClient";

/** Header chip: initial avatar → menu. Renders a sign-in link when logged out. */
export function AccountChip() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on Escape and on click-outside — only while the menu is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  if (isPending) return null;
  if (!session) {
    return (
      <Link href="/login"
        className="flex min-h-10 items-center rounded-lg border border-sky bg-paper px-3 text-sm font-medium text-rail transition-colors hover:bg-sky">
        Sign in
      </Link>
    );
  }

  const initial = (session.user.name || session.user.email)[0]?.toUpperCase() ?? "?";
  return (
    <div className="relative" ref={menuRef}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${session.user.name}`}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-rail font-semibold text-white">
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-sky bg-paper p-1.5 text-sm shadow-lg">
          <p className="truncate px-2.5 py-1.5 text-xs text-ink-soft">{session.user.email}</p>
          <Link href="/" role="menuitem" className="flex min-h-10 items-center rounded-lg px-2.5 transition-colors hover:bg-mist"
            onClick={() => setOpen(false)}>
            My trips
          </Link>
          <Link href="/account" role="menuitem" className="flex min-h-10 items-center rounded-lg px-2.5 transition-colors hover:bg-mist"
            onClick={() => setOpen(false)}>
            Account
          </Link>
          <button type="button" role="menuitem" disabled={signingOut}
            className="flex min-h-10 w-full items-center rounded-lg px-2.5 text-left text-seal transition-colors hover:bg-mist disabled:opacity-50"
            onClick={() => {
              setSigningOut(true);
              void authClient.signOut().then(() => {
                setOpen(false);
                router.push("/");
                router.refresh();
              }).catch(() => setSigningOut(false));
            }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
