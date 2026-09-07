/**
 * ingest-climate — reading a raster's tags, and putting one on disk.
 *
 * Moved out of scripts/ingest-climate.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-climate.mjs was split
 * along its section banners. Every describe below is that file's, unchanged,
 * along with the `vitest` and `node:` imports `ensureRaster`'s own block
 * declares mid-file; only the module import path moved with them.
 */

import { describe, expect, test } from "vitest";
import { ensureRaster, readScaling } from "./acquire.mjs";

// ---------------------------------------------------------------------------
// readScaling
// ---------------------------------------------------------------------------

describe("readScaling", () => {
  /** A minimal GDAL_METADATA blob — only the two `role=` items this function reads. */
  const metadataOf = (scaleItem: string, offsetItem = "-273.15") =>
    `<GDALMetadata><Item name="SCALE" sample="0" role="scale">${scaleItem}</Item>` +
    `<Item name="OFFSET" sample="0" role="offset">${offsetItem}</Item></GDALMetadata>`;

  /** Stands in for geotiff's FileDirectory: `hasTag` plus an async `loadValue`. */
  function fakeDirectory(metadata: string, nodata: string) {
    return {
      hasTag: () => true,
      loadValue: async (name: string) => (name === "GDAL_METADATA" ? metadata : nodata),
    };
  }

  test("reads a real scale/offset/nodata triple off the tags", async () => {
    const directory = fakeDirectory(metadataOf("0.1"), "-2147483647");
    await expect(readScaling(directory, "CHELSA_tasmin_01_1981-2010_V.2.1.tif")).resolves.toEqual({
      scale: 0.1,
      offset: -273.15,
      nodata: -2147483647,
    });
  });

  test("rejects a whitespace-bodied scale item instead of silently reading it as 0", async () => {
    // item() is `Number(match[1])`, and `Number(' ')` is 0 — finite, and a
    // scale no real file declares. Without the explicit zero check every
    // value in the file would decode to the constant offset (raw * 0 +
    // offset), a plausible number that would pass every gate below it.
    const directory = fakeDirectory(metadataOf(" "), "-2147483647");
    await expect(readScaling(directory, "CHELSA_tasmin_01_1981-2010_V.2.1.tif")).rejects.toThrow(
      /GDAL_METADATA declares no usable scale\/offset/
    );
  });

  test("refuses a file that declares no such tag, naming which one and which file", async () => {
    // Every branch of readScaling throws rather than defaulting, and this was
    // the one branch no fixture could reach: fakeDirectory's hasTag is
    // hardcoded true. All five CHELSA files declare both tags today; a
    // release that stopped declaring one is a change a human should see, not
    // one this build should guess past — and the message has to say which
    // file and which tag, because the run is 60 files deep behind a detached
    // process by the time anyone reads it.
    const without = (missing: string) => ({
      hasTag: (tag: string) => tag !== missing,
      loadValue: async () => "unreachable",
    });
    await expect(
      readScaling(without("GDAL_NODATA"), "CHELSA_pr_01_1981-2010_V.2.1.tif")
    ).rejects.toThrow(/^CHELSA_pr_01_1981-2010_V\.2\.1\.tif: no GDAL_NODATA tag/);
    await expect(
      readScaling(without("GDAL_METADATA"), "CHELSA_clt_07_1981-2010_V.2.1.tif")
    ).rejects.toThrow(/^CHELSA_clt_07_1981-2010_V\.2\.1\.tif: no GDAL_METADATA tag/);
  });

  test("reads a tag geotiff hands back as NUL-terminated bytes exactly as it reads a string", async () => {
    // GDAL_METADATA and GDAL_NODATA are DEFERRED fields, and loadValue gives
    // back whatever the file holds — an ASCII blob as a typed array, not
    // always a JS string. tagText's latin1 decode and trailing-NUL trim are
    // what make the two forms one value, and nothing exercised them: every
    // fixture above answers with a string. A NUL left on the end of the
    // sentinel alone would send `Number("-2147483647\0")` to NaN and abort
    // the run on a file that is perfectly well-formed.
    const bytes = (s: string) => new TextEncoder().encode(`${s}\0`);
    const asBytes = {
      hasTag: () => true,
      loadValue: async (name: string) =>
        name === "GDAL_METADATA" ? bytes(metadataOf("0.1")) : bytes("-2147483647"),
    };
    const file = "CHELSA_tasmin_01_1981-2010_V.2.1.tif";
    await expect(readScaling(asBytes, file)).resolves.toEqual(
      await readScaling(fakeDirectory(metadataOf("0.1"), "-2147483647"), file)
    );
  });
});

// ---------------------------------------------------------------------------
// ensureRaster
// ---------------------------------------------------------------------------

