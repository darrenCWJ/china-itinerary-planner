import { beforeEach, describe, expect, test, vi } from "vitest";
import { fullPayload } from "@/lib/tripFixtures";

/**
 * Drives the real PUT handler with its seams mocked the way
 * gatewaysRoute.test.ts mocks them: membership and the store. The merge
 * (`applyCurrencySettingsUpdate`) is real.
 */
vi.mock("@/lib/server/authz", () => ({ requireMember: vi.fn() }));
vi.mock("@/lib/server/store", () => ({
  storeMode: () => "sqlite",
  DB_UNAVAILABLE: "unavailable",
  getTrip: vi.fn(),
  setCurrencySettingsIf: vi.fn(),
  // Present so "never called" is about a real export, not a typo.
  setCurrencySettings: vi.fn(),
}));

const { PUT } = await import("@/app/api/trips/[id]/currency/route");
const { requireMember } = await import("@/lib/server/authz");
const { getTrip, setCurrencySettingsIf, setCurrencySettings } = await import("@/lib/server/store");
const { NextRequest } = await import("next/server");

function request(body: unknown) {
  return new NextRequest("http://localhost/api/trips/trip-1/currency", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "trip-1" }) };
const BODY = { home: "SGD", rates: { SGD: 5.2 } };

/** A stored blob with a pivot the client never sends and must not lose. */
function storedPayload() {
  const payload = fullPayload();
  return { ...payload, currencySettings: { home: "CNY", rates: {}, pivot: "CNY" } };
}

beforeEach(() => {
  vi.mocked(requireMember).mockReset();
  vi.mocked(requireMember).mockResolvedValue({ memberName: "Ada" });
  vi.mocked(getTrip).mockReset();
  vi.mocked(getTrip).mockResolvedValue(storedPayload());
  vi.mocked(setCurrencySettingsIf).mockReset();
  vi.mocked(setCurrencySettingsIf).mockResolvedValue(true);
  vi.mocked(setCurrencySettings).mockClear();
});

describe("PUT /api/trips/:id/currency", () => {
  test("writes the merged settings under the version it read, carrying the pivot", async () => {
    const res = await PUT(request(BODY), params);
    expect(res.status).toBe(200);
    const [id, settings, version] = vi.mocked(setCurrencySettingsIf).mock.calls[0];
    expect(id).toBe("trip-1");
    expect(version).toBe(storedPayload().version);
    expect(settings).toEqual({ home: "SGD", rates: { SGD: 5.2 }, pivot: "CNY" });
    expect(setCurrencySettings).not.toHaveBeenCalled();
  });

  test("returns the member payload, like the other sub-routes", async () => {
    const res = await PUT(request(BODY), params);
    expect(await res.json()).toMatchObject({ id: "trip-1", myMemberName: "Ada" });
  });

  test("rejects a malformed body before any write", async () => {
    expect((await PUT(request({ home: 5, rates: [] }), params)).status).toBe(400);
    expect(setCurrencySettingsIf).not.toHaveBeenCalled();
  });

  test("404s an unknown trip", async () => {
    vi.mocked(getTrip).mockResolvedValue(null);
    expect((await PUT(request(BODY), params)).status).toBe(404);
    expect(setCurrencySettingsIf).not.toHaveBeenCalled();
  });

  test("re-reads and retries when another member's write lands first, merging into what they wrote", async () => {
    // Their save lands between our read and our write: the version moves to
    // 8 and the pivot is theirs. The second read sees it; the second write
    // must be built from it — a retry that re-reads but merges into the FIRST
    // read still reverts their save, which is the bug this route exists to
    // prevent.
    const theirs = {
      ...storedPayload(),
      version: 8,
      currencySettings: { home: "PEN", rates: { PEN: 3.7 }, pivot: "PEN" },
    };
    vi.mocked(getTrip)
      .mockResolvedValueOnce(storedPayload())
      .mockResolvedValueOnce(theirs)
      .mockResolvedValue(theirs);
    vi.mocked(setCurrencySettingsIf).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = await PUT(request(BODY), params);
    expect(res.status).toBe(200);
    expect(setCurrencySettingsIf).toHaveBeenCalledTimes(2);
    const [, merged, version] = vi.mocked(setCurrencySettingsIf).mock.calls[1];
    expect(version).toBe(8);
    expect(merged).toEqual({ home: "SGD", rates: { SGD: 5.2 }, pivot: "PEN" });
    // Two attempts, then the payload read: exactly three reads.
    expect(getTrip).toHaveBeenCalledTimes(3);
  });

  test("gives up with a 409 after three lost races", async () => {
    vi.mocked(setCurrencySettingsIf).mockResolvedValue(false);
    const res = await PUT(request(BODY), params);
    expect(res.status).toBe(409);
    expect(setCurrencySettingsIf).toHaveBeenCalledTimes(3);
  });

  test("is closed to non-members", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireMember).mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }));
    expect((await PUT(request(BODY), params)).status).toBe(403);
    expect(setCurrencySettingsIf).not.toHaveBeenCalled();
  });
});
