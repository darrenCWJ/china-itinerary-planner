import type { TripData, TripPayload } from "../tripShared";
import * as sqlite from "./tripStore";
import type { JoinResult } from "./tripStore";

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
  if (storeMode() === "postgres") return (await pg()).getTrip(id, requestingMember);
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

export async function setCheck(
  tripId: string,
  key: string,
  memberName: string,
  checked: boolean
): Promise<void> {
  if (storeMode() === "postgres") return (await pg()).setCheck(tripId, key, memberName, checked);
  return sqlite.setCheck(tripId, key, memberName, checked);
}
