import { NextRequest, NextResponse } from "next/server";
import { newId } from "@/lib/id";
import type { Ticket } from "@/lib/tripShared";
import { AddTicketSchema } from "@/lib/server/schemas";
import { addTicket, DB_UNAVAILABLE, getTrip, isMember, storeMode } from "@/lib/server/store";

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

  const parsed = AddTicketSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ticket", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (!(await isMember(id, parsed.data.memberName))) {
    return NextResponse.json({ error: "Only trip members can add tickets" }, { status: 403 });
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
    addedBy: parsed.data.memberName,
  };
  const added = await addTicket(id, ticket);
  if (!added) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  return NextResponse.json(await getTrip(id, parsed.data.memberName), { status: 201 });
}
