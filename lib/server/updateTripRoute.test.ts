import { beforeEach, describe, expect, test, vi } from "vitest";
import { DESTINATIONS } from "@/lib/data";
import { fullPayload } from "@/lib/tripFixtures";

/**
 * Drives the real PATCH handler — the rebuild — with its seams mocked the same
 * way createTripRoute.test.ts mocks the create route: membership, the store,
 * the catalog and the airports artifact. buildTripData is real, so the
 * rebuilt plan comes from real destinations.
 *
 * The rebuild is the third door a gateway code can come through. The other
 * two (create, and PUT /gateways) refuse a well-formed code the artifact does
 * not carry; until this file existed nothing pinned that the third did too.
 */
vi.mock("@/lib/server/authz", () => ({ requireMember: vi.fn() }));
vi.mock("@/lib/server/store", () => ({
  storeMode: () => "sqlite",
  DB_UNAVAILABLE: "unavailable",
  getTrip: vi.fn(),
  updateTripData: vi.fn(async () => undefined),
  clearScheduleChecks: vi.fn(async () => undefined),
}));
vi.mock("@/lib/server/catalog", () => ({
  ensureCatalogLoaded: vi.fn(async () => undefined),
  resolveDestinations: (ids: string[]) =>
    ids.map((id) => DESTINATIONS.find((d) => d.id === id)).filter((d) => d !== undefined),
}));
vi.mock("@/lib/server/airports", () => ({
  findAirport: (iata: string) => (["PEK", "SHA"].includes(iata) ? { iata } : null),
}));

const { PATCH } = await import("@/app/api/trips/[id]/route");
const { requireMember } = await import("@/lib/server/authz");
const { getTrip, updateTripData, clearScheduleChecks } = await import("@/lib/server/store");
const { NextRequest } = await import("next/server");

function request(body: unknown) {
  return new NextRequest("http://localhost/api/trips/trip-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "trip-1" }) };

/** A whole TripInput, as a rebuild sends: the wizard's fields and nothing about gateways. */
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
  const [, data] = vi.mocked(updateTripData).mock.calls[0];
  return data.input;
}

beforeEach(() => {
  vi.mocked(requireMember).mockReset();
  vi.mocked(requireMember).mockResolvedValue({ memberName: "Ada" });
  vi.mocked(getTrip).mockReset();
  vi.mocked(getTrip).mockResolvedValue(fullPayload());
  vi.mocked(updateTripData).mockClear();
  vi.mocked(clearScheduleChecks).mockClear();
});

describe("PATCH /api/trips/:id and the gateway codes", () => {
  test("refuses a well-formed code the airports artifact does not carry, before any write", async () => {
    const res = await PATCH(request({ input: { ...input, arrivalAirport: "ZZZ" } }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown airport code ZZZ" });
    expect(updateTripData).not.toHaveBeenCalled();
    expect(clearScheduleChecks).not.toHaveBeenCalled();
  });

  test("stores a code it knows", async () => {
    const res = await PATCH(request({ input: { ...input, departureAirport: "SHA" } }), params);
    expect(res.status).toBe(200);
    expect(storedInput().departureAirport).toBe("SHA");
  });

  test("carries stored gateways forward unchecked when the rebuild does not mention them", async () => {
    // The check is on what arrives at the door, not on what the trip already
    // holds. A nightly artifact refresh can retire a code after it was
    // stored, and a member changing the days must not be refused over a
    // gateway they never touched.
    const stored = fullPayload();
    stored.data.input = { ...stored.data.input, arrivalAirport: "XXX", departureAirport: null };
    vi.mocked(getTrip).mockResolvedValue(stored);

    const res = await PATCH(request({ input }), params);
    expect(res.status).toBe(200);
    expect(storedInput().arrivalAirport).toBe("XXX");
    expect(storedInput().departureAirport).toBeNull();
  });
});
