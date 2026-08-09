import { NextRequest, NextResponse } from "next/server";
import { ensureCatalogLoaded } from "@/lib/server/catalog";
import { buildTripData } from "@/lib/server/planService";
import { CreateTripSchema } from "@/lib/server/schemas";
import { createTrip, DB_UNAVAILABLE, storeMode } from "@/lib/server/store";

export async function POST(req: NextRequest) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateTripSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid trip", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { tripName, creatorName, startDate, input } = parsed.data;
  await ensureCatalogLoaded();
  const data = buildTripData({ tripName, startDate: startDate ?? null, input });
  if (data.plan.days.length === 0) {
    return NextResponse.json(
      { error: "No plannable destinations in the selection" },
      { status: 400 }
    );
  }

  const { id, joinCode } = await createTrip(data, creatorName);
  return NextResponse.json({ id, joinCode }, { status: 201 });
}
