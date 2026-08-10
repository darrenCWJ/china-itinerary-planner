import { itemCheckKey, type TripData, type TripPayload } from "../tripShared";

const LEGACY_KEY = /^day:(\d+):(\d+)$/;

export interface LegacyPlanMigration {
  data: TripData;
  /** Old index-based check → new id-based check, preserving who ticked it. */
  remaps: { oldKey: string; newKey: string; by: string }[];
}

/**
 * Trips created before itinerary editing have plan items without ids and
 * index-based check keys. Returns the migrated data + check remaps, or null
 * when the trip is already id-based.
 */
export function planIdMigration(payload: TripPayload): LegacyPlanMigration | null {
  const needsIds = payload.data.plan.days.some((d) => d.items.some((i) => !i.id));
  if (!needsIds) return null;

  // Ids are derived from the item's position, not random: two requests
  // migrating the same trip concurrently converge on identical ids, so the
  // last write wins with the same result and no check is orphaned.
  const days = payload.data.plan.days.map((d) => ({
    ...d,
    items: d.items.map((i, idx) => (i.id ? i : { ...i, id: `legacy-${d.day}-${idx}` })),
  }));

  const remaps: LegacyPlanMigration["remaps"] = [];
  for (const check of payload.checks) {
    const m = LEGACY_KEY.exec(check.key);
    if (!m) continue;
    const day = days.find((d) => d.day === Number(m[1]));
    const item = day?.items[Number(m[2])];
    if (!item) continue;
    remaps.push({ oldKey: check.key, newKey: itemCheckKey(item.id), by: check.by });
  }

  return {
    data: { ...payload.data, plan: { ...payload.data.plan, days } },
    remaps,
  };
}
