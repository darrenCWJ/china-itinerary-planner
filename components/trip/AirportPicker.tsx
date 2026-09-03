"use client";

import { useRef, useState } from "react";
import type { Airport } from "@/lib/airports";
import { IATA_CODE } from "@/lib/tripGateways";
import { AirportInput } from "./AirportInput";

/** What the picker reports: a code, and the airport behind it when one was chosen from the list. */
export interface AirportPick {
  iata: string;
  /** Null for a bare typed code — known by code only, with no coordinates to anchor on. */
  airport: Airport | null;
}

interface Props {
  label: string;
  /**
   * The current code, or null for none. Drives the text until the user
   * types; a new code from the parent replaces it.
   */
  value: string | null;
  /**
   * Fires on every change: `pick` is null while the text names no airport,
   * and `text` is what the field now holds.
   *
   * The second argument is what tells an empty field apart from one holding
   * "Jorge Chávez" — both report a null pick, and only one of them means the
   * traveller wants no gateway. A caller that only needs the code may take
   * one parameter and ignore it.
   */
  onChange: (pick: AirportPick | null, text: string) => void;
  /**
   * Accept a bare three-letter code typed without a list pick. The trip page
   * allows it (the server refuses a code the artifact lacks); the wizard does
   * not, because a bare code has no coordinates to anchor the route on (D3).
   */
  allowBareCode?: boolean;
  placeholder?: string;
}

/**
 * `AirportInput` yields display text — "Name (LIM)" — because tickets store
 * free text. A gateway is a CODE, so this wrapper owns the text and reports
 * the code behind it: the picked airport's, or, when allowed, a bare typed
 * one.
 *
 * The report is re-derived from the text on every change; a list pick is the
 * only path that carries an `airport`. So editing the text after a pick
 * drops the pick by construction — there is no separate "was this picked"
 * flag that could fall out of sync with what the text actually says. (A list
 * pick does deliver one transient `onChange(null, displayString)` immediately
 * before the pick — from `AirportInput`'s own `onChange` of the display
 * string, fired in the same event as the pick itself. Harmless for a parent
 * that only sets state, since both calls land in one batch and the pick is
 * the last word; worth knowing for one that does work per call.)
 */
export function AirportPicker({ label, value, onChange, allowBareCode = false, placeholder }: Props) {
  const [text, setText] = useState(value ?? "");
  // The text as of the latest change, for the one reader that runs in the
  // same event as the change that set it: `AirportInput.pick` fires its
  // `onChange` (the display string) and then `onPick`, so by the time
  // `onPick` reports, `text` state is still the pre-pick render's value and
  // only a ref carries the string the field actually now holds.
  const textRef = useRef(value ?? "");
  // Mirrors `value` so the block below can tell "the parent just changed
  // value" apart from "report() just moved `reported` ahead of value, and
  // the parent's own re-render (which would bring value back level with it)
  // just hasn't happened yet". report() runs from an event handler, so its
  // setReported is visible to the very next render — comparing `value`
  // straight against `reported` there would treat that ordinary lag as if
  // the parent had authored a change, and stomp the text mid-edit.
  const [prevValue, setPrevValue] = useState(value);
  // The code this picker last reported upward, or was last handed. When
  // `value` transitions to something other than what was reported, the
  // parent is the author of the change (an async load, a reverted save) and
  // the text follows it; when the transition merely lands on what was
  // reported, the user's text stays.
  const [reported, setReported] = useState<string | null>(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (value !== reported) {
      setReported(value);
      setText(value ?? "");
    }
  }

  const report = (pick: AirportPick | null, next: string) => {
    setReported(pick?.iata ?? null);
    onChange(pick, next);
  };

  const onText = (next: string) => {
    textRef.current = next;
    setText(next);
    const code = next.trim().toUpperCase();
    if (code === "") {
      report(null, next);
      return;
    }
    if (allowBareCode && IATA_CODE.test(code)) {
      report({ iata: code, airport: null }, next);
      return;
    }
    report(null, next);
  };

  const onPick = (airport: Airport) => {
    report({ iata: airport.iata, airport }, textRef.current);
  };

  return (
    <AirportInput label={label} value={text} onChange={onText} onPick={onPick} placeholder={placeholder} />
  );
}
