import { NextRequest, NextResponse } from "next/server";
import { newId } from "@/lib/id";
import type { JournalEntry } from "@/lib/tripShared";
import { requireMember } from "@/lib/server/authz";
import { AddJournalSchema } from "@/lib/server/schemas";
import { addJournalEntry, DB_UNAVAILABLE, getTrip, storeMode } from "@/lib/server/store";

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

  const parsed = AddJournalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid journal entry", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const now = Date.now();
  const entry: JournalEntry = {
    id: newId(),
    date: parsed.data.entry.date,
    text: parsed.data.entry.text,
    photos: parsed.data.entry.photos,
    by: gate.memberName,
    createdAt: now,
    updatedAt: now,
  };
  const added = await addJournalEntry(id, entry);
  if (!added) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const payload = await getTrip(id, gate.memberName);
  return NextResponse.json({ ...payload, myMemberName: gate.memberName }, { status: 201 });
}
