import { NextRequest, NextResponse } from "next/server";
import type { JournalEntry } from "@/lib/tripShared";
import { UpdateJournalSchema } from "@/lib/server/schemas";
import { deletePhoto } from "@/lib/server/photoStore";
import {
  DB_UNAVAILABLE,
  deleteJournalEntry,
  getTrip,
  storeMode,
  updateJournalEntry,
} from "@/lib/server/store";

type Params = { params: Promise<{ id: string; entryId: string }> };

/** Best-effort removal of uploaded files no longer referenced by the entry. */
function cleanupUploads(tripId: string, before: JournalEntry, after: JournalEntry | null): void {
  const kept = new Set(
    (after?.photos ?? []).filter((p) => p.kind === "upload").map((p) => p.ref)
  );
  for (const photo of before.photos) {
    if (photo.kind === "upload" && !kept.has(photo.ref)) deletePhoto(tripId, photo.ref);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id, entryId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UpdateJournalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid journal entry", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const trip = await getTrip(id);
  const existing = trip?.journal.find((e) => e.id === entryId);
  if (!trip || !existing) {
    return NextResponse.json({ error: "Journal entry not found" }, { status: 404 });
  }
  if (existing.by !== parsed.data.memberName) {
    return NextResponse.json(
      { error: "Only the author can edit a journal entry" },
      { status: 403 }
    );
  }

  const f = parsed.data.entry;
  const merged: JournalEntry = {
    ...existing,
    date: f.date ?? existing.date,
    text: f.text ?? existing.text,
    photos: f.photos ?? existing.photos,
    updatedAt: Date.now(),
  };
  await updateJournalEntry(id, merged);
  cleanupUploads(id, existing, merged);
  return NextResponse.json(await getTrip(id, parsed.data.memberName));
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id, entryId } = await params;
  const member = req.nextUrl.searchParams.get("member") ?? "";

  const trip = await getTrip(id);
  const existing = trip?.journal.find((e) => e.id === entryId);
  if (!trip || !existing) {
    return NextResponse.json({ error: "Journal entry not found" }, { status: 404 });
  }
  if (!member || existing.by !== member) {
    return NextResponse.json(
      { error: "Only the author can delete a journal entry" },
      { status: 403 }
    );
  }

  await deleteJournalEntry(id, entryId);
  cleanupUploads(id, existing, null);
  return NextResponse.json(await getTrip(id, member));
}
