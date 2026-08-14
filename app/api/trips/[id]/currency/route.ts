import { NextRequest, NextResponse } from "next/server";
import { CurrencySettingsSchema } from "@/lib/server/schemas";
import {
  DB_UNAVAILABLE,
  getTrip,
  isMember,
  setCurrencySettings,
  storeMode,
} from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
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

  const parsed = CurrencySettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid currency settings", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (!(await isMember(id, parsed.data.memberName))) {
    return NextResponse.json(
      { error: "Only trip members can change currency settings" },
      { status: 403 }
    );
  }

  const saved = await setCurrencySettings(id, {
    home: parsed.data.home,
    rates: parsed.data.rates,
  });
  if (!saved) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  return NextResponse.json(await getTrip(id, parsed.data.memberName));
}
