import { NextResponse } from "next/server";
import { catalogStatus, ensureCatalogLoaded, mapCities } from "@/lib/server/catalog";

export async function GET() {
  await ensureCatalogLoaded();
  const status = catalogStatus();
  if (!status.available) {
    return NextResponse.json({ available: false, cities: [] });
  }
  return NextResponse.json(
    { available: true, cities: mapCities() },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    }
  );
}
