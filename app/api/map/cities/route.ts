import { NextRequest, NextResponse } from "next/server";
import { catalogStatus, ensureCatalogLoaded, mapCities } from "@/lib/server/catalog";

/**
 * The Wikidata catalog's cities for one country.
 *
 * Country-scoped, mirroring /api/map/airports — and, since every city in this
 * catalog is Chinese, empty for every country but CN. The GeoNames cities for
 * whichever country is open are NOT served here: they live in per-country
 * files under public/, which a Vercel lambda cannot read (spec §3.2), so the
 * client fetches `/cities/<CC>.json` itself and merges the two.
 *
 * Validation lives in `mapCities`, not here — nothing under app/ is covered by
 * either vitest project, so a route that decided anything would decide it
 * untested. Same split as app/api/map/airports/route.ts.
 *
 * The cache window matches /api/map/airports': the response is keyed by
 * country rather than by free text, so entries are shared across users and the
 * artifact only changes when the daily workflow commits.
 */
export async function GET(req: NextRequest) {
  await ensureCatalogLoaded();
  const country = req.nextUrl.searchParams.get("country") ?? "";
  const status = catalogStatus();
  if (!status.available) {
    return NextResponse.json({ available: false, cities: [] });
  }
  return NextResponse.json(
    { available: true, cities: mapCities(country) },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    }
  );
}
