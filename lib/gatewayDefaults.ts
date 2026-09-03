// lib/gatewayDefaults.ts
import type { Airport } from "./airports";
import type { TripInput } from "./itinerary";
import { mainAirportFor } from "./mainAirport";

export interface GatewayDefaults {
  arrivalAirport: string | null;
  departureAirport: string | null;
}

/** A stop as the plan knows it: a located place, or an off-map one with no coordinates. */
interface Stop {
  lat: number | null;
  lon: number | null;
}

function isLocated(stop: Stop): stop is { lat: number; lon: number } {
  return stop.lat !== null && stop.lon !== null;
}

/**
 * The gateways a trip gets when the traveller named none: the main airport of
 * the first stop and of the last (spec §10.3).
 *
 * By `mainAirportFor`'s rule rather than a second one, so the code stamped
 * here is the code the place card names — never a closer aeroclub, never one
 * beyond `DEFAULT_AIRPORT_RADIUS_KM`. Takes the airport array as a parameter
 * for the same reason lib/mainAirport.ts does: it is browser-safe, and the
 * server hands it `allAirports()` so a border city gets its real gateway
 * rather than the one inside its own country.
 *
 * Off-map stops have no coordinates and are skipped; a trip with no located
 * stop, or none within range of an airport, gets null on both sides — "none",
 * which is honest, rather than a guess.
 */
export function defaultGateways(stops: readonly Stop[], airports: readonly Airport[]): GatewayDefaults {
  const located = stops.filter(isLocated);
  if (located.length === 0) return { arrivalAirport: null, departureAirport: null };
  const first = located[0];
  const last = located[located.length - 1];
  return {
    arrivalAirport: mainAirportFor(airports, first)?.iata ?? null,
    departureAirport: mainAirportFor(airports, last)?.iata ?? null,
  };
}

/**
 * Fill only what is ABSENT. Null is the traveller saying "none" and a code is
 * the traveller's choice; both survive. This is the write end of the three
 * states `tripGateways` documents, and it always writes both keys — so a trip
 * that has been through here can never again be mistaken for a legacy one
 * (the `755c8dd` rule: absent must mean exactly one thing).
 */
export function applyDefaultGateways(input: TripInput, defaults: GatewayDefaults): TripInput {
  return {
    ...input,
    arrivalAirport: input.arrivalAirport === undefined ? defaults.arrivalAirport : input.arrivalAirport,
    departureAirport:
      input.departureAirport === undefined ? defaults.departureAirport : input.departureAirport,
  };
}
