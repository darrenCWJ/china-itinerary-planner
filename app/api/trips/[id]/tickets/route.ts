import { NextRequest, NextResponse } from "next/server";
import { newId } from "@/lib/id";
import type { Ticket } from "@/lib/tripShared";
import { requireMember } from "@/lib/server/authz";
import { AddTicketSchema } from "@/lib/server/schemas";
import { addTicket, DB_UNAVAILABLE, getTrip, storeMode } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

const clean = (v: string | null | undefined): string | null => (v ? v : null);

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

  const parsed = AddTicketSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ticket", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const f = parsed.data.ticket;
  const ticket: Ticket = {
    id: newId(),
    kind: f.kind,
    title: f.title,
    date: clean(f.date),
    endDate: clean(f.endDate),
    time: clean(f.time),
    from: clean(f.from),
    to: clean(f.to),
    confirmation: clean(f.confirmation),
    price: clean(f.price),
    notes: clean(f.notes),
    addedBy: gate.memberName,
  };
  const added = await addTicket(id, ticket);
  if (!added) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const payload = await getTrip(id, gate.memberName);
  return NextResponse.json({ ...payload, myMemberName: gate.memberName }, { status: 201 });
}
