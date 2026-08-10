"use client";

import { useEffect, useState } from "react";
import type { MyTrip } from "@/lib/myTrips";
import {
  clearWalletCode,
  createWalletFromLocal,
  linkWallet,
  loadWalletCode,
} from "@/lib/walletSync";

interface SyncDevicesProps {
  /** Called with the merged list after a successful link. */
  onSynced: (trips: MyTrip[]) => void;
}

/**
 * Opt-in cross-device sync control: create a sync code on this device, or
 * paste one from another device to link them. Renders as a single quiet row.
 */
export function SyncDevices({ onSynced }: SyncDevicesProps) {
  const [code, setCode] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [justCreated, setJustCreated] = useState(false);

  useEffect(() => {
    setCode(loadWalletCode());
    setHydrated(true);
  }, []);

  if (!hydrated) return null;

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the code is visible to copy by hand.
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    const result = await createWalletFromLocal();
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setCode(result.code);
    setJustCreated(true);
  };

  const link = async () => {
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    const result = await linkWallet(input);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCode(input.trim().toUpperCase());
    setOpen(false);
    onSynced(result.trips);
  };

  const unlink = () => {
    clearWalletCode();
    setCode(null);
    setOpen(false);
    setJustCreated(false);
    setInput("");
    setError(null);
  };

  if (code) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-rail/40 bg-paper px-3 py-2 text-xs text-ink-soft print:hidden">
        <span>🔗 Synced across devices</span>
        <span className="font-mono font-semibold tracking-widest text-rail-deep">{code}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded px-1.5 py-0.5 font-semibold text-rail transition-colors hover:bg-sky"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
        <button
          type="button"
          onClick={unlink}
          title="Only forgets the code on this device"
          className="rounded px-1.5 py-0.5 text-ink-soft transition-colors hover:bg-sky hover:text-seal"
        >
          Unlink
        </button>
        {justCreated && (
          <span className="basis-full text-[11px]">
            Enter this code under “Sync devices” on your other device to see the same trips there.
          </span>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 rounded-lg border border-dashed border-rail/40 px-3 py-1.5 text-xs font-semibold text-rail transition-colors hover:bg-sky print:hidden"
      >
        🔗 Sync devices — see these trips on your phone too
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-rail/40 bg-paper p-3 text-xs print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy}
          className="rounded-lg bg-rail px-3 py-1.5 font-semibold text-white transition-colors hover:bg-rail-deep disabled:opacity-40"
        >
          {busy ? "Working…" : "Create sync code"}
        </button>
        <span className="text-ink-soft">or</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste a code from another device"
          maxLength={20}
          className="w-56 rounded-lg border border-sky bg-paper px-3 py-1.5 font-mono uppercase tracking-widest text-ink focus-visible:outline-2 focus-visible:outline-rail"
        />
        <button
          type="button"
          onClick={() => void link()}
          disabled={busy || !input.trim()}
          className="rounded-lg border border-rail px-3 py-1.5 font-semibold text-rail transition-colors hover:bg-sky disabled:opacity-40"
        >
          Link
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-2 py-1.5 text-ink-soft transition-colors hover:bg-sky"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 text-seal">{error}</p>}
    </div>
  );
}
