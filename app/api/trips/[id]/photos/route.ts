import { NextRequest, NextResponse } from "next/server";
import { requireMember } from "@/lib/server/authz";
import {
  MAX_PHOTO_BYTES,
  PHOTO_CONTENT_TYPES,
  PHOTOS_UNSUPPORTED,
  photoUploadsSupported,
  savePhoto,
} from "@/lib/server/photoStore";
import { DB_UNAVAILABLE, storeMode } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  if (!photoUploadsSupported()) {
    return NextResponse.json({ error: PHOTOS_UNSUPPORTED }, { status: 503 });
  }
  const declaredBytes = Number(req.headers.get("content-length") ?? 0);
  if (declaredBytes > MAX_PHOTO_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "Photo is larger than 8 MB" }, { status: 413 });
  }
  const { id } = await params;

  const gate = await requireMember(req, id);
  if (gate instanceof NextResponse) return gate;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const file = form.get("photo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing photo file" }, { status: 400 });
  }
  if (!PHOTO_CONTENT_TYPES[file.type]) {
    return NextResponse.json({ error: "Only JPEG, PNG or WebP photos" }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "Photo is larger than 8 MB" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const ref = savePhoto(id, bytes, file.type);
  if (!ref) {
    return NextResponse.json({ error: "Could not store the photo" }, { status: 500 });
  }
  return NextResponse.json({ ref }, { status: 201 });
}
