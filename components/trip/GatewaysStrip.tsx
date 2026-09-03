"use client";

import { useState } from "react";
import type { TripGateways } from "@/lib/tripGateways";
import { AirportPicker } from "./AirportPicker";

interface Props {
  gateways: TripGateways;
  /** Members only. Absent for guests, who read the strip and cannot edit it. */
  onSave?: (gateways: TripGateways) => Promise<string | null>;
}

const BUTTON =
  "inline-flex min-h-[var(--tap-min)] items-center rounded-lg border border-[var(--line-1)] px-3 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]";
const PRIMARY =
  "inline-flex min-h-[var(--tap-min)] items-center rounded-lg bg-[var(--accent-ink)] px-3 text-xs font-semibold text-[var(--paper)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))] disabled:opacity-40";

/**
 * The airports the trip flies into and out of (spec §10.3), above the plan.
 *
 * A strip rather than a card: it is one line of fact, and it sits above the
 * day list because the day list is what it frames. Editing never touches the
 * plan — the save goes to /gateways, which writes `input` alone — so the
 * strip can be corrected mid-trip without a tick being lost.
 *
 * Codes, not names, on purpose: the strip is browser-side and has no airport
 * array to resolve a name from, and a code is what a boarding pass says.
 */
export function GatewaysStrip({ gateways, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TripGateways>(gateways);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Per side: the field holds text that names no airport.
   *
   * The picker reports `null` for "Jorge Chávez" exactly as it does for an
   * empty field, and saving that null would store "no arrival airport" —
   * dropping a code the trip already had, for a member whose only mistake was
   * tapping Save before picking from the list. Since the tap itself blurs the
   * field and closes the list, that is a very easy mistake to make and an
   * invisible one to notice.
   *
   * A list pick cannot strand this flag: the transient `onChange(null, text)`
   * that precedes it is fired in the same event as the pick, so both updates
   * land in one batch and the pick's `false` is the last word.
   */
  const [dangling, setDangling] = useState({ arrival: false, departure: false });
  const blocked = dangling.arrival || dangling.departure;

  const open = () => {
    setDraft(gateways);
    setDangling({ arrival: false, departure: false });
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (!onSave || saving || blocked) return;
    setSaving(true);
    setError(null);
    const err = await onSave(draft);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setEditing(false);
  };

  return (
    <section
      data-testid="gateways"
      aria-label="Gateway airports"
      className="rounded-lg border border-dashed border-[var(--line-1)] bg-[var(--paper)] px-4 py-2 text-sm text-[var(--ink-2)] print:hidden"
    >
      {editing && onSave ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-40 flex-1">
            <AirportPicker
              label="Arrive at"
              value={draft.arrival}
              onChange={(pick, text) => {
                setDraft((d) => ({ ...d, arrival: pick?.iata ?? null }));
                setDangling((f) => ({ ...f, arrival: pick === null && text.trim() !== "" }));
              }}
              allowBareCode
              placeholder="Lima or LIM"
            />
          </div>
          <div className="min-w-40 flex-1">
            <AirportPicker
              label="Depart from"
              value={draft.departure}
              onChange={(pick, text) => {
                setDraft((d) => ({ ...d, departure: pick?.iata ?? null }));
                setDangling((f) => ({ ...f, departure: pick === null && text.trim() !== "" }));
              }}
              allowBareCode
              placeholder="Cusco or CUZ"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || blocked}
              className={PRIMARY}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={BUTTON}>
              Cancel
            </button>
          </div>
          {blocked && (
            <p className="w-full text-xs text-[var(--ink-2)]">
              Pick an airport from the list, or type its 3-letter code.
            </p>
          )}
          {error && (
            <p role="status" className="w-full text-xs text-[var(--seal)]">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>
            <span aria-hidden>✈️ </span>
            {gateways.arrival ? (
              <>
                Fly in via <span className="font-mono font-semibold text-[var(--ink-0)]">{gateways.arrival}</span>
              </>
            ) : (
              "No arrival airport"
            )}
            {" · "}
            {gateways.departure ? (
              <>
                out via <span className="font-mono font-semibold text-[var(--ink-0)]">{gateways.departure}</span>
              </>
            ) : (
              "no departure airport"
            )}
          </p>
          {onSave && (
            <button type="button" onClick={open} className={BUTTON}>
              Edit gateways
            </button>
          )}
        </div>
      )}
    </section>
  );
}
