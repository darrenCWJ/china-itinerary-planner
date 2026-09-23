import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Drives the real POST handler with membership and the store mocked, the way
 * currencyRoute.test.ts does. The photo store is real and writes to a temp
 * directory, so "nothing was stored" is read off the disk, not off a mock.
 */
const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cip-photos-route-"));
process.env.CIP_UPLOADS_DIR = uploadsDir;

vi.mock("@/lib/server/authz", () => ({ requireMember: vi.fn() }));
vi.mock("@/lib/server/store", () => ({
  storeMode: () => "sqlite",
  DB_UNAVAILABLE: "unavailable",
}));

const { POST } = await import("@/app/api/trips/[id]/photos/route");
const { requireMember } = await import("@/lib/server/authz");
const { PHOTO_CONTENT_TYPES, readPhoto } = await import("@/lib/server/photoStore");
const { NextRequest } = await import("next/server");

const TRIP = "trip-1";
const params = { params: Promise.resolve({ id: TRIP }) };

/** A multipart upload whose part declares `type` — the client's word only. */
function upload(bytes: Uint8Array, type: string) {
  const form = new FormData();
  form.append("photo", new File([new Uint8Array(bytes)], "photo", { type }));
  return new NextRequest(`http://localhost/api/trips/${TRIP}/photos`, { method: "POST", body: form });
}

function storedFiles(): string[] {
  const dir = path.join(uploadsDir, TRIP);
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

/** SOI, then a JFIF APP0 segment: how an encoder's JPEG begins. */
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00,
]);
/** The PNG signature, then the IHDR chunk's length and type. */
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
/** An ISO-BMFF ftyp box with major brand "avif": how an AVIF file begins. */
const AVIF = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x1c]),
  Buffer.from("ftypavif"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("avifmif1miaf"),
]);

beforeEach(() => {
  vi.mocked(requireMember).mockReset();
  vi.mocked(requireMember).mockResolvedValue({ memberName: "Ada" });
});
afterAll(() => fs.rmSync(uploadsDir, { recursive: true, force: true }));

describe("POST /api/trips/:id/photos", () => {
  test("a real JPEG header declared as image/jpeg is stored as .jpg", async () => {
    const res = await POST(upload(JPEG, "image/jpeg"), params);
    expect(res.status).toBe(201);
    const { ref } = await res.json();
    expect(ref).toMatch(/\.jpg$/);
    expect(Buffer.compare(readPhoto(TRIP, ref)!.bytes, JPEG)).toBe(0);
  });

  test("AVIF bytes declared as image/jpeg are refused, and nothing is stored", async () => {
    const before = storedFiles();
    const res = await POST(upload(AVIF, "image/jpeg"), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Only JPEG, PNG or WebP photos" });
    expect(storedFiles()).toEqual(before);
  });

  test("PNG bytes declared as image/jpeg are refused: the bytes must be the declared type", async () => {
    const before = storedFiles();
    const res = await POST(upload(PNG, "image/jpeg"), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Only JPEG, PNG or WebP photos" });
    expect(storedFiles()).toEqual(before);
  });

  test("a file cut off before the end of its signature is refused, and nothing is stored", async () => {
    const before = storedFiles();
    for (const [label, bytes] of [
      ["the first two bytes of a JPEG", JPEG.subarray(0, 2)],
      ["an empty file", Buffer.alloc(0)],
    ] as const) {
      const res = await POST(upload(bytes, "image/jpeg"), params);
      expect(res.status, label).toBe(400);
      expect(await res.json(), label).toEqual({ error: "Only JPEG, PNG or WebP photos" });
    }
    expect(storedFiles()).toEqual(before);
  });

  test("a declared type that names an Object.prototype key is refused with a 400", async () => {
    // A plain PHOTO_CONTENT_TYPES[file.type] lookup finds a value for both,
    // through the prototype chain. Before the byte check, the route passed
    // them on to savePhoto and answered with a 500.
    for (const type of ["constructor", "__proto__"]) {
      expect(PHOTO_CONTENT_TYPES[type], type).toBeTruthy();
      const res = await POST(upload(JPEG, type), params);
      expect(res.status, type).toBe(400);
      expect(await res.json(), type).toEqual({ error: "Only JPEG, PNG or WebP photos" });
    }
  });
});
