import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/server/authz";
import { ToggleCheckSchema } from "@/lib/server/schemas";
import { DB_UNAVAILABLE, getTrip, setCheck, storeMode } from "@/lib/server/store";

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

  const parsed = ToggleCheckSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid check", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  await setCheck(id, parsed.data.key, gate.memberName, parsed.data.checked);
  const payload = await getTrip(id, gate.memberName);
  return NextResponse.json({ ...payload, myMemberName: gate.memberName });
}
