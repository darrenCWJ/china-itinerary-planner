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
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-8 text-center">
      <p className="font-display text-xl font-bold">This trip is private</p>
      <p className="mt-2 text-sm text-[var(--ink-2)]">
        Enter its join code to view the plan. Members sign in to edit.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <input type="text" value={code} maxLength={12} aria-label="Join code"
          className="w-40 rounded-lg border border-[var(--line-1)] bg-[var(--surf-1)] px-3 py-2 text-center font-mono text-sm tracking-widest uppercase"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
        <button type="button" onClick={() => void submit()} disabled={busy}
          className="rounded-lg bg-[var(--accent-ink)] px-4 py-2 text-sm font-semibold text-[var(--paper)] disabled:opacity-50">
          {busy ? "…" : "View trip"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--seal)]">{error}</p>}
    </div>
  );
}
