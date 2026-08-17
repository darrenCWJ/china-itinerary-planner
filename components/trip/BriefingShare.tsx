"use client";

import { useCallback, useEffect, useState } from "react";

type Props = {
  tripId: string;
  memberName: string;
};

type ShareState = { code: string | null; includeBookings: boolean };

export function BriefingShare({ tripId, memberName }: Props) {
  const [state, setState] = useState<ShareState>({ code: null, includeBookings: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!memberName) return;
    let live = true;
    fetch(`/api/trips/${tripId}/briefing`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ShareState | null) => {
        if (live && data) setState(data);
      })
      .catch(() => {
        // A failed read just leaves the controls in the "not shared" state.
      });
    return () => {
      live = false;
    };
  }, [tripId, memberName]);

  const send = useCallback(
    async (enabled: boolean, includeBookings: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/trips/${tripId}/briefing`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled, includeBookings }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? "Could not update the briefing link");
          return;
        }
        setState((await res.json()) as ShareState);
      } catch {
        setError("Could not reach the server");
      } finally {
        setBusy(false);
      }
    },
    [tripId]
  );

  if (!memberName) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--accent-ink)]/40 bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink-2)]">
        Join the trip to share this briefing.
      </p>
    );
  }

  const url = state.code ? `${window.location.origin}/b/${state.code}` : null;

  return (
    <div className="rounded-xl border border-[var(--line-1)] bg-[var(--surf-1)] p-4 print:hidden">
      {!state.code ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-[var(--ink-2)]">
            Share a read-only copy with people who are not joining the trip.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => send(true, false)}
            className="rounded-lg bg-[var(--accent-ink)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))] disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create share link"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-[var(--paper)] px-3 py-2 font-mono text-xs text-[var(--ink-0)]">
              {url}
            </code>
            <button
              type="button"
              onClick={() => {
                if (!url) return;
                navigator.clipboard.writeText(url).then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  },
                  () => setError("Copy failed — select the link and copy it manually")
                );
              }}
              className="rounded-lg bg-[var(--accent-ink)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--ink-2)]">
            <input
              type="checkbox"
              checked={state.includeBookings}
              disabled={busy}
              onChange={(e) => send(true, e.target.checked)}
            />
            Include confirmation numbers, prices and ticket notes
          </label>
          <p className="text-xs text-[var(--ink-2)]">
            Names and tick-offs are never shown on the shared link.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => send(false, false)}
            className="text-sm font-medium text-seal underline disabled:opacity-50"
          >
            Revoke link
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-seal">{error}</p>}
    </div>
  );
}
