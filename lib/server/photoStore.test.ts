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

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

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
