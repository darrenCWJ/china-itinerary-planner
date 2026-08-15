import { NextRequest, NextResponse } from "next/server";
import { newId } from "@/lib/id";
import type { Settlement } from "@/lib/tripShared";
import { requireMember } from "@/lib/server/authz";
import { AddSettlementSchema } from "@/lib/server/schemas";
import { addSettlement, DB_UNAVAILABLE, getTrip, storeMode } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

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

  const parsed = AddSettlementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid settlement", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const trip = await getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const memberNames = trip.members.map((m) => m.name);
  const f = parsed.data.settlement;
  if (f.from === f.to) {
    return NextResponse.json({ error: "Payer and receiver must differ" }, { status: 400 });
  }
  const unknown = [f.from, f.to].find((n) => !memberNames.includes(n));
  if (unknown) {
    return NextResponse.json({ error: `"${unknown}" is not a trip member` }, { status: 400 });
  }

  const settlement: Settlement = {
    id: newId(),
    date: f.date,
    from: f.from,
    to: f.to,
    amount: f.amount,
    currency: f.currency,
    recordedBy: gate.memberName,
    createdAt: Date.now(),
  };
  await addSettlement(id, settlement);
  const payload = await getTrip(id, gate.memberName);
  return NextResponse.json({ ...payload, myMemberName: gate.memberName }, { status: 201 });
}
