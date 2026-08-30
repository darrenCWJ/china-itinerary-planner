import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, test } from "vitest";
import type { Airport, AirportSize } from "./airports";
import { MAIN_AIRPORT_LABEL, mainAirportFor } from "./mainAirport";
import { airportsForCountry } from "./server/airports";

/**
 * Distances are built along a meridian, where the great-circle distance is
 * exactly `R · dLat` — so "42 km away" is 42 km and not 42-ish, and the
 * boundary tests below pin a real boundary rather than a rounding artefact.
 */
const KM_PER_DEGREE = (6371 * Math.PI) / 180;
const HERE = { lat: 0, lon: 0 };

/** An airport `km` due north (or south, for a negative `km`) of `HERE`. */
function airportAt(iata: string, km: number, size: AirportSize): Airport {
  return {
    iata,
    icao: null,
    name: `${iata} Airport`,
    municipality: null,
    country: "ZZ",
    lat: km / KM_PER_DEGREE,
    lon: 0,
    size,
  };
}

describe("mainAirportFor", () => {
  test("returns the RANKED first, which can be 15 km further than the true nearest", () => {
    // rank = km - SIZE_BONUS_KM[size], large +15 / medium 0. Over the set this
    // function ranks — `ARRIVABLE_AIRPORT_SIZES`, large and medium — that is
    // the whole spread, and it is exactly the bound §10.2 quotes.
    // Verified: large@27km ranks 12 and beats medium@13km at 13; large@29km
    // ranks 14 and loses. THIS is why the label cannot say "nearest".
    const medium = airportAt("MED", -13, "medium");

    const wins = mainAirportFor([medium, airportAt("BIG", 27, "large")], HERE);
    expect(wins).toEqual({ iata: "BIG", km: 27 });

    // Two km further and the same large airport loses to the same medium one —
    // which is what makes the assertion above a boundary and not a coincidence.
    const loses = mainAirportFor([medium, airportAt("BIG", 29, "large")], HERE);
    expect(loses).toEqual({ iata: "MED", km: 13 });
  });

  test("never names a size the map will not draw", () => {
    // The fix for the two filters that disagreed. `CountryLevel`'s layer draws
    // `ARRIVABLE_AIRPORT_SIZES` (§10.1) and this ranked over all three sizes,
    // so the card could print a code for a diamond that was never on screen.
    //
    // A contest the small airport wins on distance and on rank — 3 km scores
    // 3 + 15 = 18 against the medium's 20 — and loses because an airstrip is
    // not where anyone arrives. That is the same judgement §10.1 makes about
    // drawing it, made once, in one place.
    const small = airportAt("SML", 3, "small");
    const medium = airportAt("MED", 20, "medium");
    expect(mainAirportFor([small, medium], HERE)).toEqual({ iata: "MED", km: 20 });

    // Filtered BEFORE the ranking rather than after. An implementation that
    // took `[0]` and then rejected it would answer null for the pair above and
    // withhold a perfectly usable airport; here null means there is genuinely
    // nothing to name.
    expect(mainAirportFor([small], HERE)).toBeNull();
  });

  test("the label says Main airport, and says nothing about proximity", () => {
    expect(MAIN_AIRPORT_LABEL).toBe("Main airport");
    expect(MAIN_AIRPORT_LABEL).not.toMatch(/near|close|closest/i);
  });

  test("returns null when the country has no airports at all", () => {
    expect(mainAirportFor([], HERE)).toBeNull();
  });

  test("returns null when the only airport is beyond the serving radius", () => {
    // DEFAULT_AIRPORT_RADIUS_KM is 150 and its docblock is explicit that
    // beyond it, naming an airport is worse than naming none. A caller told
    // there is none can say so; a caller handed a 600 km airport cannot.
    expect(mainAirportFor([airportAt("FAR", 151, "large")], HERE)).toBeNull();
  });

  test("rounds the distance the way the card renders it", () => {
    // The card shows "TNA · 30 km". Pin the rounding here rather than in JSX,
    // so there is one place that decides it and the JSX just prints a number.
    expect(mainAirportFor([airportAt("DWN", 12.4, "medium")], HERE)?.km).toBe(12);
    expect(mainAirportFor([airportAt("UPP", 12.6, "medium")], HERE)?.km).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// The bundle constraint
// ---------------------------------------------------------------------------

/** Every non-test source module under lib/, as the bundler would see them. */
function libSources(): { path: string; code: string }[] {
  const out: { path: string; code: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(process.cwd(), dir))) {
      const path = `${dir}/${entry}`;
      if (statSync(join(process.cwd(), path)).isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push({ path, code: readFileSync(join(process.cwd(), path), "utf8") });
      }
    }
  };
  walk("lib");
  return out;
}

/**
 * A VALUE import of a specifier matching `path`.
 *
 * `import type` is erased at compile time and costs no bytes, which is why
 * lib/server/airports.ts may be named in a comment or a type position without
 * anyone paying for the artifact. Copied in shape from lib/countryFacts.test.ts,
 * which guards the 70 KB country-facts artifact the same way.
 */
const valueImportOf = (code: string, path: RegExp): boolean =>
  new RegExp(`import\\s+(?!type\\b)[^;]*from\\s+["'][^"']*${path.source}["']`).test(code);

/** Resolve one relative or `@/`-aliased specifier to a scanned file, or null. */
function resolveSpecifier(from: string, spec: string, known: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/** Every module a bundler would pull in to serve `start`, including `start`. */
function valueImportClosure(files: { path: string; code: string }[], start: string): string[] {
  const known = new Set(files.map((file) => file.path));
  const byPath = new Map(files.map((file) => [file.path, file.code]));
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    for (const match of (byPath.get(next) ?? "").matchAll(
      /import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/g
    )) {
      const resolved = resolveSpecifier(next, match[1], known);
      if (resolved !== null && !seen.has(resolved)) {
        seen.add(resolved);
        stack.push(resolved);
      }
    }
  }
  return [...seen];
}

describe("lib/mainAirport.ts", () => {
  const FILES = libSources();

  test("does not import the artifact", () => {
    // lib/server/airports.ts has NO server-only guard: a client import compiles
    // clean and ships data/airports.json — 876,823 B — to every visitor. This
    // module takes the array as a parameter instead, exactly as lib/airports.ts
    // does, and that is the whole reason it is client-safe.
    //
    // Transitive, not a grep of one file: nothing imports the JSON but
    // lib/server/airports.ts, and every module that reaches THAT one inherits
    // the bytes. Which modules a bundle pays for is a graph question.
    const closure = valueImportClosure(FILES, "lib/mainAirport.ts");
    expect(closure).toContain("lib/airports.ts");
    expect(closure).not.toContain("lib/server/airports.ts");
    const artifactImporters = closure.filter((path) =>
      valueImportOf(FILES.find((file) => file.path === path)!.code, /airports\.json/)
    );
    expect(artifactImporters).toEqual([]);
  });

  test("the scan and the detector both work, or the check above is vacuous", () => {
    // Armed, because a walk that found nothing and a regex that matches
    // nothing both produce a green "does not import the artifact". The one
    // module that DOES import the artifact must be caught by both.
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.map((file) => file.path)).toContain("lib/mainAirport.ts");

    const server = FILES.find((file) => file.path === "lib/server/airports.ts")!;
    expect(valueImportOf(server.code, /airports\.json/)).toBe(true);
    expect(valueImportClosure(FILES, "lib/server/airports.ts")).toContain("lib/server/airports.ts");
  });
});

// ---------------------------------------------------------------------------
// The border limit
// ---------------------------------------------------------------------------

/**
 * Basel, because Switzerland's own answer for it is 68 km worse than the true
 * one and the true one is French.
 *
 * Coordinates as the app ships them in public/cities/CH.json, and the airports
 * come through `airportsForCountry` — the exact function
 * /api/map/airports?country=XX calls — so what is measured here is the array
 * the card really receives rather than an invented one.
 */
const BASEL = { lat: 47.55839, lon: 7.57327 };

describe("the border limit", () => {
  test("names an airport from the loaded country only, and says so", () => {
    // Not a bug to fix in this PR — fixing it means a second fetch or an
    // unfiltered artifact, both out of scope. It is a limit to RECORD, so the
    // next reader does not treat the answer as globally ranked.
    //
    // `mainAirportFor` applies NO country predicate. The scope is entirely the
    // caller's array, and in the app that array is one country's rows, so for
    // a place near a border the true main airport is not out-ranked — it is
    // absent. Basel's card names Zürich, 74 km away.
    expect(mainAirportFor(airportsForCountry("CH"), BASEL)).toEqual({ iata: "ZRH", km: 74 });

    // Hand the same place its neighbour's rows and the same call is right:
    // EuroAirport is 6 km from the city and in France. That is what makes this
    // the caller's limit and not the resolver's — and why the record lives on
    // the resolver's docblock rather than in the card's copy, which would
    // become a lie, in JSX, on the day the array widens.
    const withNeighbour = [...airportsForCountry("CH"), ...airportsForCountry("FR")];
    expect(mainAirportFor(withNeighbour, BASEL)).toEqual({ iata: "BSL", km: 6 });

    // ...and it is written down. This one test asserts on prose deliberately,
    // against lib/contracts.test.ts's rule that prose must never decide a
    // verdict — because here the prose IS the deliverable. A limit recorded
    // only in a commit message is a limit nobody finds, and an unpinned
    // docblock is one tidy-up away from gone. The worked example is pinned
    // too, so the record cannot decay into a vague hedge.
    const source = readFileSync(join(process.cwd(), "lib/mainAirport.ts"), "utf8");
    expect(source).toMatch(/border/i);
    expect(source).toMatch(/\bBSL\b/);
    expect(source).toMatch(/\bZRH\b/);
  });

  test("the fixture is armed: the artifact really does put Basel's airport in France", () => {
    // Without this, both assertions above could be green because
    // `airportsForCountry` returned nothing at all. If only this test fails,
    // the artifact moved — the daily workflow refreshes it — and the limit
    // itself is unchanged.
    const ch = airportsForCountry("CH");
    expect(ch.length).toBeGreaterThan(0);
    expect(ch.map((airport) => airport.iata)).not.toContain("BSL");
    expect(airportsForCountry("FR").find((airport) => airport.iata === "BSL")).toMatchObject({
      country: "FR",
      size: "large",
    });
  });
});
