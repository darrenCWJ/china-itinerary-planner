import { NextRequest, NextResponse } from "next/server";
import { newId } from "@/lib/id";
import { applyPlanOp } from "@/lib/planOps";
import { itemCheckKey } from "@/lib/tripShared";
import { ensureCatalogLoaded, resolveDestinations } from "@/lib/server/catalog";
import { requireMember } from "@/lib/server/authz";
import { PlanEditSchema } from "@/lib/server/schemas";
import { DB_UNAVAILABLE, getTrip, setCheck, storeMode, updateTripDataIf } from "@/lib/server/store";

/** Re-read/re-apply attempts when another member writes concurrently. */
const MAX_WRITE_ATTEMPTS = 3;

type Params = { params: Promise<{ id: string }> };

/** Apply one member edit (add/update/remove/move item, add day) to the plan. */
export async function POST(req: NextRequest, { params }: Params) {
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

  const parsed = PlanEditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid edit", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  await ensureCatalogLoaded();

  // Optimistic concurrency: re-read and re-apply if another member's write
  // lands between our read and our version-guarded write, so nobody's edit
  // is silently overwritten by a stale snapshot.
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const trip = await getTrip(id);
    if (!trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    const result = applyPlanOp(trip.data.plan, parsed.data.op, {
      newId,
      resolveDestinationName: (destId) => resolveDestinations([destId])[0]?.name ?? null,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const written = await updateTripDataIf(id, { ...trip.data, plan: result.plan }, trip.version);
    if (!written) continue;

    if (result.removedItemId) {
      await setCheck(id, itemCheckKey(result.removedItemId), "", false);
    }
    const payload = await getTrip(id, gate.memberName);
    return NextResponse.json({ ...payload, myMemberName: gate.memberName });
  }

  return NextResponse.json(
    { error: "The trip is being edited by someone else right now — try again." },
    { status: 409 }
  );
}
