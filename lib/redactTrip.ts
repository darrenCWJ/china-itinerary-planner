import type { GuestTripPayload, TripPayload } from "./tripShared";

/**
 * Built by construction, never by deletion: every field is explicitly
 * copied from the whitelist. Adding a field to TripPayload cannot leak it
 * here, and the field-list test pins the exact shape.
 */
export function guestTripView(payload: TripPayload): GuestTripPayload {
  return {
    id: payload.id,
    version: payload.version,
    guest: true,
    tripName: payload.data.tripName,
    startDate: payload.data.startDate,
    days: payload.data.input.days,
    season: payload.data.input.season,
    destinationNames: [...payload.data.destinationNames],
    planDays: payload.data.plan.days,
    packing: payload.data.packing,
    memberCount: payload.members.length,
  };
}

/**
 * Canary: every top-level TripPayload field must be explicitly classified.
 * Adding a field to TripPayload without deciding its guest visibility is a
 * compile error here — classify it below (and extend guestTripView + its
 * tests if it becomes visible).
 */
const FIELD_CLASSIFICATION: Record<keyof TripPayload, "guest-visible" | "members-only"> = {
  id: "guest-visible",
  version: "guest-visible",
  updatedAt: "members-only",
  data: "guest-visible", // partially — via the explicit copies above
  members: "members-only", // count only, via memberCount
  checks: "members-only",
  tickets: "members-only",
  expenses: "members-only",
  settlements: "members-only",
  journal: "members-only",
  currencySettings: "members-only",
  features: "members-only",
  joinCode: "members-only",
};
void FIELD_CLASSIFICATION;
