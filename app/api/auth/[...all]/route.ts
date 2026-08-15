import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { accountsEnabled, ACCOUNTS_UNAVAILABLE, getAuth } from "@/lib/server/auth";

function guard() {
  return NextResponse.json({ error: ACCOUNTS_UNAVAILABLE }, { status: 503 });
}

const handler = () => toNextJsHandler(getAuth());

export async function GET(req: Request) {
  if (!accountsEnabled()) return guard();
  return handler().GET(req);
}

export async function POST(req: Request) {
  if (!accountsEnabled()) return guard();
  return handler().POST(req);
}
