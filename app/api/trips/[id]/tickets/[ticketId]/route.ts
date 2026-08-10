import { NextRequest, NextResponse } from "next/server";
import type { Ticket } from "@/lib/tripShared";
import { UpdateTicketSchema } from "@/lib/server/schemas";
import {
  DB_UNAVAILABLE,
  deleteTicket,
  getTrip,
  isMember,
  storeMode,
  updateTicket,
} from "@/lib/server/store";

type Params = { params: Promise<{ id: string; ticketId: string }> };

const clean = (v: string | null | undefined): string | null => (v ? v : null);

export async function PATCH(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id, ticketId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UpdateTicketSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ticket", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (!(await isMember(id, parsed.data.memberName))) {
    return NextResponse.json({ error: "Only trip members can edit tickets" }, { status: 403 });
  }

  const trip = await getTrip(id);
  const existing = trip?.tickets.find((t) => t.id === ticketId);
  if (!trip || !existing) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  const f = parsed.data.ticket;
  const merged: Ticket = {
    ...existing,
    kind: f.kind ?? existing.kind,
    title: f.title ?? existing.title,
    date: f.date === undefined ? existing.date : clean(f.date),
    endDate: f.endDate === undefined ? existing.endDate : clean(f.endDate),
    time: f.time === undefined ? existing.time : clean(f.time),
    from: f.from === undefined ? existing.from : clean(f.from),
    to: f.to === undefined ? existing.to : clean(f.to),
    confirmation: f.confirmation === undefined ? existing.confirmation : clean(f.confirmation),
    price: f.price === undefined ? existing.price : clean(f.price),
    notes: f.notes === undefined ? existing.notes : clean(f.notes),
  };
  await updateTicket(id, merged);
  return NextResponse.json(await getTrip(id, parsed.data.memberName));
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id, ticketId } = await params;
  const member = req.nextUrl.searchParams.get("member") ?? "";
  if (!member || !(await isMember(id, member))) {
    return NextResponse.json({ error: "Only trip members can delete tickets" }, { status: 403 });
  }
  const deleted = await deleteTicket(id, ticketId);
  if (!deleted) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }
  return NextResponse.json(await getTrip(id, member));
}
