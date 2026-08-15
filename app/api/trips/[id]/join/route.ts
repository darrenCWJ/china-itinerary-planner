import { NextRequest, NextResponse } from "next/server";
import { JoinTripSchema } from "@/lib/server/schemas";
import { getSessionUser } from "@/lib/server/session";
import { accountsEnabled, ACCOUNTS_UNAVAILABLE } from "@/lib/server/auth";
import {
  DB_UNAVAILABLE,
  getTrip,
  isNameClaimed,
  joinCodeMatches,
  joinTrip,
  linkMemberAccount,
  memberNameForUser,
  storeMode,
} from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  if (!accountsEnabled()) {
    return NextResponse.json({ error: ACCOUNTS_UNAVAILABLE }, { status: 503 });
  }
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Sign in to join a trip" }, { status: 401 });
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
      { error: "Invalid join request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (!(await joinCodeMatches(id, parsed.data.code))) {
    return NextResponse.json({ error: "Wrong join code" }, { status: 403 });
  }

  // Claiming an existing (legacy) member name inherits its history.
  if (parsed.data.claimName) {
    const result = await linkMemberAccount(id, parsed.data.claimName, user.id);
    if (result === "name-claimed") {
      return NextResponse.json(
        { error: `"${parsed.data.claimName}" is already claimed by another account` },
        { status: 409 }
      );
    }
    if (result === "not-found") {
      return NextResponse.json({ error: "No such member name on this trip" }, { status: 404 });
    }
    if (result === "user-already-member") {
      // Caller is already linked under a different name — no link was
      // created here, so report their real name, not the claimed one.
      const actualName = await memberNameForUser(id, user.id);
      const payload = await getTrip(id, actualName ?? undefined);
      return NextResponse.json({ ...payload, myMemberName: actualName ?? undefined });
    }
    // "linked" — this IS their name now, including the idempotent
    // reclaim-own-name case.
    const payload = await getTrip(id, parsed.data.claimName);
    return NextResponse.json({ ...payload, myMemberName: parsed.data.claimName });
  }

  // New membership under the account's display name (deduplicated).
  // The common case: caller is already linked to a member on this trip —
  // resolve and return that, never touching joinTrip/member rows.
  const existing = await memberNameForUser(id, user.id);
  if (existing) {
    const payload = await getTrip(id, existing);
    return NextResponse.json({ ...payload, myMemberName: existing });
  }

  const trip = await getTrip(id);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  const base = user.name.trim().slice(0, 30) || user.email.split("@")[0].slice(0, 30);
  // A name is unavailable only when it exists AND is claimed by another
  // account; an unclaimed legacy name of the same spelling is also skipped
  // (joining under it would silently merge histories — claiming is explicit).
  const taken = async (n: string): Promise<boolean> => {
    if (!trip.members.some((m) => m.name === n)) return false;
    return true; // existing name, claimed or not — pick a fresh one
  };
  let name = base;
  let suffix = 2;
  while (await taken(name)) {
    name = `${base.slice(0, 30 - String(suffix).length - 1)} ${suffix}`;
    suffix += 1;
  }
  const joined = await joinTrip(id, parsed.data.code, name);
  if (joined === "not-found") {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const linked = await linkMemberAccount(id, name, user.id);
  if (linked === "user-already-member") {
    // Genuine same-user concurrent-join race: another request already
    // linked this account (possibly under a different name) between our
    // dedup check and this join. Report the real linked name.
    const actualName = await memberNameForUser(id, user.id);
    const payload = await getTrip(id, actualName ?? undefined);
    return NextResponse.json({ ...payload, myMemberName: actualName ?? undefined });
  }
  if (linked === "name-claimed") {
    // Lost a race for this display name to a concurrent joiner — never
    // silently succeed under a name the caller isn't actually linked to.
    return NextResponse.json(
      { error: "That name was just claimed — try joining again" },
      { status: 409 }
    );
  }
  const payload = await getTrip(id, name);
  return NextResponse.json({ ...payload, myMemberName: name });
}

export async function GET(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  if (!accountsEnabled()) {
    return NextResponse.json({ error: ACCOUNTS_UNAVAILABLE }, { status: 503 });
  }
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Sign in to join a trip" }, { status: 401 });
  }
  const { id } = await params;
  const code = req.nextUrl.searchParams.get("code") ?? "";
  if (!(await joinCodeMatches(id, code))) {
    return NextResponse.json({ error: "Wrong join code" }, { status: 403 });
  }
  const trip = await getTrip(id);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  const claimable: string[] = [];
  for (const m of trip.members) {
    if (!(await isNameClaimed(id, m.name))) claimable.push(m.name);
  }
  return NextResponse.json({ claimable });
}
