import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cip-photos-"));
process.env.CIP_UPLOADS_DIR = uploadsDir;

// Imported after the env override so the store uses the temp directory.
import {
  deletePhoto,
  photoUploadsSupported,
  readPhoto,
  resetPhotoProbeForTests,
  savePhoto,
} from "./photoStore";

/** SOI, then an APP0 marker: how a JPEG begins. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
/** The PNG signature, then the IHDR chunk's length and type. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
/** "RIFF", the chunk size (any value), "WEBP", then a VP8 chunk tag. */
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
/** An ISO-BMFF ftyp box with major brand "avif". */
const AVIF = Buffer.concat([
  Buffer.from([0, 0, 0, 0x1c]),
  Buffer.from("ftypavif"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("avifmif1miaf"),
]);

describe("photoStore", () => {
  beforeAll(() => resetPhotoProbeForTests());
  afterAll(() => fs.rmSync(uploadsDir, { recursive: true, force: true }));

  test("uploads are supported on a writable filesystem", () => {
    expect(photoUploadsSupported()).toBe(true);
  });

  test("save → read round-trip preserves bytes and content type", () => {
    const ref = savePhoto("abc123def0", JPEG, "image/jpeg");
    expect(ref).toMatch(/^[a-z0-9-]+\.jpg$/);
    const photo = readPhoto("abc123def0", ref!);
    expect(photo).not.toBeNull();
    expect(photo!.contentType).toBe("image/jpeg");
    expect(Buffer.compare(photo!.bytes, JPEG)).toBe(0);
  });

  test("unknown content types are rejected", () => {
    expect(savePhoto("abc123def0", JPEG, "image/gif")).toBeNull();
    expect(savePhoto("abc123def0", JPEG, "text/html")).toBeNull();
  });

  test("PNG and WebP bytes are stored under their own extensions", () => {
    expect(savePhoto("abc123def0", PNG, "image/png")).toMatch(/^[a-z0-9-]+\.png$/);
    expect(savePhoto("abc123def0", WEBP, "image/webp")).toMatch(/^[a-z0-9-]+\.webp$/);
  });

  test("bytes that are not the declared type are refused", () => {
    // The declared type is the client's word. AVIF must not be stored as
    // .jpg and served back as image/jpeg...
    expect(savePhoto("abc123def0", AVIF, "image/jpeg")).toBeNull();
    // ...and no accepted type may pass as another.
    expect(savePhoto("abc123def0", PNG, "image/jpeg")).toBeNull();
    expect(savePhoto("abc123def0", JPEG, "image/webp")).toBeNull();
    expect(savePhoto("abc123def0", WEBP, "image/png")).toBeNull();
    // A RIFF container is only WebP when it says "WEBP" at byte 8.
    const wave = Buffer.concat([WEBP.subarray(0, 8), Buffer.from("WAVEfmt ")]);
    expect(savePhoto("abc123def0", wave, "image/webp")).toBeNull();
  });

  test("a file cut off before the end of its type's signature is refused", () => {
    expect(savePhoto("abc123def0", JPEG.subarray(0, 2), "image/jpeg")).toBeNull();
    expect(savePhoto("abc123def0", PNG.subarray(0, 7), "image/png")).toBeNull();
    expect(savePhoto("abc123def0", WEBP.subarray(0, 11), "image/webp")).toBeNull();
    expect(savePhoto("abc123def0", Buffer.alloc(0), "image/jpeg")).toBeNull();
  });

  test("hostile refs and trip ids never resolve", () => {
    for (const ref of ["../../../etc/passwd", "a/b.jpg", "x.exe", "..\\..\\x.jpg"]) {
      expect(readPhoto("abc123def0", ref)).toBeNull();
    }
    const ref = savePhoto("abc123def0", JPEG, "image/jpeg")!;
    expect(readPhoto("../abc123def0", ref)).toBeNull();
  });

  test("delete removes the file, deleting twice is harmless", () => {
    const ref = savePhoto("abc123def0", JPEG, "image/jpeg")!;
    deletePhoto("abc123def0", ref);
    expect(readPhoto("abc123def0", ref)).toBeNull();
    deletePhoto("abc123def0", ref); // no throw
  });
});
