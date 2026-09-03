// lib/gatewayDefaults.test.ts
import { describe, expect, test } from "vitest";
import type { Airport } from "./airports";
import type { TripInput } from "./itinerary";
import { applyDefaultGateways, defaultGateways } from "./gatewayDefaults";

/** Hand-written at the artifact's coordinates, so a nightly refresh cannot move them. */
const airport = (over: Partial<Airport> & Pick<Airport, "iata" | "lat" | "lon">): Airport => ({
  icao: null,
  name: `${over.iata} airport`,
  municipality: null,
  country: "PE",
  size: "large",
  ...over,
});
const LIM = airport({ iata: "LIM", lat: -12.0219, lon: -77.1143 });
const CUZ = airport({ iata: "CUZ", lat: -13.5357, lon: -71.9388 });
/** An aeroclub nearer Lima's centre than LIM — must never be a gateway. */
const CLUB = airport({ iata: "ZZC", lat: -12.05, lon: -77.03, size: "small" });
const AIRPORTS = [CLUB, CUZ, LIM];

const lima = { lat: -12.04318, lon: -77.02824 };
const cusco = { lat: -13.53188, lon: -71.96701 };
const offMap = { lat: null, lon: null };

describe("defaultGateways", () => {
  test("names the main airport of the first stop and of the last", () => {
    expect(defaultGateways([lima, cusco], AIRPORTS)).toEqual({ arrivalAirport: "LIM", departureAirport: "CUZ" });
  });

  test("never names a small airport, however close", () => {
    // mainAirportFor's rule, inherited rather than restated: the club is 1 km
    // from Lima's centre and LIM is 9 km, and the club is still not an answer.
    expect(defaultGateways([lima], AIRPORTS).arrivalAirport).toBe("LIM");
  });

  test("a single stop is both the arrival and the departure", () => {
    expect(defaultGateways([cusco], AIRPORTS)).toEqual({ arrivalAirport: "CUZ", departureAirport: "CUZ" });
  });

  test("skips off-map stops, which have nothing to measure from", () => {
    expect(defaultGateways([offMap, lima, cusco, offMap], AIRPORTS)).toEqual({
      arrivalAirport: "LIM",
      departureAirport: "CUZ",
    });
  });

  test("a trip with no located stop, or no airport in range, gets none", () => {
    expect(defaultGateways([offMap], AIRPORTS)).toEqual({ arrivalAirport: null, departureAirport: null });
    expect(defaultGateways([lima, cusco], [])).toEqual({ arrivalAirport: null, departureAirport: null });
    // Ushuaia is ~4,700 km from every fixture airport (4,599 to CUZ, 4,819 to
    // LIM), far past DEFAULT_AIRPORT_RADIUS_KM.
    expect(defaultGateways([{ lat: -54.8, lon: -68.3 }], AIRPORTS).arrivalAirport).toBeNull();
  });
});

describe("applyDefaultGateways", () => {
  const input: TripInput = {
    destinationIds: ["G3936456", "G3941584"],
    days: 5,
    season: "winter",
    adults: 2,
    kids: 0,
    interests: [],
    country: "PE",
  };
  const defaults = { arrivalAirport: "LIM", departureAirport: "CUZ" };

  test("fills what is absent, and always writes both keys", () => {
    const stamped = applyDefaultGateways(input, defaults);
    expect(stamped.arrivalAirport).toBe("LIM");
    expect(stamped.departureAirport).toBe("CUZ");
    expect("arrivalAirport" in stamped && "departureAirport" in stamped).toBe(true);
  });

  test("leaves the traveller's null alone — none is an answer", () => {
    const stamped = applyDefaultGateways({ ...input, arrivalAirport: null }, defaults);
    expect(stamped.arrivalAirport).toBeNull();
    expect(stamped.departureAirport).toBe("CUZ");
  });

  test("leaves the traveller's code alone", () => {
    expect(applyDefaultGateways({ ...input, departureAirport: "AQP" }, defaults).departureAirport).toBe("AQP");
  });

  test("writes a null default as null, so a stamped trip can never read as legacy", () => {
    const stamped = applyDefaultGateways(input, { arrivalAirport: null, departureAirport: null });
    expect(stamped.arrivalAirport).toBeNull();
    expect("arrivalAirport" in stamped).toBe(true);
  });
});
