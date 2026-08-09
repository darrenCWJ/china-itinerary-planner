"use client";

import { useState } from "react";
import { safeNextPath } from "@/lib/access";

export function UnlockForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || checking) return;
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setError(json.error ?? "That access code isn't right");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = safeNextPath(next);
    } catch {
      setError("Couldn't reach the server — try again");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="relative overflow-visible rounded-2xl border border-sky bg-paper p-8 text-center shadow-sm">
          <span aria-hidden className="seal-round absolute -right-4 -top-4 bg-paper">
            通行
          </span>
          <span aria-hidden className="text-4xl">
            🏮
          </span>
          <h1 className="mt-3 font-display text-2xl font-bold">China Itinerary Planner</h1>
          <p className="mt-2 text-sm text-ink-soft">
            This planner is invite-only. Enter the access code you were given to come
            aboard.
          </p>
          <form onSubmit={unlock} className="mt-5">
            <label htmlFor="access-code" className="sr-only">
              Access code
            </label>
            <input
              id="access-code"
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Access code"
              autoFocus
              autoComplete="off"
              className="w-full rounded-lg border border-sky bg-mist px-4 py-2.5 text-center font-mono tracking-widest focus-visible:outline-2 focus-visible:outline-rail"
            />
            <button
              type="submit"
              disabled={checking || code.trim().length === 0}
              className="mt-3 w-full rounded-lg bg-rail px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rail-deep disabled:opacity-40"
            >
              {checking ? "Checking…" : "Unlock →"}
            </button>
          </form>
          {error && (
            <p role="alert" className="mt-3 text-sm text-seal">
              {error}
            </p>
          )}
        </div>
        <p className="mt-4 text-center font-kai text-seal">一路平安</p>
      </div>
    </div>
  );
}
