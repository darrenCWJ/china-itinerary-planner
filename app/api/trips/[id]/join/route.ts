import { NextRequest, NextResponse } from "next/server";
import { JoinTripSchema } from "@/lib/server/schemas";
import { DB_UNAVAILABLE, getTrip, joinTrip, storeMode } from "@/lib/server/store";

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

  const parsed = JoinTripSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter your name and the join code", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await joinTrip(id, parsed.data.code, parsed.data.name);
  if (result === "not-found") {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  if (result === "bad-code") {
    return NextResponse.json({ error: "That join code doesn't match this trip" }, { status: 403 });
  }
  return NextResponse.json(await getTrip(id, parsed.data.name));
}
