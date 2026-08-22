import { NextRequest, NextResponse } from "next/server";
import type { Airport } from "@/lib/airports";
import { searchAirports } from "@/lib/server/airports";

/** Below this every query matches thousands of rows. Mirrors /api/destinations. */
const MIN_QUERY = 2;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const results: Airport[] = q.trim().length >= MIN_QUERY ? searchAirports(q) : [];
  return NextResponse.json({ results });
}
