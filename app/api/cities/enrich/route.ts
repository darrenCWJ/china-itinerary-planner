import { NextRequest, NextResponse } from "next/server";
import { enrichCities } from "@/lib/server/cityEnrichment";
import { getSessionUser } from "@/lib/server/session";

/**
 * Enrichment for cities the build did not pre-fetch (spec §4).
 *
 * A thin wrapper on purpose: nothing under app/ is covered by either vitest
 * project, so every decision — which ids are valid, how many, what a failure
 * returns — lives in `enrichCities` and is tested there. Same split as
 * app/api/map/airports/route.ts. The one decision that cannot live there is
 * the session gate below, because it is about the caller rather than the ids;
 * `lib/server/cityEnrichRoute.test.ts` imports this handler and exercises it.
 *
 * No Cache-Control: the response is keyed by whichever ids one user happened
 * to pick, so entries would not be shared. The in-process cache in
 * `enrichCities` is what stops the repeat work.
 *
 * Signed-in only, unlike /api/map/cities and /api/destinations. `wallDecision`
 * passes everything under /api/ ("routes self-enforce", lib/wall.ts:37), so a
 * route that checks nothing is anonymous — and this is the one route in the
 * picker that makes an OUTBOUND call to a third party. The per-request caps in
 * `enrichCities` (twelve ids, a 20,000-entry cache) bound a single request and
 * say nothing about how many requests one caller may make, so they are not an
 * answer to that; requiring a session is. It costs no functionality: the picker
 * that calls this renders only on /plan, which the wall already gates.
 */
export async function GET(req: NextRequest) {
  if (!(await getSessionUser(req))) {
    return NextResponse.json({ error: "Sign in to look up city details" }, { status: 401 });
  }
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return NextResponse.json({ enrichment: await enrichCities(ids) });
}
