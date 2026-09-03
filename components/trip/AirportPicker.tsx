"use client";

import { useState } from "react";
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
  /** The current code, or null for none. Shown as the field's text until the user types. */
  value: string | null;
  /** Fires on every change: null while the text names no airport. */
  onChange: (pick: AirportPick | null) => void;
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
 * one. Editing the text after a pick drops the pick, because the text no
 * longer says what was picked.
 */
export function AirportPicker({ label, value, onChange, allowBareCode = false, placeholder }: Props) {
  const [text, setText] = useState(value ?? "");
  const [pickedText, setPickedText] = useState<string | null>(null);

  const onText = (next: string) => {
    setText(next);
    if (pickedText !== null && next !== pickedText) setPickedText(null);
    const code = next.trim().toUpperCase();
    if (code === "") {
      onChange(null);
      return;
    }
    if (allowBareCode && IATA_CODE.test(code)) {
      onChange({ iata: code, airport: null });
      return;
    }
    onChange(null);
  };

  const onPick = (airport: Airport) => {
    setPickedText(`${airport.name} (${airport.iata})`);
    onChange({ iata: airport.iata, airport });
  };

  return (
    <AirportInput label={label} value={text} onChange={onText} onPick={onPick} placeholder={placeholder} />
  );
}
