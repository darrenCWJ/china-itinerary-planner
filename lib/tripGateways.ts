import type { TripInput } from "./itinerary";
import type { TripData } from "./tripShared";

/**
 * A leaf, like lib/tripCountry.ts: this module value-imports NOTHING, so the
 * shell and the wizard can read a trip's gateways without paying for the
 * airports artifact or the country facts. The two imports above are types.
 */

/** A three-letter IATA code, uppercase. The same shape `IataSchema` enforces. */
export const IATA_CODE = /^[A-Z]{3}$/;

export interface TripGateways {
  arrival: string | null;
  departure: string | null;
}

/**
 * The airports a trip flies into and out of — the only way callers read them.
 *
 * Absent and null both read as null. A trip saved before the field existed has
 * no gateway, and "none" is exactly what that means to a reader; the two
 * states differ only at the WRITE end, where `applyDefaultGateways` fills an
 * absent field and leaves a null one alone (the `755c8dd` rule: absent must
 * mean one thing). No caller should ever see `undefined` here.
 */
export function tripGateways(data: TripData): TripGateways {
  return {
    arrival: data.input.arrivalAirport ?? null,
    departure: data.input.departureAirport ?? null,
  };
}

/**
 * The same trip with its gateways replaced. Touches `input` and nothing else:
 * the plan is the members' draft, and a gateway is a fact about the trip, not
 * a reason to regenerate it.
 */
export function withGateways(data: TripData, gateways: TripGateways): TripData {
  return {
    ...data,
    input: {
      ...data.input,
      arrivalAirport: gateways.arrival,
      departureAirport: gateways.departure,
    },
  };
}

/**
 * An input that omits its gateways inherits the stored trip's.
 *
 * PATCH /api/trips/[id] rebuilds from a whole `TripInput`, and a client written
 * before these fields existed sends one without them. Absent there means
 * "unchanged", never "cleared" — `null` is how a client clears — so a rebuild
 * cannot silently drop the airports a member set. Absent on both sides stays
 * absent: a legacy row is not reclassified by being rebuilt.
 */
export function carryGateways(next: TripInput, previous: TripInput): TripInput {
  const carried: TripInput = { ...next };
  if (next.arrivalAirport === undefined && previous.arrivalAirport !== undefined) {
    carried.arrivalAirport = previous.arrivalAirport;
  }
  if (next.departureAirport === undefined && previous.departureAirport !== undefined) {
    carried.departureAirport = previous.departureAirport;
  }
  return carried;
}
