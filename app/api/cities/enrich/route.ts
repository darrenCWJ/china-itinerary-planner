import { NextRequest, NextResponse } from "next/server";
import { enrichCities } from "@/lib/server/cityEnrichment";

/**
 * Enrichment for cities the build did not pre-fetch (spec §4).
 *
 * A thin wrapper on purpose: nothing under app/ is covered by either vitest
 * project, so every decision — which ids are valid, how many, what a failure
 * returns — lives in `enrichCities` and is tested there. Same split as
 * app/api/map/airports/route.ts.
 *
 * No Cache-Control: the response is keyed by whichever ids one user happened
 * to pick, so entries would not be shared. The in-process cache in
 * `enrichCities` is what stops the repeat work.
 *
 * Anonymous, like /api/map/cities and /api/destinations — `wallDecision` passes
 * everything under /api/ and these routes self-enforce. Unlike those two, this
 * one makes an OUTBOUND call and remembers what it learns, so `enrichCities`
 * validates every id, caps a request at twelve, and bounds its cache.
 */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return NextResponse.json({ enrichment: await enrichCities(ids) });
}
