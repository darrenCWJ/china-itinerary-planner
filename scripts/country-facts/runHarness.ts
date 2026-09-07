/**
 * ingest-country-facts — the whole-feed apparatus the behavioural tests drive.
 *
 * Not a `*.test.ts`: vitest.config.mts includes `scripts/**\/*.test.ts`, so
 * this file is imported by the suites and never collected as one of them. It
 * declares no `describe`, no `test` and no lifecycle hook, so importing it
 * registers nothing — `vi.mock("node:fs")`, `beforeEach`/`afterEach`/
 * `beforeAll` and every helper that touches the mocked write primitives stay in
 * scripts/ingest-country-facts.test.ts, where hoisting and hook registration
 * are per-file and have to be.
 *
 * Every declaration below is a VERBATIM move, on 2026-09-07, out of
 * scripts/ingest-country-facts.test.ts — `git show
 * HEAD:scripts/ingest-country-facts.test.ts` lines 2150–2346 (`Feed` through
 * `healthyFeed`) and 2421–2426 (`dropRows`), in that order. The bodies are
 * unchanged; only `export ` was added to the seven declarations read from
 * outside. It was moved because `the four withhold rules are observably live
 * on a whole feed` belongs in scripts/country-facts/gate.test.ts (spec
 * 2026-09-07-unscheduled-items §2.1) and is built entirely from this
 * apparatus: leaving the apparatus in the entry test would have meant a
 * 197-line byte-identical second copy in gate.test.ts, which is the exact
 * duplication scripts/country-facts/fixtures.ts exists to end.
 *
 * The fixtures it is built from — `PLUG_ITEM`, `CURATED_UPSTREAM`,
 * `FILLER_POOL`, `entity` and `Row` — come from ./fixtures, and the upstream
 * shapes they carry are the ones Investigation 3 MEASURED on 2026-08-27.
 */

import { CURATED_UPSTREAM, FILLER_POOL, PLUG_ITEM, type Row, entity } from "./fixtures";
import { EXPECTED_COUNTRIES, REQUIRED_NAMES } from "./gate.mjs";

export type Feed = Record<string, Row[] | "throw">;

const NAMED_CODES = ["AZ", "BA", "BE", "BZ", "CH", "CN", "CZ", "FR", "JP", "MO", "NL", "PE", "PL", "SH", "ZW"];
export const FILLERS = FILLER_POOL.slice(0, EXPECTED_COUNTRIES - NAMED_CODES.length);

export interface CountrySpec {
  name?: string;
  currency?: [string, string][];
  plugs?: string[];
  voltage?: string[];
  drivingSide?: string;
  emergency?: [string, string][];
  languages?: string[];
  callingCode?: string;
  lat?: string;
}

/**
 * A stable fake Q-id per language label, so a fixture rebuilt in the same run
 * produces the same rows. `pickLanguages` acts on the id, so the feed has to
 * carry one — and the one id that MATTERS, Q1339026, is pushed by hand in the
 * test that needs it rather than being reachable from here by accident.
 */
const LANGUAGE_ITEM: Record<string, string> = {};
let nextLanguageItem = 900_000;
export const languageItem = (label: string): string =>
  (LANGUAGE_ITEM[label] ??= `http://www.wikidata.org/entity/Q${nextLanguageItem++}`);

export function addCountry(feed: Feed, code: string, spec: CountrySpec): void {
  (feed.codes as Row[]).push({ code });
  (feed.name as Row[]).push({ country: code, value: spec.name ?? `Country ${code}` });
  for (const [currencyCode, name] of spec.currency ?? []) {
    (feed.currency as Row[]).push({ country: code, code: currencyCode, name });
  }
  for (const label of spec.plugs ?? []) {
    (feed.plugs as Row[]).push({
      country: code,
      item: `http://www.wikidata.org/entity/${PLUG_ITEM[label] ?? "Q999999"}`,
      itemLabel: label,
    });
  }
  for (const value of spec.voltage ?? []) (feed.voltage as Row[]).push({ country: code, value });
  if (spec.drivingSide) (feed.drivingSide as Row[]).push({ country: code, value: spec.drivingSide });
  for (const [number, role] of spec.emergency ?? []) {
    (feed.emergency as Row[]).push({ country: code, number, role });
  }
  for (const value of spec.languages ?? []) {
    (feed.languages as Row[]).push({ country: code, item: languageItem(value), value });
  }
  if (spec.callingCode) (feed.callingCode as Row[]).push({ country: code, value: spec.callingCode });
  if (spec.lat) (feed.coordinate as Row[]).push({ country: code, lat: spec.lat });
}

export const FILLER_SPEC: CountrySpec = {
  currency: [["XCD", "East Caribbean dollar"]],
  plugs: ["Europlug"],
  voltage: ["230"],
  drivingSide: "right-hand traffic",
  emergency: [["112", "emergency service"]],
  languages: ["English"],
  callingCode: "+1",
  lat: "10.0",
};

/**
 * 246 countries the way Wikidata really answers, including the six measured
 * landmines. Every fixture that follows is a mutation of this one, so each
 * test states exactly one hazard.
 */
