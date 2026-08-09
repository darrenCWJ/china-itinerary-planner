import { NextRequest, NextResponse } from "next/server";
import { catalogStatus, ensureCatalogLoaded, searchCities } from "@/lib/server/catalog";

export async function GET(req: NextRequest) {
  await ensureCatalogLoaded();
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const status = catalogStatus();
  if (!status.available) {
    return NextResponse.json({ available: false, results: [] });
  }
  return NextResponse.json({
    available: true,
    generatedAt: status.generatedAt,
    total: status.cities,
    results: q.trim().length >= 2 ? searchCities(q) : [],
  });
}
