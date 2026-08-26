import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The one decision `app/api/cities/enrich/route.ts` makes that cannot live in
 * `lib/server/cityEnrichment.ts`: who is allowed to call it at all.
 *
 * `wallDecision` returns "pass" for every path under `/api/` (`lib/wall.ts:37`,
 * "routes self-enforce"), so a route that checks nothing is anonymous — and
 * this is the one route in the picker that makes an outbound call to a third
 * party. Without a session gate, an anonymous caller drives unbounded SPARQL
 * traffic to Wikidata from production. `MAX_IDS_PER_REQUEST` and
 * `MAX_CACHE_ENTRIES` are not an answer to that: they bound one request.
 *
 * The test file lives here rather than beside the route because
 * `vitest.config.mts` includes only lib/, scripts/ and components/ — the route
 * module itself is imported, so this is the handler's real behaviour and not
 * an assertion about its source text.
 */

vi.mock("@/lib/server/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/server/cityEnrichment", () => ({ enrichCities: vi.fn(async () => ({})) }));

const { GET } = await import("@/app/api/cities/enrich/route");
const { getSessionUser } = await import("@/lib/server/session");
const { enrichCities } = await import("@/lib/server/cityEnrichment");
const { NextRequest } = await import("next/server");

const signedIn = { id: "u1", name: "Ada", email: "ada@example.com" };

const request = (ids: string) =>
  new NextRequest(`https://example.test/api/cities/enrich?ids=${ids}`);

beforeEach(() => {
  vi.mocked(getSessionUser).mockReset();
  vi.mocked(enrichCities).mockReset();
  vi.mocked(enrichCities).mockResolvedValue({});
});

describe("GET /api/cities/enrich", () => {
  test("refuses an anonymous caller with 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);

    const res = await GET(request("G3934876"));

    expect(res.status).toBe(401);
  });

  test("makes no outbound call for an anonymous caller", async () => {
    // The half that matters. A 401 whose body was computed first would still
    // have queried Wikidata, which is the whole risk the gate exists for.
    vi.mocked(getSessionUser).mockResolvedValue(null);

    await GET(request("G3934876,G3936456"));

    expect(enrichCities).not.toHaveBeenCalled();
  });

  test("answers a signed-in caller with the enrichment it asked for", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(signedIn);
    vi.mocked(enrichCities).mockResolvedValue({
      G3934876: { description: "district of Lima, Peru", image: null },
    });

    const res = await GET(request("G3934876"));

    expect(res.status).toBe(200);
    // The bare record under one key, exactly as `app/plan/page.tsx` reads it —
    // no `parseCityEnrichment` envelope on either side.
    expect(await res.json()).toEqual({
      enrichment: { G3934876: { description: "district of Lima, Peru", image: null } },
    });
  });

  test("hands the ids through split, trimmed and emptied of blanks", async () => {
    // The gate must not have changed what the route passes on: everything
    // about which ids are valid still belongs to `enrichCities`.
    vi.mocked(getSessionUser).mockResolvedValue(signedIn);

    await GET(request("G1%20,%20,G2"));

    expect(enrichCities).toHaveBeenCalledWith(["G1", "G2"]);
  });
});
