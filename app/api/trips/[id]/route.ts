import { NextRequest, NextResponse } from "next/server";
import { ensureCatalogLoaded } from "@/lib/server/catalog";
import { guestTripView } from "@/lib/redactTrip";
import { buildTripData } from "@/lib/server/planService";
import { requireMember, tripAccessFromRequest } from "@/lib/server/authz";
import { UpdateTripSchema } from "@/lib/server/schemas";
import { refuseUnknownGateways } from "@/lib/server/gatewayGuard";
import { carryGateways } from "@/lib/tripGateways";
import {
  clearScheduleChecks,
  DB_UNAVAILABLE,
  getTrip,
  storeMode,
  updateTripData,
} from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id } = await params;
  const access = await tripAccessFromRequest(req, id);
  if (access.kind === "none") {
    return NextResponse.json(
      { error: "This trip is private — enter its join code to view it.", private: true },
      { status: 403 }
    );
  }
  const payload = await getTrip(id, access.kind === "member" ? access.memberName : undefined);
  if (!payload) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  if (access.kind === "guest") {
    return NextResponse.json(guestTripView(payload));
  }
  return NextResponse.json({ ...payload, myMemberName: access.memberName });
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

  const gate = await requireMember(req, id);
  if (gate instanceof NextResponse) return gate;

  const parsed = UpdateTripSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid update", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // The check the other two doors make (create, PUT /gateways) — on what
  // arrives, not on what is stored: a code the nightly refresh has since
  // retired must not block a rebuild that never mentioned it.
  const refused = refuseUnknownGateways([
    parsed.data.input?.arrivalAirport,
    parsed.data.input?.departureAirport,
  ]);
  if (refused) return refused;

  const existing = await getTrip(id);
  if (!existing) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  await ensureCatalogLoaded();
  const data = buildTripData({
    tripName: parsed.data.tripName ?? existing.data.tripName,
    startDate:
      parsed.data.startDate !== undefined ? parsed.data.startDate : existing.data.startDate,
    // A rebuild sends a whole TripInput; one written before the gateway fields
    // existed omits them, and absent means "unchanged", never "cleared".
    input: parsed.data.input
      ? carryGateways(parsed.data.input, existing.data.input)
      : existing.data.input,
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
  const payload = await getTrip(id, gate.memberName);
  return NextResponse.json({ ...payload, myMemberName: gate.memberName });
}
