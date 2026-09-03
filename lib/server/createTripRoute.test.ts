import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Airport } from "@/lib/airports";
import { DESTINATIONS } from "@/lib/data";

/**
 * Drives the real POST handler with every network and storage seam mocked:
 * the session, the store, the catalog and the airports artifact. What is
 * NOT mocked is buildTripData, so the stamp is computed from a real plan.
 */
vi.mock("@/lib/server/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/server/store", () => ({
  storeMode: () => "sqlite",
  DB_UNAVAILABLE: "unavailable",
  createTrip: vi.fn(async () => ({ id: "trip-1", joinCode: "ABCDEF" })),
  setCurrencySettings: vi.fn(async () => true),
  linkMemberAccount: vi.fn(async () => "linked"),
}));
vi.mock("@/lib/server/catalog", () => ({
  ensureCatalogLoaded: vi.fn(async () => undefined),
  resolveDestinations: (ids: string[]) =>
    ids.map((id) => DESTINATIONS.find((d) => d.id === id)).filter((d) => d !== undefined),
}));
vi.mock("@/lib/server/airports", () => ({
  allAirports: () => AIRPORTS,
  findAirport: (iata: string) => AIRPORTS.find((a) => a.iata === iata) ?? null,
}));

const airport = (over: Partial<Airport> & Pick<Airport, "iata" | "lat" | "lon">): Airport => ({
  icao: null,
  name: `${over.iata} airport`,
  municipality: null,
  country: "CN",
  size: "large",
  ...over,
});
/** At the artifact's coordinates: PEK is Beijing's main airport (25 km), SHA is Shanghai's (14 km). */
const AIRPORTS = [
  airport({ iata: "PEK", lat: 40.077349, lon: 116.596702 }),
  airport({ iata: "PKX", lat: 39.501289, lon: 116.413967 }),
  airport({ iata: "SHA", lat: 31.198104, lon: 121.33426 }),
  airport({ iata: "PVG", lat: 31.1434, lon: 121.805 }),
];

const { POST } = await import("@/app/api/trips/route");
const { getSessionUser } = await import("@/lib/server/session");
const { createTrip } = await import("@/lib/server/store");
const { NextRequest } = await import("next/server");

function request(body: unknown): InstanceType<typeof NextRequest> {
  return new NextRequest("http://localhost/api/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const input = {
  destinationIds: ["beijing", "shanghai"],
  days: 4,
  season: "autumn",
  adults: 2,
  kids: 0,
  interests: ["history"],
  country: "CN",
};

function storedInput() {
  const [data] = vi.mocked(createTrip).mock.calls[0];
  return data.input;
}

beforeEach(() => {
  vi.mocked(getSessionUser).mockReset();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Ada", email: "ada@example.test" });
  vi.mocked(createTrip).mockClear();
});

describe("POST /api/trips stamps the gateways (spec §10.3)", () => {
  test("a trip that names no gateways gets the main airports of its first and last stop", async () => {
    const res = await POST(request({ tripName: "Autumn", input }));
    expect(res.status).toBe(201);
    expect(storedInput().arrivalAirport).toBe("PEK");
    expect(storedInput().departureAirport).toBe("SHA");
  });

  test("the traveller's own choice survives the stamp", async () => {
    await POST(request({ tripName: "Autumn", input: { ...input, arrivalAirport: "PKX" } }));
    expect(storedInput().arrivalAirport).toBe("PKX");
    expect(storedInput().departureAirport).toBe("SHA");
  });

  test("an explicit none survives the stamp too", async () => {
    await POST(request({ tripName: "Autumn", input: { ...input, departureAirport: null } }));
    expect(storedInput().arrivalAirport).toBe("PEK");
    expect(storedInput().departureAirport).toBeNull();
  });

  test("a code the artifact does not have is refused, not quietly stamped over", async () => {
    // The same refusal /gateways gives, in the same words. Without it the two
    // doors disagreed: a typo was accepted here and rejected there, so the
    // trip was created carrying a code that could never be edited to anything
    // — every later save of the OTHER side would be refused for it too.
    const res = await POST(request({ tripName: "Autumn", input: { ...input, arrivalAirport: "ZZZ" } }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Unknown airport code ZZZ" });
    expect(createTrip).not.toHaveBeenCalled();
  });

  test("the departure is the plan's last stop, not the selection's", async () => {
    // Two days, two cities: buildItinerary keeps one city per day at most, so
    // with days: 1 only Beijing is planned and both gateways are Beijing's.
    await POST(request({ tripName: "Day trip", input: { ...input, days: 1 } }));
    expect(storedInput().arrivalAirport).toBe("PEK");
    expect(storedInput().departureAirport).toBe("PEK");
  });
});
