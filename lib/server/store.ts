import type { MyTrip } from "../myTrips";
import type { Ticket, TripData, TripPayload } from "../tripShared";
import { planIdMigration } from "./migrate";
import * as sqlite from "./tripStore";
import type { BriefingRecord, JoinResult, WalletPutResult } from "./tripStore";

/**
 * Storage facade: Postgres (Supabase) when DATABASE_URL is set, SQLite for
 * local development, unavailable on serverless hosts without a database
 * (their filesystem is read-only, so SQLite can't work there).
 */
export type StoreMode = "postgres" | "sqlite" | "unavailable";

export const DB_UNAVAILABLE =
  "Shared trips need a database. Add a DATABASE_URL (e.g. a Supabase connection string) to the deployment's environment variables.";

export function storeMode(): StoreMode {
  if (process.env.DATABASE_URL) return "postgres";
  if (process.env.VERCEL) return "unavailable";
  return "sqlite";
}

/** Lazy so local development never initialises the postgres client. */
function pg() {
  return import("./pgStore");
}

export async function createTrip(
  data: TripData,
  creatorName: string
): Promise<{ id: string; joinCode: string }> {
  if (storeMode() === "postgres") return (await pg()).createTrip(data, creatorName);
  return sqlite.createTrip(data, creatorName);
}

export async function getTrip(
  id: string,
  requestingMember?: string
): Promise<TripPayload | null> {
  const usePg = storeMode() === "postgres";
  const payload = usePg
    ? await (await pg()).getTrip(id, requestingMember)
    : sqlite.getTrip(id, requestingMember);
  if (!payload) return null;

  // One-time upgrade of pre-editing trips: stamp item ids into the plan and
  // move their schedule checks from index-based to id-based keys.
  const migration = planIdMigration(payload);
  if (!migration) return payload;
  if (usePg) {
    const p = await pg();
    await p.updateTripData(id, migration.data);
    for (const r of migration.remaps) {
      await p.setCheck(id, r.newKey, r.by, true);
      await p.setCheck(id, r.oldKey, "", false);
    }
    return p.getTrip(id, requestingMember);
  }
  sqlite.updateTripData(id, migration.data);
  for (const r of migration.remaps) {
    sqlite.setCheck(id, r.newKey, r.by, true);
    sqlite.setCheck(id, r.oldKey, "", false);
  }
  return sqlite.getTrip(id, requestingMember);
}

export async function isMember(tripId: string, name: string): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).isMember(tripId, name);
  return sqlite.isMember(tripId, name);
}

export async function joinTrip(
  tripId: string,
  code: string,
  name: string
): Promise<JoinResult> {
  if (storeMode() === "postgres") return (await pg()).joinTrip(tripId, code, name);
  return sqlite.joinTrip(tripId, code, name);
}

export async function updateTripData(tripId: string, data: TripData): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).updateTripData(tripId, data);
  return sqlite.updateTripData(tripId, data);
}

export async function updateTripDataIf(
  tripId: string,
  data: TripData,
  expectedVersion: number
): Promise<boolean> {
  if (storeMode() === "postgres") {
    return (await pg()).updateTripDataIf(tripId, data, expectedVersion);
  }
  return sqlite.updateTripDataIf(tripId, data, expectedVersion);
}

export async function setCheck(
  tripId: string,
  key: string,
  memberName: string,
  checked: boolean
): Promise<void> {
  if (storeMode() === "postgres") return (await pg()).setCheck(tripId, key, memberName, checked);
  return sqlite.setCheck(tripId, key, memberName, checked);
}

export async function addTicket(tripId: string, ticket: Ticket): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).addTicket(tripId, ticket);
  return sqlite.addTicket(tripId, ticket);
}

export async function updateTicket(tripId: string, ticket: Ticket): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).updateTicket(tripId, ticket);
  return sqlite.updateTicket(tripId, ticket);
}

export async function deleteTicket(tripId: string, ticketId: string): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).deleteTicket(tripId, ticketId);
  return sqlite.deleteTicket(tripId, ticketId);
}

export async function clearScheduleChecks(tripId: string): Promise<void> {
  if (storeMode() === "postgres") return (await pg()).clearScheduleChecks(tripId);
  return sqlite.clearScheduleChecks(tripId);
}

export async function createWallet(trips: MyTrip[]): Promise<{ code: string }> {
  if (storeMode() === "postgres") return (await pg()).createWallet(trips);
  return sqlite.createWallet(trips);
}

export async function getWallet(
  code: string
): Promise<{ trips: MyTrip[]; version: number } | null> {
  if (storeMode() === "postgres") return (await pg()).getWallet(code);
  return sqlite.getWallet(code);
}

export async function putWallet(
  code: string,
  trips: MyTrip[],
  baseVersion: number
): Promise<WalletPutResult> {
  if (storeMode() === "postgres") return (await pg()).putWallet(code, trips, baseVersion);
  return sqlite.putWallet(code, trips, baseVersion);
}

export async function enableBriefing(
  tripId: string,
  includeBookings: boolean
): Promise<{ code: string } | null> {
  if (storeMode() === "postgres") return (await pg()).enableBriefing(tripId, includeBookings);
  return sqlite.enableBriefing(tripId, includeBookings);
}

export async function revokeBriefing(tripId: string): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).revokeBriefing(tripId);
  return sqlite.revokeBriefing(tripId);
}

export async function getBriefingByCode(
  code: string
): Promise<{ tripId: string; includeBookings: boolean } | null> {
  if (storeMode() === "postgres") return (await pg()).getBriefingByCode(code);
  return sqlite.getBriefingByCode(code);
}

export async function getBriefingForTrip(tripId: string): Promise<BriefingRecord | null> {
  if (storeMode() === "postgres") return (await pg()).getBriefingForTrip(tripId);
  return sqlite.getBriefingForTrip(tripId);
}
