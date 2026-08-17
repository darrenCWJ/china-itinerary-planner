"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useShellTrip } from "./ShellTripContext";

/**
 * Crew in the header (spec §2.1): membership is ambient context, not a page.
 *
 * The trigger is the crew itself — overlapping initials, so who is on the trip is
 * readable without opening anything. The popover carries the member list and the
 * invite block, both moved from the retired Crew tab.
 *
 * Reads `ShellTripContext` and fetches nothing (C4): the trip page owns the one
 * accessor call, and a header widget with its own fetch would poll the trip a
 * second time (J3).
 *
 * Hand-built rather than `<details>`, unlike the two menus in Task 4, because
 * this one has a keyboard contract worth honouring: Esc closes it and returns
 * focus to the trigger, which native disclosure does not do.
 */

/** Beyond this, initials stop being readable and become a smear. */
const MAX_AVATARS = 4;

export function CrewMenu() {
  const trip = useShellTrip();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Returning focus is the whole reason this is not a <details>: closing with
    // Esc must not drop the caret at the top of the document.
    triggerRef.current?.focus();
  }, []);

  // Pointer-down rather than click: a click that starts inside and ends outside
  // would otherwise close the menu mid-interaction.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const payload = trip?.payload;
  if (!payload) return null;

  const members = payload.members;
  const myName = payload.myMemberName;
  const joinCode = payload.joinCode;
  const shown = members.slice(0, MAX_AVATARS);
  const overflow = members.length - shown.length;

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
        aria-label={`Crew — ${members.length} member${members.length === 1 ? "" : "s"}`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        // min-w as well as min-h: with one member the trigger is a single 28px
        // avatar plus padding — about 36px, under C5's 44px — and a trip has
        // exactly one member the moment it is created. The other two icon
        // triggers (ThemeToggle, TripSwitcher) already set both.
        className="flex min-h-[var(--tap-min)] min-w-[var(--tap-min)] items-center justify-center rounded-lg px-1"
      >
        <span className="flex items-center">
          {shown.map((member, index) => (
            <span
              key={member.name}
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--paper)] bg-[var(--line-1)] text-xs font-semibold text-[var(--accent-ink)]"
              style={index > 0 ? { marginLeft: "-0.5rem" } : undefined}
            >
              {member.name[0]?.toUpperCase()}
            </span>
          ))}
          {overflow > 0 && (
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--paper)] bg-[var(--surf-1)] text-[10px] font-semibold text-[var(--ink-2)]"
              style={{ marginLeft: "-0.5rem" }}
            >
              +{overflow}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Crew"
          className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-3 shadow-lg"
        >
          <p className="font-display text-sm font-semibold">Crew ({members.length})</p>
          <ul className="mt-2 space-y-2">
            {members.map((member) => (
              <li key={member.name} className="flex items-center gap-2 text-sm">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--line-1)] text-xs font-semibold text-[var(--accent-ink)]">
                  {member.name[0]?.toUpperCase()}
                </span>
                <span className="truncate font-medium">{member.name}</span>
                {member.name === myName && (
                  <span className="rounded bg-[var(--line-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--accent-ink)]">
                    YOU
                  </span>
                )}
                <span className="ml-auto shrink-0 text-xs text-[var(--ink-2)]">
                  joined {new Date(member.joinedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>

          {joinCode && (
            <div className="mt-3 border-t border-[var(--line-1)] pt-2 text-sm">
              <p className="font-semibold">Invite more people</p>
              <button
                type="button"
                onClick={() => void copyInvite()}
                className="mt-1 flex min-h-[var(--tap-min)] w-full items-center justify-center rounded-lg border border-dashed border-[var(--accent-ink)]/50 px-3 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--line-1)]"
              >
                {copied ? "✓ Link copied" : "🔗 Copy invite link"}
              </button>
              <p className="mt-1 text-xs text-[var(--ink-2)]">
                Or have them enter code{" "}
                <span className="font-mono font-semibold tracking-widest text-seal">
                  {joinCode}
                </span>
                .
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
