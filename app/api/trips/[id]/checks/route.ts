import { NextRequest, NextResponse } from "next/server";
import { ToggleCheckSchema } from "@/lib/server/schemas";
import { DB_UNAVAILABLE, getTrip, isMember, setCheck, storeMode } from "@/lib/server/store";

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

  const parsed = ToggleCheckSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid check", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (!(await getTrip(id))) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  if (!(await isMember(id, parsed.data.memberName))) {
    return NextResponse.json({ error: "Only trip members can tick items" }, { status: 403 });
  }

  await setCheck(id, parsed.data.key, parsed.data.memberName, parsed.data.checked);
  return NextResponse.json(await getTrip(id, parsed.data.memberName));
}
