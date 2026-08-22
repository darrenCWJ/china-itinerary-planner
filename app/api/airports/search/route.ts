import { NextRequest, NextResponse } from "next/server";
import type { Airport } from "@/lib/airports";
import { searchAirports } from "@/lib/server/airports";

/** Below this every query matches thousands of rows. Mirrors /api/destinations. */
const MIN_QUERY = 2;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const results: Airport[] = q.trim().length >= MIN_QUERY ? searchAirports(q) : [];
  return NextResponse.json(
    { results },
    {
      // Shorter than /api/map/airports' day-long window on purpose: that
      // route is keyed by country, so every client asking about "CN" shares
      // one cache entry and the artifact only moves once a day. This route is
      // keyed by free-text `q`, so almost every request is a cache miss no
      // matter the window — a long TTL would buy nothing there and would only
      // risk serving a since-corrected query for unnecessarily long. What a
      // short window *does* buy: the handful of `q` values that do repeat
      // (retyping the same few characters, a back-navigation) skip a redundant
      // lookup without pretending this endpoint is anywhere near as static as
      // the country-scoped one.
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=1800" },
    }
  );
}