import { afterEach, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/**
 * All three real builds (Task 6's report) found every one of the 60 rasters
 * already cached, so `ensureRaster`'s HEAD / stream-to-temp /
 * verify-byte-count / rename / retry path has never once executed — the
 * first cold run is an unattended CI job. `fetch` is stubbed globally, the
 * way this repo's other fetchers are tested, and `cacheDir` is pointed at a
 * scratch directory via the options `ensureRaster` now takes — the module's
 * real `CACHE_DIR` is never touched by any test here.
 */
describe("ensureRaster", () => {
  const scratchDirs: string[] = [];

  afterEach(() => {
    while (scratchDirs.length > 0) {
      const dir = scratchDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
    vi.unstubAllGlobals();
  });

  function scratchCacheDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "ingest-climate-ensureRaster-"));
    scratchDirs.push(dir);
    return dir;
  }

  /** A HEAD response carrying only the one header ensureRaster reads. */
  const headResponse = (bytes: number) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: (name: string) => (name === "content-length" ? String(bytes) : null) },
  });

  /** A GET response whose body stream is exactly `bytes` long. */
  const okResponse = (bytes: number) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes).fill(7));
        controller.close();
      },
    }),
  });

  const failureResponse = (status: number, statusText: string) => ({
    ok: false,
    status,
    statusText,
    headers: { get: () => null },
  });

  test("a cached file whose size equals the HEAD Content-Length is not re-downloaded, and no GET is issued", async () => {
    const cacheDir = scratchCacheDir();
    const BYTES = 37;
    // Content doesn't matter — the cache check is a byte-count comparison,
    // never a hash or a read of the file itself.
    const cachedPath = join(cacheDir, "CHELSA_clt_01_1981-2010_V.2.1.tif");
    writeFileSync(cachedPath, Buffer.alloc(BYTES, 1));

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return headResponse(BYTES);
      throw new Error("GET must not be issued when the cache already matches");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureRaster("clt", "01", { cacheDir });
    expect(result).toEqual({ path: cachedPath, bytes: BYTES, downloadedBytes: 0, downloadMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("an absent file is streamed to a PID-suffixed temp and renamed into place with the exact byte count", async () => {
    const cacheDir = scratchCacheDir();
    const BYTES = 41;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "HEAD" ? headResponse(BYTES) : okResponse(BYTES)
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureRaster("clt", "01", { cacheDir });
    expect(result.bytes).toBe(BYTES);
    expect(result.downloadedBytes).toBe(BYTES);
    expect(statSync(result.path).size).toBe(BYTES);
    // Only the final file survives — no `.tmp-<pid>` left behind, which is
    // exactly what a crash mid-stream would otherwise leave at this path.
    expect(readdirSync(cacheDir)).toEqual([basename(result.path)]);
  });

  test("a body shorter than Content-Length throws and leaves no file at the final path", async () => {
    const cacheDir = scratchCacheDir();
    const DECLARED = 50;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "HEAD" ? headResponse(DECLARED) : okResponse(10)
    );
    vi.stubGlobal("fetch", fetchMock);

    // `retryDelaysMs: [0, 0]` — same two retries the real module makes, at
    // no real wall-clock cost, rather than fake timers: this test writes to
    // real disk on every attempt, and interleaving that with a fake clock is
    // its own hazard (a fake timer scheduled only after real I/O settles can
    // outlive `runAllTimersAsync`'s own drain and hang the test forever).
    await expect(
      ensureRaster("clt", "01", { cacheDir, retryDelaysMs: [0, 0] })
    ).rejects.toThrow(/wrote 10 B, expected 50 B/);
    // The retries all wrote the same short body to the SAME temp name, and
    // the outer `finally` removes it on the way out — nothing survives.
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  test("a non-2xx HEAD throws", async () => {
    const cacheDir = scratchCacheDir();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => failureResponse(500, "Internal Server Error"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureRaster("clt", "01", { cacheDir, retryDelaysMs: [0, 0] })
    ).rejects.toThrow(/HTTP 500/);
    // A HEAD that never succeeds must never reach the GET branch.
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.method === "HEAD")).toBe(
      true
    );
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  test("a transient failure followed by success is retried and succeeds", async () => {
    const cacheDir = scratchCacheDir();
    const BYTES = 44;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(headResponse(BYTES))
      .mockResolvedValueOnce(failureResponse(503, "Service Unavailable"))
      .mockResolvedValueOnce(okResponse(BYTES));
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureRaster("clt", "01", { cacheDir, retryDelaysMs: [0] });
    expect(result.downloadedBytes).toBe(BYTES);
    expect(statSync(result.path).size).toBe(BYTES);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
