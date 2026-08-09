import type { TripCheck, TripData, TripMember, TripPayload } from "../tripShared";
import { getDb } from "./db";
import { newJoinCode, newTripId } from "./ids";

interface TripRow {
  id: string;
  join_code: string;
  name: string;
  data: string;
  version: number;
  created_at: number;
  updated_at: number;
}

function touch(tripId: string): void {
  getDb()
    .prepare("UPDATE trips SET version = version + 1, updated_at = ? WHERE id = ?")
    .run(Date.now(), tripId);
}

export function createTrip(data: TripData, creatorName: string): { id: string; joinCode: string } {
  const db = getDb();
  const id = newTripId();
  const joinCode = newJoinCode();
  const now = Date.now();
  const insert = db.transaction(() => {
    db.prepare(
      "INSERT INTO trips (id, join_code, name, data, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)"
    ).run(id, joinCode, data.tripName, JSON.stringify(data), now, now);
    db.prepare("INSERT INTO members (trip_id, name, joined_at) VALUES (?, ?, ?)").run(
      id,
      creatorName,
      now
    );
  });
  insert();
  return { id, joinCode };
}

export function getTrip(id: string, requestingMember?: string): TripPayload | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM trips WHERE id = ?").get(id) as TripRow | undefined;
  if (!row) return null;

  const members = db
    .prepare("SELECT name, joined_at FROM members WHERE trip_id = ? ORDER BY joined_at")
    .all(id) as { name: string; joined_at: number }[];
  const checks = db
    .prepare("SELECT key, checked_by FROM checks WHERE trip_id = ?")
    .all(id) as { key: string; checked_by: string }[];

  const isMember =
    requestingMember !== undefined && members.some((m) => m.name === requestingMember);

  // A corrupted data column (e.g. OneDrive interfering with the WAL files)
  // should surface as "not found", not a 500 that hides the cause.
  let data: TripData;
  try {
    data = JSON.parse(row.data) as TripData;
  } catch {
    return null;
  }

  const payload: TripPayload = {
    id: row.id,
    version: row.version,
    updatedAt: row.updated_at,
    data,
    members: members.map((m): TripMember => ({ name: m.name, joinedAt: m.joined_at })),
    checks: checks.map((c): TripCheck => ({ key: c.key, by: c.checked_by })),
  };
  if (isMember) payload.joinCode = row.join_code;
  return payload;
}

export function isMember(tripId: string, name: string): boolean {
  return (
    getDb()
      .prepare("SELECT 1 FROM members WHERE trip_id = ? AND name = ?")
      .get(tripId, name) !== undefined
  );
}

export type JoinResult = "joined" | "rejoined" | "bad-code" | "not-found";

export function joinTrip(tripId: string, code: string, name: string): JoinResult {
  const db = getDb();
  const row = db.prepare("SELECT join_code FROM trips WHERE id = ?").get(tripId) as
    | { join_code: string }
    | undefined;
  if (!row) return "not-found";
  if (row.join_code.toUpperCase() !== code.toUpperCase()) return "bad-code";
  if (isMember(tripId, name)) return "rejoined";
  db.prepare("INSERT INTO members (trip_id, name, joined_at) VALUES (?, ?, ?)").run(
    tripId,
    name,
    Date.now()
  );
  touch(tripId);
  return "joined";
}

export function updateTripData(tripId: string, data: TripData): boolean {
  const db = getDb();
  const result = db
    .prepare("UPDATE trips SET data = ?, name = ? WHERE id = ?")
    .run(JSON.stringify(data), data.tripName, tripId);
  if (result.changes === 0) return false;
  touch(tripId);
  return true;
}

export function setCheck(tripId: string, key: string, memberName: string, checked: boolean): void {
  const db = getDb();
  if (checked) {
    db.prepare(
      "INSERT INTO checks (trip_id, key, checked_by, checked_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(trip_id, key) DO UPDATE SET checked_by = excluded.checked_by, checked_at = excluded.checked_at"
    ).run(tripId, key, memberName, Date.now());
  } else {
    db.prepare("DELETE FROM checks WHERE trip_id = ? AND key = ?").run(tripId, key);
  }
  touch(tripId);
}
