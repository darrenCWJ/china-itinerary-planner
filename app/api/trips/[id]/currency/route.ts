import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/server/authz";
import { CurrencySettingsSchema } from "@/lib/server/schemas";
import { DB_UNAVAILABLE, getTrip, setCurrencySettingsIf, storeMode } from "@/lib/server/store";
import { applyCurrencySettingsUpdate } from "@/lib/tripShared";

/** Re-read/re-apply attempts when another member writes concurrently. */
const MAX_WRITE_ATTEMPTS = 3;

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

  // Read-modify-write under the version guard the plan and gateways routes
  // use. The client never sends a pivot (it isn't editable — see
  // CurrencySettingsEditor), so the stored one is read and carried forward
  // by applyCurrencySettingsUpdate; and because two members can do that at
  // once, the write lands only if the trip's version is still the one that
  // was read. A lost race re-reads and re-applies rather than reverting the
  // other member's save.
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const before = await getTrip(id, gate.memberName);
    if (!before) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }
    const written = await setCurrencySettingsIf(
      id,
      applyCurrencySettingsUpdate(before.currencySettings, parsed.data),
      before.version
    );
    if (!written) continue;
    const payload = await getTrip(id, gate.memberName);
    return NextResponse.json({ ...payload, myMemberName: gate.memberName });
  }

  return NextResponse.json(
    { error: "The trip is being edited by someone else right now — try again." },
    { status: 409 }
  );
}
