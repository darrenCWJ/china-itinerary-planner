import {
  loadMyTrips,
  mergeTripLists,
  removeMyTrip,
  replaceMyTrips,
  type MyTrip,
} from "./myTrips";

const WALLET_KEY = "cip-wallet-code";
const MAX_SYNC_ATTEMPTS = 3;

export type SyncResult =
  | { ok: true; trips: MyTrip[] }
  | { ok: false; error: string; trips: MyTrip[] };

export function loadWalletCode(): string | null {
  try {
    return localStorage.getItem(WALLET_KEY);
  } catch {
    return null;
  }
}

function storeWalletCode(code: string): void {
  try {
    localStorage.setItem(WALLET_KEY, code);
  } catch {
    // Storage blocked — the link just won't survive a reload.
  }
}

export function clearWalletCode(): void {
  try {
    localStorage.removeItem(WALLET_KEY);
  } catch {
    // Ignore.
  }
}

interface WalletSnapshot {
  trips: MyTrip[];
  version: number;
}

async function fetchWallet(code: string): Promise<WalletSnapshot | "not-found" | "error"> {
  try {
    const res = await fetch("/api/wallet/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.status === 404) return "not-found";
    if (!res.ok) return "error";
    return (await res.json()) as WalletSnapshot;
  } catch {
    return "error";
  }
}

async function pushWallet(
  code: string,
  trips: MyTrip[],
  baseVersion: number
): Promise<"ok" | "conflict" | "error"> {
  try {
    const res = await fetch("/api/wallet/put", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, trips, baseVersion }),
    });
    if (res.status === 409) return "conflict";
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

/** Stable comparison so an unchanged merge doesn't trigger a push. */
function sameLists(a: MyTrip[], b: MyTrip[]): boolean {
  const norm = (list: MyTrip[]) =>
    JSON.stringify(
      [...list]
        .sort((x, y) => x.id.localeCompare(y.id))
        .map((t) => [
          t.id,
          t.name,
          t.startDate,
          t.days,
          t.destinations,
          t.role,
          t.memberName ?? null,
          t.savedAt,
        ])
    );
  return norm(a) === norm(b);
}

/** A synced trip carries your member name — install it so edits work here. */
function installMemberIdentities(trips: MyTrip[]): void {
  for (const trip of trips) {
    if (!trip.memberName) continue;
    try {
      const key = `cip-member-${trip.id}`;
      if (!localStorage.getItem(key)) localStorage.setItem(key, trip.memberName);
    } catch {
      // Ignore — the user can still join manually with the trip code.
    }
  }
}

/**
 * Pull the wallet, merge with the local list, persist the result locally,
 * and push back if the merge changed the server copy. Retries on version
 * conflicts; on any failure the local (merged) list is still returned.
 */
export async function syncWallet(code: string, localTrips: MyTrip[]): Promise<SyncResult> {
  let current = localTrips;
  for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) {
    const snapshot = await fetchWallet(code);
    if (snapshot === "not-found") {
      return { ok: false, error: "Sync code no longer exists — unlink and re-create.", trips: current };
    }
    if (snapshot === "error") {
      return { ok: false, error: "Couldn't reach the sync server.", trips: current };
    }

    const merged = mergeTripLists(current, snapshot.trips);
    installMemberIdentities(merged);
    replaceMyTrips(merged);
    current = merged;

    if (sameLists(merged, snapshot.trips)) return { ok: true, trips: merged };

    const pushed = await pushWallet(code, merged, snapshot.version);
    if (pushed === "ok") return { ok: true, trips: merged };
    if (pushed === "error") {
      return { ok: false, error: "Couldn't save to the sync server.", trips: merged };
    }
    // Conflict: another device wrote in between — loop to re-fetch and re-merge.
  }
  return { ok: false, error: "Sync is busy — will retry next visit.", trips: current };
}

/** Create a wallet seeded with this device's trips; stores + returns the code. */
export async function createWalletFromLocal(): Promise<{ code: string } | { error: string }> {
  try {
    const res = await fetch("/api/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trips: loadMyTrips() }),
    });
    const json: unknown = await res.json();
    if (!res.ok) {
      const message = (json as { error?: unknown }).error;
      return { error: typeof message === "string" ? message : "Couldn't create a sync code." };
    }
    const code = (json as { code: string }).code;
    storeWalletCode(code);
    return { code };
  } catch {
    return { error: "Couldn't reach the server — try again." };
  }
}

/** Link this device to an existing wallet and run a first sync. */
export async function linkWallet(rawCode: string): Promise<SyncResult> {
  const code = rawCode.trim().toUpperCase();
  const local = loadMyTrips();
  const probe = await fetchWallet(code);
  if (probe === "not-found") {
    return { ok: false, error: "That code wasn't found — check for typos.", trips: local };
  }
  if (probe === "error") {
    return { ok: false, error: "Couldn't reach the server — try again.", trips: local };
  }
  storeWalletCode(code);
  return syncWallet(code, local);
}

/** Forget a trip locally and, when linked, remove it from the wallet too. */
export async function forgetTripEverywhere(id: string): Promise<void> {
  const code = loadWalletCode();
  if (!code) return;
  for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) {
    const snapshot = await fetchWallet(code);
    if (snapshot === "not-found" || snapshot === "error") return;
    const without = removeMyTrip(snapshot.trips, id);
    if (without.length === snapshot.trips.length) return;
    const pushed = await pushWallet(code, without, snapshot.version);
    if (pushed !== "conflict") return;
  }
}
