import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/server/authz";
import { CurrencySettingsSchema } from "@/lib/server/schemas";
import { DB_UNAVAILABLE, getTrip, setCurrencySettings, storeMode } from "@/lib/server/store";
import { applyCurrencySettingsUpdate } from "@/lib/tripShared";

type Params = { params: Promise<{ id: string }> };

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

  const parsed = CurrencySettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid currency settings", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Read-modify-write: the client never sends a pivot (it isn't editable —
  // see CurrencySettingsEditor), so the only way to avoid clobbering a
  // trip's stamped pivot with every home/rate save is to read the currently
  // stored one first and carry it forward. setCurrencySettings replaces the
  // whole settings blob, so skipping this read would silently erase the
  // pivot the moment anyone touched their home currency or a single rate.
  const before = await getTrip(id, gate.memberName);
  if (!before) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const saved = await setCurrencySettings(
    id,
    applyCurrencySettingsUpdate(before.currencySettings, parsed.data)
  );
  if (!saved) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const payload = await getTrip(id, gate.memberName);
  return NextResponse.json({ ...payload, myMemberName: gate.memberName });
}
