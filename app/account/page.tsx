"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/authClient";

export default function AccountPage() {
  const { data: session, isPending } = authClient.useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Admin reset state
  const [users, setUsers] = useState<{ id: string; email: string; name: string }[] | null>(null);
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);

  if (isPending) return <main className="p-8 text-sm text-ink-soft">Loading…</main>;
  if (!session) {
    return (
      <main className="p-8">
        <Link href="/login" className="text-rail hover:underline">Sign in</Link> to manage your account.
      </main>
    );
  }

  const changePassword = async () => {
    if (newPassword.length < 8) return setMessage("New password needs at least 8 characters.");
    setBusy(true);
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setBusy(false);
    setMessage(result.error ? result.error.message ?? "Couldn't change the password." : "Password changed ✓");
    if (!result.error) {
      setCurrentPassword("");
      setNewPassword("");
    }
  };

  const loadUsers = async () => {
    setAdminBusy(true);
    try {
      const result = await authClient.admin.listUsers({ query: { limit: 100 } });
      if (result.error) {
        setAdminMessage("You're not an admin on this deployment.");
        return;
      }
      setUsers(result.data.users.map((u) => ({ id: u.id, email: u.email, name: u.name })));
    } finally {
      setAdminBusy(false);
    }
  };

  const resetFor = async (userId: string) => {
    const pw = resetPasswords[userId] ?? "";
    if (pw.length < 8) return setAdminMessage("Reset password needs at least 8 characters.");
    setAdminBusy(true);
    try {
      const result = await authClient.admin.setUserPassword({ userId, newPassword: pw });
      setAdminMessage(result.error ? result.error.message ?? "Reset failed." : "Password reset ✓");
    } finally {
      setAdminBusy(false);
    }
  };

  const inputCls =
    "mt-1 block w-full rounded-lg border border-sky bg-mist px-3 py-2 text-sm text-ink";

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="font-display text-2xl font-bold">Account</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {session.user.name} · {session.user.email}
      </p>
      <p className="mt-1 font-mono text-[11px] text-ink-soft">id: {session.user.id}</p>

      <section className="mt-6 rounded-xl border border-sky bg-paper p-5">
        <h2 className="font-display text-lg font-semibold">Change password</h2>
        <label className="mt-3 block text-xs font-medium text-ink-soft">
          Current password
          <input type="password" value={currentPassword} className={inputCls}
            autoComplete="current-password"
            onChange={(e) => setCurrentPassword(e.target.value)} />
        </label>
        <label className="mt-3 block text-xs font-medium text-ink-soft">
          New password
          <input type="password" value={newPassword} className={inputCls}
            autoComplete="new-password"
            onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        <button type="button" onClick={() => void changePassword()} disabled={busy}
          className="mt-4 rounded-lg bg-rail px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "…" : "Change password"}
        </button>
        {message && <p className="mt-2 text-xs text-seal">{message}</p>}
      </section>

      <section className="mt-4 rounded-xl border border-sky bg-paper p-5">
        <h2 className="font-display text-lg font-semibold">Admin · reset a member&apos;s password</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Only works when your account id is listed in ADMIN_USER_IDS.
        </p>
        {users === null ? (
          <button type="button" onClick={() => void loadUsers()} disabled={adminBusy}
            className="mt-3 rounded-lg border border-sky px-3 py-1.5 text-sm text-rail hover:bg-sky disabled:opacity-50">
            Load members
          </button>
        ) : (
          <ul className="mt-3 space-y-2">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-32 truncate">{u.name} <span className="text-xs text-ink-soft">{u.email}</span></span>
                <input type="password" placeholder="new password" aria-label={`New password for ${u.email}`}
                  value={resetPasswords[u.id] ?? ""}
                  className="w-36 rounded-lg border border-sky bg-mist px-2 py-1 text-xs"
                  onChange={(e) =>
                    setResetPasswords((prev) => ({ ...prev, [u.id]: e.target.value }))
                  } />
                <button type="button" onClick={() => void resetFor(u.id)} disabled={adminBusy}
                  className="rounded-lg bg-rail px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
                  Reset
                </button>
              </li>
            ))}
          </ul>
        )}
        {adminMessage && <p className="mt-2 text-xs text-seal">{adminMessage}</p>}
      </section>
    </main>
  );
}
