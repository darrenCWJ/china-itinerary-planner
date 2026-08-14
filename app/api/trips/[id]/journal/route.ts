import { NextRequest, NextResponse } from "next/server";
import { newId } from "@/lib/id";
import type { JournalEntry } from "@/lib/tripShared";
import { AddJournalSchema } from "@/lib/server/schemas";
import { addJournalEntry, DB_UNAVAILABLE, getTrip, isMember, storeMode } from "@/lib/server/store";

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

  const parsed = AddJournalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid journal entry", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (!(await isMember(id, parsed.data.memberName))) {
    return NextResponse.json(
      { error: "Only trip members can write journal entries" },
      { status: 403 }
    );
  }

  const now = Date.now();
  const entry: JournalEntry = {
    id: newId(),
    date: parsed.data.entry.date,
    text: parsed.data.entry.text,
    photos: parsed.data.entry.photos,
    by: parsed.data.memberName,
    createdAt: now,
    updatedAt: now,
  };
  const added = await addJournalEntry(id, entry);
  if (!added) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  return NextResponse.json(await getTrip(id, parsed.data.memberName), { status: 201 });
}
