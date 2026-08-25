import { NextRequest, NextResponse } from "next/server";
import { catalogStatus, ensureCatalogLoaded, searchCities } from "@/lib/server/catalog";

/**
 * Ranked search over the Wikidata catalog, scoped to one country.
 *
 * An absent or malformed `country` yields no results rather than the whole
 * catalog: `searchCities` decides that, and it is tested there. Failing open
 * would serve every Chinese city to a request that named no country — the
 * failure the China-only allowlist inside `PlaceSearch` used to hide, by
 * never letting such a request be made. Task 13 deleted that allowlist, so
 * this route is now the only thing standing between an unscoped query and
 * the whole China catalog.
 *
 * The GeoNames half of the catalog is searched in the browser, against the
 * shard the picker already fetched — public/ is unreadable from a lambda.
 *
 * No Cache-Control: the response is keyed by free text, so entries are not
 * shared between users and a cache window buys little. Same reasoning
 * app/api/airports/search/route.ts records for its own short window.
 */
export async function GET(req: NextRequest) {
  await ensureCatalogLoaded();
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const country = req.nextUrl.searchParams.get("country") ?? "";
  const status = catalogStatus();
  if (!status.available) {
    return NextResponse.json({ available: false, results: [] });
  }
  return NextResponse.json({
    available: true,
    generatedAt: status.generatedAt,
    total: status.cities,
    results: q.trim().length >= 2 ? searchCities(q, country) : [],
  });
}
