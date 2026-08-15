import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/server/authz";
import { DB_UNAVAILABLE, deleteSettlement, getTrip, storeMode } from "@/lib/server/store";

type Params = { params: Promise<{ id: string; settlementId: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id, settlementId } = await params;
  const gate = await requireMember(req, id);
  if (gate instanceof NextResponse) return gate;

  const deleted = await deleteSettlement(id, settlementId);
  if (!deleted) {
    return NextResponse.json({ error: "Repayment not found" }, { status: 404 });
  }
  const payload = await getTrip(id, gate.memberName);
  return NextResponse.json({ ...payload, myMemberName: gate.memberName });
}
