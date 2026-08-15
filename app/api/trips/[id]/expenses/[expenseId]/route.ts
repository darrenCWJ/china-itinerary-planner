import { NextRequest, NextResponse } from "next/server";
import type { Expense } from "@/lib/tripShared";
import { requireMember } from "@/lib/server/authz";
import { UpdateExpenseSchema } from "@/lib/server/schemas";
import {
  DB_UNAVAILABLE,
  deleteExpense,
  getTrip,
  storeMode,
  updateExpense,
} from "@/lib/server/store";

type Params = { params: Promise<{ id: string; expenseId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id, expenseId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const gate = await requireMember(req, id);
  if (gate instanceof NextResponse) return gate;

  const parsed = UpdateExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid expense", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const trip = await getTrip(id);
  const existing = trip?.expenses.find((e) => e.id === expenseId);
  if (!trip || !existing) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }
  const memberNames = trip.members.map((m) => m.name);

  const f = parsed.data.expense;
  const merged: Expense = {
    ...existing,
    date: f.date ?? existing.date,
    title: f.title ?? existing.title,
    category: f.category ?? existing.category,
    amount: f.amount ?? existing.amount,
    currency: f.currency ?? existing.currency,
    paidBy: f.paidBy ?? existing.paidBy,
    splitAmong: f.splitAmong ?? existing.splitAmong,
    notes: f.notes === undefined ? existing.notes : f.notes ? f.notes : null,
  };
  const named = [merged.paidBy, ...merged.splitAmong];
  const unknown = named.find((n) => !memberNames.includes(n));
  if (unknown) {
    return NextResponse.json({ error: `"${unknown}" is not a trip member` }, { status: 400 });
  }

  await updateExpense(id, merged);
  const payload = await getTrip(id, gate.memberName);
  return NextResponse.json({ ...payload, myMemberName: gate.memberName });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id, expenseId } = await params;
  const gate = await requireMember(req, id);
  if (gate instanceof NextResponse) return gate;

  const deleted = await deleteExpense(id, expenseId);
  if (!deleted) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }
  const payload = await getTrip(id, gate.memberName);
  return NextResponse.json({ ...payload, myMemberName: gate.memberName });
}
