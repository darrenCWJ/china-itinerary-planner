import { NextRequest, NextResponse } from "next/server";
import { BriefingShareSchema } from "@/lib/server/schemas";
import {
  DB_UNAVAILABLE,
  enableBriefing,
  getBriefingForTrip,
  isMember,
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
  const member = req.nextUrl.searchParams.get("member") ?? "";
  if (!member || !(await isMember(id, member))) {
    return NextResponse.json({ error: "Only trip members can see the briefing link" }, { status: 403 });
  }
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

  const parsed = BriefingShareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid briefing settings", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (!(await isMember(id, parsed.data.memberName))) {
    return NextResponse.json(
      { error: "Only trip members can share the briefing" },
      { status: 403 }
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
