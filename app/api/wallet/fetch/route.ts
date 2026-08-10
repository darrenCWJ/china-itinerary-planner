import { NextRequest, NextResponse } from "next/server";
import { WalletFetchSchema } from "@/lib/server/schemas";
import { DB_UNAVAILABLE, getWallet, storeMode } from "@/lib/server/store";

/** POST (not GET) so the secret code travels in the body, not the URL. */
export async function POST(req: NextRequest) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = WalletFetchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  const wallet = await getWallet(parsed.data.code.toUpperCase());
  if (!wallet) {
    return NextResponse.json({ error: "Code not found" }, { status: 404 });
  }
  return NextResponse.json(wallet);
}
