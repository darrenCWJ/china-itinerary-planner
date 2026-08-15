"use client";

import { useState } from "react";

type Props = {
  claimable: string[];
  /** Legacy name this device used pre-accounts, if any — preselected. */
  legacyName: string | null;
  onJoin: (claimName: string | null) => Promise<string | null>;
};

/** "NEW" sentinel = join as a fresh member under the account's name. */
export function JoinClaimDialog({ claimable, legacyName, onJoin }: Props) {
  const initial = legacyName && claimable.includes(legacyName) ? legacyName : "NEW";
  const [choice, setChoice] = useState<string>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    setError(null);
    const err = await onJoin(choice === "NEW" ? null : choice);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="mt-6 rounded-xl border-2 border-dashed border-seal/50 bg-paper p-5">
      <h2 className="font-display text-lg font-semibold">Join this trip</h2>
      {claimable.length > 0 && (
        <>
          <p className="mt-1 text-sm text-ink-soft">
            Were you already on this trip before accounts? Claim your old name to keep
            everything you ticked, spent and wrote.
          </p>
          <div className="mt-3 space-y-1.5">
            {claimable.map((name) => (
              <label key={name} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name="claim" checked={choice === name}
                  onChange={() => setChoice(name)} className="accent-rail" />
                I am <span className="font-semibold">{name}</span>
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="claim" checked={choice === "NEW"}
                onChange={() => setChoice("NEW")} className="accent-rail" />
              I&apos;m new — join under my account name
            </label>
          </div>
        </>
      )}
      <button type="button" onClick={() => void join()} disabled={busy}
        className="mt-4 rounded-lg bg-seal px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? "Joining…" : "Join trip"}
      </button>
      {error && <span className="ml-3 text-xs text-seal">{error}</span>}
    </div>
  );
}
