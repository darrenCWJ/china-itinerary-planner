"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/authClient";

type Props = { mode: "login" | "signup" };

const safeNext = (value: string | null): string => {
  if (!value) return "/";
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
};

export function AuthForm({ mode }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "" on both server and first client render (no window access during
  // render, so no hydration mismatch); hydrates to the real search string
  // right after mount so the login/signup cross-link keeps ?next= intact.
  const [querySuffix, setQuerySuffix] = useState("");
  useEffect(() => {
    setQuerySuffix(window.location.search);
  }, []);

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
        ? // Route through the typed signUp.email proxy (not authClient.$fetch)
          // so its built-in onSuccess listener still fires $sessionSignal —
          // that's what makes every mounted useSession() consumer refetch
          // after signup. The typed body rejects the extra inviteCode key,
          // so it's smuggled in via the second (fetch-options) argument,
          // whose body type is intentionally Record<string, any> and gets
          // merged over the first argument's serialized body.
          await authClient.signUp.email(
            { email: email.trim(), password, name: name.trim() },
            {
              body: {
                email: email.trim(),
                password,
                name: name.trim(),
                inviteCode: inviteCode.trim(),
              },
            },
          )
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
    "mt-1 block w-full rounded-lg border border-[var(--line-1)] bg-[var(--surf-1)] px-3 py-2 text-sm text-[var(--ink-0)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ink)]";

  return (
    <div className="mx-auto mt-12 w-full max-w-sm rounded-2xl border border-[var(--line-1)] bg-[var(--paper)] p-6">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--accent-ink)]">
        {mode === "signup" ? "New traveller" : "Welcome back"}
      </p>
      <h1 className="mt-1 font-display text-2xl font-bold [text-wrap:balance]">
        {mode === "signup" ? "Create your account" : "Sign in"}
      </h1>
      {mode === "signup" && (
        <label className="mt-4 block text-xs font-medium text-[var(--ink-2)]">
          Your name (shown to trip members)
          <input type="text" value={name} maxLength={30} autoComplete="name" className={inputCls}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
        </label>
      )}
      {mode === "signup" && (
        <label className="mt-3 block text-xs font-medium text-[var(--ink-2)]">
          Family invite code
          <input type="text" value={inviteCode} maxLength={64} className={inputCls}
            autoComplete="off"
            onChange={(e) => setInviteCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
          <span className="mt-1 block text-[11px] font-normal text-[var(--ink-2)]">
            Ask the family for the code.
          </span>
        </label>
      )}
      <label className="mt-3 block text-xs font-medium text-[var(--ink-2)]">
        Email
        <input type="email" value={email} autoComplete="email" className={inputCls}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
      </label>
      <label className="mt-3 block text-xs font-medium text-[var(--ink-2)]">
        Password
        <input type="password" value={password}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className={inputCls} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
      </label>
      <button type="button" onClick={() => void submit()} disabled={busy}
        className="mt-5 w-full rounded-lg bg-[var(--accent-ink)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))] disabled:opacity-50">
        {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-[var(--seal)]">{error}</p>}
      <p className="mt-4 text-center text-xs text-[var(--ink-2)]">
        {mode === "signup" ? (
          <>Already have an account? <Link href={`/login${querySuffix}`} className="text-[var(--accent-ink)] hover:underline">Sign in</Link></>
        ) : (
          <>New here? <Link href={`/signup${querySuffix}`} className="text-[var(--accent-ink)] hover:underline">Create an account</Link></>
        )}
      </p>
      {mode === "login" && (
        <p className="mt-1 text-center text-[11px] text-[var(--ink-2)]">
          Forgot your password? Ask the trip admin to reset it.
        </p>
      )}
    </div>
  );
}
