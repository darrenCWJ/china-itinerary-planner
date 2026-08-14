import { NextRequest, NextResponse } from "next/server";
import { readPhoto } from "@/lib/server/photoStore";

type Params = { params: Promise<{ id: string; photoId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id, photoId } = await params;
  const photo = readPhoto(id, photoId);
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
