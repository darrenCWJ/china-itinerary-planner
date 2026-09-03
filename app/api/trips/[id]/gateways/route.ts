import { NextRequest, NextResponse } from "next/server";
import { findAirport } from "@/lib/server/airports";
import { requireMember } from "@/lib/server/authz";
import { GatewaysSchema } from "@/lib/server/schemas";
import { DB_UNAVAILABLE, getTrip, storeMode, updateTripDataIf } from "@/lib/server/store";
import { withGateways } from "@/lib/tripGateways";

/** Re-read/re-apply attempts when another member writes concurrently. */
const MAX_WRITE_ATTEMPTS = 3;

type Params = { params: Promise<{ id: string }> };

/**
 * Set the airports a trip flies into and out of (spec §10.3).
 *
 * Its own route, never PATCH /api/trips/[id]: PATCH rebuilds the plan and
 * clears every schedule tick, and a gateway is a fact about the trip, not a
 * reason to throw the members' draft away. This writes `input` alone, under
 * the same version guard the plan route uses, and touches nothing else.
 *
 * A code has to exist in the airports artifact. The editor suggests real
 * airports but stays a text field, so a typo arrives here as a well-formed
 * unknown code — and a gateway nothing can draw or name is not worth storing.
 */
export async function PUT(req: NextRequest, { params }: Params) {
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

  const parsed = GatewaysSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid gateways", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  for (const code of [parsed.data.arrivalAirport, parsed.data.departureAirport]) {
    if (code !== null && findAirport(code) === null) {
      return NextResponse.json({ error: `Unknown airport code ${code}` }, { status: 400 });
    }
  }

  // Optimistic concurrency, exactly as the plan route does it: re-read and
  // re-apply if another member's write lands between our read and our
  // version-guarded write, so nobody's edit is silently overwritten.
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const trip = await getTrip(id);
    if (!trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }
    const next = withGateways(trip.data, {
      arrival: parsed.data.arrivalAirport,
      departure: parsed.data.departureAirport,
    });
    const written = await updateTripDataIf(id, next, trip.version);
    if (!written) continue;
    const payload = await getTrip(id, gate.memberName);
    return NextResponse.json({ ...payload, myMemberName: gate.memberName });
  }

  return NextResponse.json(
    { error: "The trip is being edited by someone else right now — try again." },
    { status: 409 }
  );
}
