import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, test } from "vitest";
import { getCountryProfile } from "../countryProfile";
import type { TripInput } from "../itinerary";
import { buildPackingList } from "../packing";
import { CN_PACKING } from "./cn";

/**
 * Two derived contracts over the leaf directory this refactor created.
 *
 * 1. The leaves import nothing, so the cycle they were carved out of cannot
 *    regrow. `lib/countryProfile.ts` value-imported `./itinerary` and
 *    `./route` to reach country data; routing the generators back through the
 *    profile would have closed that. The data moved down instead.
 * 2. The China packing document is one object. It used to be two byte-identical
 *    copies — `CHINA_PACKING` in countryProfile.ts and the literal inside
 *    `buildPackingList` — with nothing pinning them equal.
 *
 * Every scan below carries a positive half. A scan that silently matches
 * nothing looks exactly like a clean one, and this repo has paid for that.
 */

const DIR = join(process.cwd(), "lib", "countryData");

const LEAVES = readdirSync(DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .sort();

/**
 * Block comments, and line comments that own their whole line. Deliberately
 * not trailing `//`: a leaf's data strings could contain one, and a stripper
 * that guesses wrong about quoting would decide a contract by eating data.
 * Nothing below anchors on a trailing comment.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
}

/**
 * Lines that pull another module in: import, re-export, or require.
 *
 * The re-export test wants the whole `export { … } from "…"` shape, not just
 * the words `export` and `from` on one line — the first version of this
 * predicate flagged `export const TIPS = ["important, from the start"]`, and
 * the arming test below is what found it. Country data is prose; a bare
 * `from` will appear in it.
 */
function importLines(source: string): string[] {
  return stripComments(source)
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        /^import\b/.test(line) ||
        (/^export\s+(type\s+)?[{*]/.test(line) && /\bfrom\s*["']/.test(line)) ||
        /\brequire\s*\(/.test(line)
    );
}

/** Quoted specifiers naming one of the four modules that would close the cycle. */
function cycleSpecifiers(source: string): string[] {
  const pattern = /["'][^"'\n]*\/(itinerary|route|packing|countryProfile)["']/g;
  return [...stripComments(source).matchAll(pattern)].map((m) => m[0]);
}

describe("countryData leaves import nothing", () => {
  test("the directory scan finds every leaf", () => {
    // The count is asserted, not just the loop body: a bad path or a glob that
    // matched nothing would otherwise make every contract below vacuously true.
    expect(LEAVES).toEqual(["cn.ts", "neutral.ts", "transportDefaults.ts"]);
    expect(LEAVES.length).toBeGreaterThanOrEqual(3);
  });

  test("no leaf imports anything at all", () => {
    let scanned = 0;
    const offenders: string[] = [];
    for (const file of LEAVES) {
      scanned += 1;
      for (const line of importLines(readFileSync(join(DIR, file), "utf8"))) {
        offenders.push(`${file}: ${line}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(scanned).toBe(LEAVES.length);
    expect(scanned).toBeGreaterThanOrEqual(3);
  });

  test("no leaf names a module that would close the cycle", () => {
    let scanned = 0;
    const offenders: string[] = [];
    for (const file of LEAVES) {
      scanned += 1;
      for (const spec of cycleSpecifiers(readFileSync(join(DIR, file), "utf8"))) {
        offenders.push(`${file}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(scanned).toBe(LEAVES.length);
    expect(scanned).toBeGreaterThanOrEqual(3);
  });

  test("the import scan is armed", () => {
    expect(importLines('import { X } from "./x";')).toHaveLength(1);
    expect(importLines('import type { X } from "./x";')).toHaveLength(1);
    expect(importLines('export { X } from "./x";')).toHaveLength(1);
    expect(importLines('export type { X } from "./x";')).toHaveLength(1);
    expect(importLines('export * from "./x";')).toHaveLength(1);
    expect(importLines('const x = require("./x");')).toHaveLength(1);
    // Comments and data are not imports.
    expect(importLines('/* import { X } from "./x"; */')).toHaveLength(0);
    expect(importLines('// import { X } from "./x";')).toHaveLength(0);
    expect(importLines('export const TIPS = ["important, from the start"];')).toHaveLength(0);
    expect(importLines('export const TIP = "the ferry runs from the old port";')).toHaveLength(0);
    expect(importLines('  "Bring a printout — important at the border",')).toHaveLength(0);
  });

  test("the cycle-specifier scan is armed", () => {
    expect(cycleSpecifiers('import { GENERAL_TIPS } from "./itinerary";')).toHaveLength(1);
    expect(cycleSpecifiers('import { TRANSPORT } from "../route";')).toHaveLength(1);
    expect(cycleSpecifiers('import type { PackingGroup } from "@/lib/packing";')).toHaveLength(1);
    expect(cycleSpecifiers('import { getCountryProfile } from "./countryProfile";')).toHaveLength(1);
    // Prose that happens to contain one of the words is not a specifier.
    expect(cycleSpecifiers('export const TIP = "check the route before packing";')).toHaveLength(0);
  });
});

const SOURCE_ROOTS = ["lib", "components", "app", "scripts"] as const;

function collectSources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      out.push({
        path: relative(process.cwd(), full).split(sep).join("/"),
        text: readFileSync(full, "utf8"),
      });
    }
  };
  for (const root of SOURCE_ROOTS) walk(join(process.cwd(), root));
  return out;
}

const SOURCES = collectSources();

/** One line from each of the document's three groups. */
const DOCUMENT_SIGNATURES = [
  "Alipay + WeChat Pay set up and tested with your bank card",
  "Offline maps app (Amap 高德 has the best China coverage)",
  "Reusable water bottle — hotels have kettles; tap water isn't potable",
];

function cnInput(): TripInput {
  return {
    destinationIds: [],
    days: 3,
    season: "spring",
    adults: 2,
    kids: 0,
    interests: [],
    country: "CN",
  };
}

const SENTINEL = "__T20 reference probe — never rendered__";

describe("the China packing document is one object, not two copies", () => {
  test("the source scan walked the tree it is supposed to walk", () => {
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(SOURCES.map((f) => f.path)).toContain("lib/countryData/cn.ts");
  });

  test("each of the three groups exists in exactly one source file", () => {
    // The teeth. `toEqual` on the rendered document would pass against a
    // re-introduced duplicate; this cannot, and it covers all three groups —
    // the same three the byte-identity claim was verified across.
    for (const signature of DOCUMENT_SIGNATURES) {
      const holders = SOURCES.filter((f) => f.text.includes(signature)).map((f) => f.path);
      expect(holders).toEqual(["lib/countryData/cn.ts"]);
    }
    expect(DOCUMENT_SIGNATURES).toHaveLength(3);
  });

  test("both former copies now read this exact array, by reference", () => {
    // Reference identity, not deep equality. Both consumers copy on read —
    // the profile by its fresh-object contract, the builder because the caller
    // owns what it is handed — so neither hands back an object `toBe` could be
    // pointed at directly. Mutating the source and reading it through both is
    // the same claim, and a re-introduced duplicate cannot survive it.
    CN_PACKING[0].items.push(SENTINEL);
    try {
      expect(getCountryProfile("CN").packing[0].items.at(-1)).toBe(SENTINEL);
      expect(buildPackingList(cnInput(), [])[0].items.at(-1)).toBe(SENTINEL);
    } finally {
      CN_PACKING[0].items.pop();
    }
    // The probe left nothing behind, so nothing after this reads a mutated doc.
    expect(CN_PACKING[0].items).not.toContain(SENTINEL);
    expect(getCountryProfile("CN").packing[0].items).not.toContain(SENTINEL);
  });

  test("the probe is armed: without the mutation neither consumer reports it", () => {
    // Without this, a probe whose push silently failed would look identical to
    // a passing one.
    expect(getCountryProfile("CN").packing[0].items.at(-1)).not.toBe(SENTINEL);
    expect(buildPackingList(cnInput(), [])[0].items.at(-1)).not.toBe(SENTINEL);
  });

  test("the consumers still hand back copies, so the source cannot be corrupted", () => {
    const profilePacking = getCountryProfile("CN").packing;
    expect(profilePacking).not.toBe(CN_PACKING);
    expect(profilePacking[0]).not.toBe(CN_PACKING[0]);
    expect(profilePacking[0].items).not.toBe(CN_PACKING[0].items);
    expect(profilePacking).toEqual(CN_PACKING);
    expect(buildPackingList(cnInput(), [])[0].items).not.toBe(CN_PACKING[0].items);
  });
});
