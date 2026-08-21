"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BriefingShare } from "@/components/trip/BriefingShare";
import { BriefingView } from "@/components/trip/BriefingView";
import { buildBriefing } from "@/lib/briefing";
import { useShellTrip } from "./ShellTripContext";

/**
 * Share (spec §2.1): the briefing is an output you generate, not a room you
 * occupy, so it stops being a tab and becomes an action.
 *
 * Relocation only — the briefing's content is unchanged (§1 non-goals). The
 * panel holds the invite link and code, the public-briefing share controls, and
 * the briefing itself behind a disclosure, built with exactly the options the old
 * tab used.
 *
 * Reads `ShellTripContext` and fetches nothing of its own (C4). `BriefingShare`
 * does call a trip-scoped endpoint, but `/briefing` returns share state rather
 * than a TripPayload and is a declared exception to that contract.
 */
export function ShareMenu() {
  const trip = useShellTrip();
  const [open, setOpen] = useState(false);
  const [showBriefing, setShowBriefing] = useState(false);
  const [copied, setCopied] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const payload = trip?.payload;
  if (!payload) return null;

  const joinCode = payload.joinCode;
  const myName = payload.myMemberName;

  const copyInvite = async () => {
    if (!joinCode || trip === null) return;
    const url = `${window.location.origin}/trip/${trip.tripId}?code=${joinCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the code is shown below regardless.
    }
  };

  return (
    <div
      className="relative shrink-0 print:hidden"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="flex min-h-[var(--tap-min)] items-center gap-1 rounded-lg px-2 text-sm font-semibold"
        style={{ color: "var(--accent-ink)" }}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 16V4m0 0L8 8m4-4 4 4" />
          <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
        </svg>
        Share
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Share this trip"
          className="absolute right-0 z-20 mt-1 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-3 shadow-lg"
        >
          {joinCode && (
            <section>
              <p className="font-display text-sm font-semibold">Invite the crew</p>
              <button
                type="button"
                onClick={() => void copyInvite()}
                className="mt-1 flex min-h-[var(--tap-min)] w-full items-center justify-center rounded-lg border border-dashed border-[var(--accent-ink)]/50 px-3 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--line-1)]"
              >
                {copied ? "✓ Link copied" : "🔗 Copy invite link"}
              </button>
              <p className="mt-1 text-xs text-[var(--ink-2)]">
                Or have them enter code{" "}
                <span className="font-mono font-semibold tracking-widest text-[var(--seal)]">
                  {joinCode}
                </span>
                .
              </p>
            </section>
          )}

          {myName !== undefined && (
            <section className="mt-3 border-t border-[var(--line-1)] pt-2">
              <BriefingShare tripId={trip.tripId} memberName={myName} />
            </section>
          )}

          <section className="mt-3 border-t border-[var(--line-1)] pt-2">
            <button
              type="button"
              aria-expanded={showBriefing}
              onClick={() => setShowBriefing((shown) => !shown)}
              className="flex min-h-[var(--tap-min)] w-full items-center justify-between text-sm font-semibold"
            >
              View briefing
              <span aria-hidden>{showBriefing ? "▴" : "▾"}</span>
            </button>
            {showBriefing && (
              <div className="mt-2">
                {/*
                  The same options the old Briefing tab passed. Members see the
                  unredacted briefing with bookings; the redacted variant is what
                  /b/[code] serves to the public.
                */}
                <BriefingView
                  briefing={buildBriefing(payload, { redacted: false, includeBookings: true })}
                />
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
