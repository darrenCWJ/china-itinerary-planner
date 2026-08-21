import { NextRequest, NextResponse } from "next/server";
import { ensureCatalogLoaded } from "@/lib/server/catalog";
import { buildTripData } from "@/lib/server/planService";
import { CreateTripSchema } from "@/lib/server/schemas";
import { getSessionUser } from "@/lib/server/session";
import {
  createTrip,
  DB_UNAVAILABLE,
  linkMemberAccount,
  setCurrencySettings,
  storeMode,
} from "@/lib/server/store";
import { initialCurrencySettings } from "@/lib/tripShared";
import { resolveTripSeason } from "@/lib/tripSeason";

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

  const { tripName, startDate, input, month } = parsed.data;
  // Spec §5.2: the month is the fact; the season the client derived from it with
  // a northern-hemisphere table is not trusted when the month is available.
  const season = resolveTripSeason(input.season, month, input.country);
  await ensureCatalogLoaded();
  const data = buildTripData({
    tripName,
    startDate: startDate ?? null,
    input: { ...input, season },
  });
  if (data.plan.days.length === 0) {
    return NextResponse.json(
      { error: "No plannable destinations in the selection" },
      { status: 400 }
    );
  }

  const creatorName = user.name.trim().slice(0, 30) || user.email.split("@")[0].slice(0, 30);
  const { id, joinCode } = await createTrip(data, creatorName);
  // Stamp the pivot the trip's rates will be expressed against (Task 8).
  // Best-effort and actually best-effort now: a thrown error is caught and
  // logged rather than rejecting this handler, so it can never skip the
  // creator-linking step below or orphan the trip. A failed write just
  // leaves the trip reading the legacy absent-pivot default (see
  // initialCurrencySettings), never a wrong or corrupted one.
  try {
    await setCurrencySettings(id, initialCurrencySettings(input.country));
  } catch (error) {
    console.error(`trip create: currency stamp failed (${error}) for trip ${id}`);
  }
  const linked = await linkMemberAccount(id, creatorName, user.id);
  if (linked !== "linked") {
    console.error(`trip create: creator link failed (${linked}) for trip ${id}`);
    return NextResponse.json(
      { error: "Trip was created but your account couldn't be linked — try opening it and joining with the code." },
      { status: 500 }
    );
  }
  return NextResponse.json({ id, joinCode }, { status: 201 });
}
