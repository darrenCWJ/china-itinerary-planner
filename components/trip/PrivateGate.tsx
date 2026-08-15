"use client";

import { useState } from "react";

type Props = { onSubmitCode: (code: string) => Promise<string | null> };

export function PrivateGate({ onSubmitCode }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!code.trim()) return setError("Enter the join code.");
    setBusy(true);
    setError(null);
    const err = await onSubmitCode(code.trim());
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-sky bg-paper p-8 text-center">
      <p className="font-display text-xl font-bold">This trip is private</p>
      <p className="mt-2 text-sm text-ink-soft">
        Enter its join code to view the plan. Members sign in to edit.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <input type="text" value={code} maxLength={12} aria-label="Join code"
          className="w-40 rounded-lg border border-sky bg-mist px-3 py-2 text-center font-mono text-sm tracking-widest uppercase"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
        <button type="button" onClick={() => void submit()} disabled={busy}
          className="rounded-lg bg-rail px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "…" : "View trip"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-seal">{error}</p>}
    </div>
  );
}
