"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/authClient";

/** Header chip: initial avatar → menu. Renders a sign-in link when logged out. */
export function AccountChip() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (isPending) return null;
  if (!session) {
    return (
      <Link href="/login"
        className="rounded-lg border border-sky bg-paper px-3 py-1.5 text-sm font-medium text-rail hover:bg-sky">
        Sign in
      </Link>
    );
  }

  const initial = (session.user.name || session.user.email)[0]?.toUpperCase() ?? "?";
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        aria-label={`Account menu for ${session.user.name}`}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-rail font-semibold text-white">
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-sky bg-paper p-1.5 text-sm shadow-lg">
          <p className="truncate px-2.5 py-1.5 text-xs text-ink-soft">{session.user.email}</p>
          <Link href="/" className="block rounded-lg px-2.5 py-1.5 hover:bg-mist"
            onClick={() => setOpen(false)}>
            My trips
          </Link>
          <Link href="/account" className="block rounded-lg px-2.5 py-1.5 hover:bg-mist"
            onClick={() => setOpen(false)}>
            Account
          </Link>
          <button type="button" disabled={signingOut}
            className="block w-full rounded-lg px-2.5 py-1.5 text-left text-seal hover:bg-mist disabled:opacity-50"
            onClick={() => {
              setSigningOut(true);
              void authClient.signOut().then(() => {
                setOpen(false);
                router.push("/");
                router.refresh();
              });
            }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
