"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/authClient";

type Props = { mode: "login" | "signup" };

const safeNext = (value: string | null): string =>
  value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";

export function AuthForm({ mode }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (mode === "signup" && !name.trim()) return setError("Enter your name.");
    if (!email.trim() || !password) return setError("Enter your email and password.");
    if (mode === "signup" && password.length < 8) {
      return setError("Password needs at least 8 characters.");
    }
    setBusy(true);
    const result =
      mode === "signup"
        ? await authClient.signUp.email({ email: email.trim(), password, name: name.trim() })
        : await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "That didn't work — try again.");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    router.push(safeNext(next));
    router.refresh();
  };

  const inputCls =
    "mt-1 block w-full rounded-lg border border-sky bg-mist px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-rail";

  return (
    <div className="mx-auto mt-12 w-full max-w-sm rounded-2xl border border-sky bg-paper p-6">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-rail">
        {mode === "signup" ? "New traveller" : "Welcome back"}
      </p>
      <h1 className="mt-1 font-display text-2xl font-bold">
        {mode === "signup" ? "Create your account" : "Sign in"}
      </h1>
      {mode === "signup" && (
        <label className="mt-4 block text-xs font-medium text-ink-soft">
          Your name (shown to trip members)
          <input type="text" value={name} maxLength={30} className={inputCls}
            onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <label className="mt-3 block text-xs font-medium text-ink-soft">
        Email
        <input type="email" value={email} autoComplete="email" className={inputCls}
          onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="mt-3 block text-xs font-medium text-ink-soft">
        Password
        <input type="password" value={password}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className={inputCls} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
      </label>
      <button type="button" onClick={() => void submit()} disabled={busy}
        className="mt-5 w-full rounded-lg bg-rail px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rail-deep disabled:opacity-50">
        {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
      {error && <p className="mt-2 text-xs text-seal">{error}</p>}
      <p className="mt-4 text-center text-xs text-ink-soft">
        {mode === "signup" ? (
          <>Already have an account? <Link href="/login" className="text-rail hover:underline">Sign in</Link></>
        ) : (
          <>New here? <Link href="/signup" className="text-rail hover:underline">Create an account</Link></>
        )}
      </p>
      {mode === "login" && (
        <p className="mt-1 text-center text-[11px] text-ink-soft">
          Forgot your password? Ask the trip admin to reset it.
        </p>
      )}
    </div>
  );
}
