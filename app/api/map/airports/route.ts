import { NextRequest, NextResponse } from "next/server";
import { airportsForCountry } from "@/lib/server/airports";

/**
 * Country-scoped so the client downloads ~260 airports for a China trip rather
 * than all 4,134. Mirrors /api/map/cities, including its cache window — the
 * artifact only changes when the daily workflow commits.
 */
export async function GET(req: NextRequest) {
  const country = req.nextUrl.searchParams.get("country") ?? "";
  return NextResponse.json(
    { airports: airportsForCountry(country) },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
