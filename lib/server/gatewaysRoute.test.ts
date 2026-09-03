import { beforeEach, describe, expect, test, vi } from "vitest";
import { fullPayload } from "@/lib/tripFixtures";

vi.mock("@/lib/server/authz", () => ({ requireMember: vi.fn() }));
vi.mock("@/lib/server/airports", () => ({
  findAirport: (iata: string) => (["LIM", "CUZ", "AQP"].includes(iata) ? { iata } : null),
}));
vi.mock("@/lib/server/store", () => ({
  storeMode: () => "sqlite",
  DB_UNAVAILABLE: "unavailable",
  getTrip: vi.fn(),
  updateTripDataIf: vi.fn(),
  // Present so the assertion that they are never called is about real
  // exports, not about a typo.
  updateTripData: vi.fn(),
  clearScheduleChecks: vi.fn(),
}));

const { PUT } = await import("@/app/api/trips/[id]/gateways/route");
const { requireMember } = await import("@/lib/server/authz");
const { getTrip, updateTripDataIf, updateTripData, clearScheduleChecks } = await import("@/lib/server/store");
const { NextRequest } = await import("next/server");

function request(body: unknown) {
  return new NextRequest("http://localhost/api/trips/trip-1/gateways", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "trip-1" }) };

beforeEach(() => {
  vi.mocked(requireMember).mockReset();
  vi.mocked(requireMember).mockResolvedValue({ memberName: "Ada" });
  vi.mocked(getTrip).mockReset();
  vi.mocked(getTrip).mockResolvedValue(fullPayload());
  vi.mocked(updateTripDataIf).mockReset();
  vi.mocked(updateTripDataIf).mockResolvedValue(true);
  vi.mocked(updateTripData).mockClear();
  vi.mocked(clearScheduleChecks).mockClear();
});

describe("PUT /api/trips/:id/gateways", () => {
  test("writes both gateways into input under the version guard, and nothing else", async () => {
    const res = await PUT(request({ arrivalAirport: "lim", departureAirport: null }), params);
    expect(res.status).toBe(200);
    const [id, data, version] = vi.mocked(updateTripDataIf).mock.calls[0];
    expect(id).toBe("trip-1");
    expect(version).toBe(7);
    expect(data.input.arrivalAirport).toBe("LIM");
    expect(data.input.departureAirport).toBeNull();
    // The whole point of a sub-route (spec §10.3): the plan is untouched and
    // no tick is cleared. PATCH /api/trips/[id] does both.
    expect(data.plan).toEqual(fullPayload().data.plan);
    expect(updateTripData).not.toHaveBeenCalled();
    expect(clearScheduleChecks).not.toHaveBeenCalled();
  });

  test("returns the member payload, like the other sub-routes", async () => {
    const res = await PUT(request({ arrivalAirport: "LIM", departureAirport: "CUZ" }), params);
    expect(await res.json()).toMatchObject({ id: "trip-1", myMemberName: "Ada" });
  });

  test("rejects a body missing a key or carrying a malformed code", async () => {
    expect((await PUT(request({ arrivalAirport: "LIM" }), params)).status).toBe(400);
    expect((await PUT(request({ arrivalAirport: "LIMA", departureAirport: null }), params)).status).toBe(400);
    expect(updateTripDataIf).not.toHaveBeenCalled();
  });

  test("rejects a code the airports artifact does not carry", async () => {
    const res = await PUT(request({ arrivalAirport: "ZZZ", departureAirport: null }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown airport code ZZZ" });
    expect(updateTripDataIf).not.toHaveBeenCalled();
  });

  test("404s an unknown trip", async () => {
    vi.mocked(getTrip).mockResolvedValue(null);
    expect((await PUT(request({ arrivalAirport: null, departureAirport: null }), params)).status).toBe(404);
  });

  test("re-reads and retries when another member's write lands first", async () => {
    vi.mocked(updateTripDataIf).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = await PUT(request({ arrivalAirport: "AQP", departureAirport: "AQP" }), params);
    expect(res.status).toBe(200);
    expect(updateTripDataIf).toHaveBeenCalledTimes(2);
  });

  test("gives up with a 409 after three lost races", async () => {
    vi.mocked(updateTripDataIf).mockResolvedValue(false);
    const res = await PUT(request({ arrivalAirport: "AQP", departureAirport: "AQP" }), params);
    expect(res.status).toBe(409);
    expect(updateTripDataIf).toHaveBeenCalledTimes(3);
  });

  test("is closed to non-members", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireMember).mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }));
    expect((await PUT(request({ arrivalAirport: null, departureAirport: null }), params)).status).toBe(403);
    expect(updateTripDataIf).not.toHaveBeenCalled();
  });
});
