import { NextRequest, NextResponse } from "next/server";
import { ensureCatalogLoaded } from "@/lib/server/catalog";
import { buildTripData } from "@/lib/server/planService";
import { UpdateTripSchema } from "@/lib/server/schemas";
import {
  clearScheduleChecks,
  DB_UNAVAILABLE,
  getTrip,
  isMember,
  storeMode,
  updateTripData,
} from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id } = await params;
  const member = req.nextUrl.searchParams.get("member") ?? undefined;
  const trip = await getTrip(id, member);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  return NextResponse.json(trip);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UpdateTripSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid update", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await getTrip(id);
  if (!existing) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  if (!(await isMember(id, parsed.data.memberName))) {
    return NextResponse.json({ error: "Only trip members can edit" }, { status: 403 });
  }

  await ensureCatalogLoaded();
  const data = buildTripData({
    tripName: parsed.data.tripName ?? existing.data.tripName,
    startDate:
      parsed.data.startDate !== undefined ? parsed.data.startDate : existing.data.startDate,
    input: parsed.data.input ?? existing.data.input,
  });
  if (data.plan.days.length === 0) {
    return NextResponse.json(
      { error: "No plannable destinations in the selection" },
      { status: 400 }
    );
  }
  await updateTripData(id, data);
  // The rebuilt plan has fresh item ids, so old schedule ticks are orphans.
  await clearScheduleChecks(id);
  return NextResponse.json(await getTrip(id, parsed.data.memberName));
}
