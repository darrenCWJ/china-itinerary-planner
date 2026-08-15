import { NextRequest, NextResponse } from "next/server";
import { ensureCatalogLoaded } from "@/lib/server/catalog";
import { buildTripData } from "@/lib/server/planService";
import { CreateTripSchema } from "@/lib/server/schemas";
import { getSessionUser } from "@/lib/server/session";
import { createTrip, DB_UNAVAILABLE, linkMemberAccount, storeMode } from "@/lib/server/store";

export async function POST(req: NextRequest) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }

  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Sign in to share a trip" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateTripSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid trip", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { tripName, startDate, input } = parsed.data;
  await ensureCatalogLoaded();
  const data = buildTripData({ tripName, startDate: startDate ?? null, input });
  if (data.plan.days.length === 0) {
    return NextResponse.json(
      { error: "No plannable destinations in the selection" },
      { status: 400 }
    );
  }

  const creatorName = user.name.trim().slice(0, 30) || user.email.split("@")[0].slice(0, 30);
  const { id, joinCode } = await createTrip(data, creatorName);
  await linkMemberAccount(id, creatorName, user.id);
  return NextResponse.json({ id, joinCode }, { status: 201 });
}
