import { NextRequest, NextResponse } from "next/server";
import { newId } from "@/lib/id";
import type { Expense } from "@/lib/tripShared";
import { AddExpenseSchema } from "@/lib/server/schemas";
import { addExpense, DB_UNAVAILABLE, getTrip, storeMode } from "@/lib/server/store";

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

  const parsed = AddExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid expense", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const trip = await getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const memberNames = trip.members.map((m) => m.name);
  if (!memberNames.includes(parsed.data.memberName)) {
    return NextResponse.json({ error: "Only trip members can add expenses" }, { status: 403 });
  }
  const f = parsed.data.expense;
  const named = [f.paidBy, ...f.splitAmong];
  const unknown = named.find((n) => !memberNames.includes(n));
  if (unknown) {
    return NextResponse.json({ error: `"${unknown}" is not a trip member` }, { status: 400 });
  }

  const expense: Expense = {
    id: newId(),
    date: f.date,
    title: f.title,
    category: f.category,
    amount: f.amount,
    currency: f.currency,
    paidBy: f.paidBy,
    splitAmong: f.splitAmong,
    notes: f.notes ? f.notes : null,
    addedBy: parsed.data.memberName,
    createdAt: Date.now(),
  };
  await addExpense(id, expense);
  return NextResponse.json(await getTrip(id, parsed.data.memberName), { status: 201 });
}
