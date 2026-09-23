import fs from "node:fs";
import path from "node:path";
import { newId } from "@/lib/id";
import { PHOTO_REF_RE } from "./schemas";

export const PHOTOS_UNSUPPORTED =
  "Photo uploads need a writable disk (e.g. self-hosted). On this host, attach photos as https links instead.";

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const PHOTO_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const EXT_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** The leading bytes of each accepted type; `null` matches any byte. */
const PHOTO_SIGNATURES: Record<string, ReadonlyArray<number | null>> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  // "RIFF", the 4-byte chunk size, "WEBP".
  "image/webp": [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
};

/**
 * The accepted type the bytes start with, or null. An upload's declared type
 * is only the client's word, so savePhoto stores nothing this disagrees with.
 */
export function sniffPhotoType(bytes: Uint8Array): string | null {
  for (const [type, signature] of Object.entries(PHOTO_SIGNATURES)) {
    if (bytes.length >= signature.length && signature.every((b, i) => b === null || bytes[i] === b)) {
      return type;
    }
  }
  return null;
}

const TRIP_ID_RE = /^[a-z0-9-]{4,60}$/i;

/** Overridable for tests via CIP_UPLOADS_DIR. */
function uploadsRoot(): string {
  return process.env.CIP_UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads", "trips");
}

let probed: boolean | null = null;

/** Cached probe: can this host persist files? Serverless hosts cannot. */
export function photoUploadsSupported(): boolean {
  if (probed !== null) return probed;
  if (process.env.VERCEL) {
    probed = false;
    return false;
  }
  try {
    fs.mkdirSync(uploadsRoot(), { recursive: true });
    const probe = path.join(uploadsRoot(), ".probe");
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    probed = true;
  } catch {
    probed = false;
  }
  return probed;
}

export function resetPhotoProbeForTests(): void {
  probed = null;
}

/** Both segments are validated before any path join — no user input in paths. */
function photoPath(tripId: string, ref: string): string | null {
  if (!TRIP_ID_RE.test(tripId) || !PHOTO_REF_RE.test(ref)) return null;
  return path.join(uploadsRoot(), tripId, ref);
}

/**
 * Returns the stored ref ("<uuid>.<ext>") or null when unsupported/invalid,
 * including bytes that do not start with the declared type's signature.
 */
export function savePhoto(tripId: string, bytes: Buffer, contentType: string): string | null {
  const ext = PHOTO_CONTENT_TYPES[contentType];
  if (!ext || sniffPhotoType(bytes) !== contentType) return null;
  if (!photoUploadsSupported() || bytes.length > MAX_PHOTO_BYTES) return null;
  const ref = `${newId().toLowerCase()}.${ext}`;
  const target = photoPath(tripId, ref);
  if (!target) return null;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    return ref;
  } catch {
    return null;
  }
}

export function readPhoto(
  tripId: string,
  ref: string
): { bytes: Buffer; contentType: string } | null {
  const target = photoPath(tripId, ref);
  if (!target) return null;
  const ext = ref.slice(ref.lastIndexOf(".") + 1);
  const contentType = EXT_CONTENT_TYPES[ext];
  if (!contentType) return null;
  try {
    return { bytes: fs.readFileSync(target), contentType };
  } catch {
    return null;
  }
}

/** Best-effort: orphaned files are acceptable, crashes are not. */
export function deletePhoto(tripId: string, ref: string): void {
  const target = photoPath(tripId, ref);
  if (!target) return;
  try {
    fs.rmSync(target, { force: true });
  } catch {
    // ignore
  }
}
