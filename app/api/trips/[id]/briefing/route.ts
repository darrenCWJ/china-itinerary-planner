import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/server/authz";
import { BriefingShareSchema } from "@/lib/server/schemas";
import {
  DB_UNAVAILABLE,
  enableBriefing,
  getBriefingForTrip,
  revokeBriefing,
  storeMode,
} from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

const NO_LINK = { code: null, includeBookings: false };

/** Current share state. Members only — the code is a bearer secret. */
export async function GET(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id } = await params;
  const gate = await requireMember(req, id);
  if (gate instanceof NextResponse) return gate;

  const record = await getBriefingForTrip(id);
  return NextResponse.json(record ?? NO_LINK);
}

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

  const parsed = BriefingShareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid briefing settings", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (!parsed.data.enabled) {
    await revokeBriefing(id);
    return NextResponse.json(NO_LINK);
  }

  const result = await enableBriefing(id, parsed.data.includeBookings);
  if (!result) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  return NextResponse.json({
    code: result.code,
    includeBookings: parsed.data.includeBookings,
  });
}
