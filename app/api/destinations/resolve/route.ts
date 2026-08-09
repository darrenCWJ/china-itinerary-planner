import { NextRequest, NextResponse } from "next/server";
import { ensureCatalogLoaded, resolveDestinations } from "@/lib/server/catalog";

const MAX_IDS = 12;

export async function GET(req: NextRequest) {
  await ensureCatalogLoaded();
  const idsParam = req.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);
  if (ids.length === 0) {
    return NextResponse.json({ destinations: [] });
  }
  return NextResponse.json({ destinations: resolveDestinations(ids) });
}