export function healthyFeed(): Feed {
  const feed: Feed = {
    codes: [],
    name: [],
    currency: [],
    plugs: [],
    voltage: [],
    drivingSide: [],
    emergency: [],
    languages: [],
    callingCode: [],
    coordinate: [],
  };
  addCountry(feed, "CN", {
    name: REQUIRED_NAMES.CN,
    currency: [["CNY", "renminbi"]],
    plugs: ["Europlug", "NEMA 1-15", "AS/NZS 3112"],
    voltage: ["220"],
    drivingSide: "right-hand traffic",
    emergency: [
      ["110", "police"],
      ["119", "fire department"],
      ["120", "emergency medical services"],
    ],
    languages: ["Standard Chinese"],
    callingCode: "+86",
    lat: "35.0",
  });
  addCountry(feed, "PE", {
    name: REQUIRED_NAMES.PE,
    currency: [["PEN", "Peruvian sol"]],
    plugs: ["NEMA 1-15", "NEMA 5-15", "Europlug"],
    voltage: ["220"],
    drivingSide: "right-hand traffic",
    emergency: [
      ["105", "police"],
      ["116", "fire department"],
      ["106", "emergency medical services"],
    ],
    languages: ["Spanish", "Quechua", "Aymara"],
    callingCode: "+51",
    lat: "-9.19",
  });
  addCountry(feed, "JP", {
    currency: [["JPY", "Japanese yen"]],
    plugs: ["NEMA 1-15", "NEMA 5-15"],
    voltage: ["100"],
    drivingSide: "left-hand traffic",
    emergency: [
      ["110", "police"],
      ["119", "fire department"],
    ],
    languages: ["Japanese"],
    callingCode: "+81",
    lat: "36.0",
  });
  addCountry(feed, "CH", {
    currency: [["CHF", "Swiss franc"]],
    plugs: ["SN 441011", "Europlug"],
    voltage: ["230"],
    drivingSide: "right-hand traffic",
    emergency: [
      ["117", "police"],
      ["118", "fire department"],
      ["144", "emergency medical services"],
    ],
    languages: ["German", "French", "Italian", "Romansh"],
    callingCode: "+41",
    lat: "47.0",
  });
  // The design's own sparse fixture: present, with fields absent.
  addCountry(feed, "SH", {
    name: "Saint Helena, Ascension and Tristan da Cunha",
    currency: [["SHP", "Saint Helena pound"]],
    drivingSide: "left-hand traffic",
    lat: "-15.9",
  });
  for (const [code, spec] of Object.entries(CURATED_UPSTREAM)) {
    addCountry(feed, code, {
      ...FILLER_SPEC,
      currency: spec.currency ?? FILLER_SPEC.currency,
      voltage: spec.voltage ?? FILLER_SPEC.voltage,
      callingCode: `+${31 + Object.keys(CURATED_UPSTREAM).indexOf(code)}`,
    });
    // BE and AZ carry a language shape rather than a currency one, so the
    // filler's unscoped "English" has to go: leave it and their curated rows
    // read as STALE and `assertFactsSane` refuses the whole run, which is the
    // gate working — the fixture has to reproduce the withhold, not assert it.
    if (spec.languages) {
      dropRows(feed, "languages", [code]);
      for (const [item, value, scoped] of spec.languages) {
        (feed.languages as Row[]).push({ country: code, item: entity(item), value, scoped });
      }
    }
    // NL's two-item split, by the same rule and for the same reason: the
    // filler gives one clean answer per field, which would resolve and leave
    // the curated rows STALE. Replacing them with the measured pair is what
    // reproduces the withhold these rows exist to rescue.
    if (spec.name) {
      dropRows(feed, "name", [code]);
      for (const value of spec.name) (feed.name as Row[]).push({ country: code, value });
    }
    if (spec.emergency) {
      dropRows(feed, "emergency", [code]);
      for (const [number, role] of spec.emergency) {
        (feed.emergency as Row[]).push({ country: code, number, role });
      }
    }
    if (spec.coordinate) {
      dropRows(feed, "coordinate", [code]);
      for (const lat of spec.coordinate) (feed.coordinate as Row[]).push({ country: code, lat });
    }
  }
  // Measured: BZ's P2884 is 550/220, so its voltage is withheld and — unlike
  // FR's — no curated row replaces it. A country with an honest gap.
  addCountry(feed, "BZ", { ...FILLER_SPEC, currency: [["BZD", "Belize dollar"]], voltage: ["550", "220"] });
  // Measured: CZ's P498 leaks the ISO numeric code beside the alphabetic one.
  addCountry(feed, "CZ", {
    ...FILLER_SPEC,
    currency: [
      ["CZK", "Czech koruna"],
      ["203", "Czech koruna"],
    ],
    callingCode: "+420",
  });
  for (const code of FILLERS) addCountry(feed, code, FILLER_SPEC);
  return feed;
}

/** Drop every row a property carries for these countries. */
export function dropRows(feed: Feed, property: string, codes: string[]): Feed {
  const gone = new Set(codes);
  feed[property] = (feed[property] as Row[]).filter((row) => !gone.has(row.country));
  return feed;
}
