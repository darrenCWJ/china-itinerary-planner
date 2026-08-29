import type { Topology } from "topojson-specification";
import { isCountryCode } from "./countries";

/**
 * The client's side of the province artifact.
 *
 * One file per country under `public/provinces/`, built by
 * `scripts/build-provinces.mjs` from Natural Earth 10m admin-1 and committed,
 * exactly as `public/world-countries.json` and `public/china-provinces.json`
 * are. This module is the only thing that knows the file's shape, so the
 * on-disk layout stays an implementation detail.
 *
 * A country's outline is not a separate asset: `merge()` over the very units
 * its picker lists yields it (spec §4.1), which is why there is one artifact
 * family here rather than two. Measured across all 246 files, that merge tiles
 * every country — only 10 produce an interior ring and every one of those is a
 * genuine enclave.
 *
 * Fetched per country like a city shard, not read server-side: `public/` is
 * not readable from a Vercel lambda, so an `fs` read of one of these works
 * locally and 500s in production. There is deliberately no fetcher here yet —
 * PR4 is the first caller, and it lands with the map that draws these.
 */

/** Root-relative so the fetch resolves the same from every route. */
export const PROVINCE_INDEX_PATH = "/provinces/index.json";

/** The single TopoJSON object in every file, China's re-envelope included. */
export const PROVINCE_OBJECT = "provinces";

function normaliseCountry(country: string, what: string): string {
  const code = typeof country === "string" ? country.trim().toUpperCase() : "";
  if (!isCountryCode(code)) {
    throw new Error(`${what}: "${country}" is not a country code — expected two letters`);
  }
  return code;
}

/**
 * Validated rather than interpolated, because this value reaches a URL: a
 * country of "../china-provinces" would resolve out of /provinces/ entirely
 * and hand the parser below a bare topology with no envelope at all.
 */
export function provincePath(country: string): string {
  return `/provinces/${normaliseCountry(country, "provincePath")}.json`;
}

/**
 * Which source property a file's unit ids come from.
 *
 * Two schemes, because China's file is a re-envelope of the curated topology
 * (§6.3, D7) whose join key is `adcode` (GB/T 2260) while every other country
 * keys on Natural Earth's `adm1_code`. Files declare it; readers never assume.
 */
export type ProvinceIdKey = "adm1_code" | "adcode";

const ID_KEYS: ReadonlySet<string> = new Set<ProvinceIdKey>(["adm1_code", "adcode"]);

/**
 * One admin-1 unit, projected out of its TopoJSON geometry.
 *
 * Not every unit is a choice. `selectable` is false for geometry that shapes a
 * country's outline without being one of its subdivisions — Northern Cyprus,
 * Akrotiri and Dhekelia inside CY, Somaliland inside SO, Guantánamo inside CU,
 * Taiwan, Hong Kong, Macau and the nine-dash line inside CN — because ISO
 * 3166-1 governs territorial EXTENT while ISO 3166-2 governs SUBDIVISION
 * identity (§7.2). Anything counting provinces must filter on it.
 */
export interface ProvinceUnit {
  /** Unique within the file, and what `cityProvince` joins on. */
  id: string;
  /** Endonym where the source has one. The curated CN asset is Chinese-only. */
  name: string | null;
  /** English name. Null for CN, which carries no second name field. */
  nameEn: string | null;
  /** ISO 3166-2 code. NOT unique — 60 are reused, PH-MNL 17 times. */
  iso3166_2: string | null;
  /** GeoNames admin-1 code, `"<CC>.<CODE>"`. Absent from the curated asset. */
  gnA1Code: string | null;
  /** §7.2's `sel`, as a boolean. The wire format stays 1 or 0. */
  selectable: boolean;
}

export interface ProvinceFile {
  country: string;
  generatedAt: string;
  idKey: ProvinceIdKey;
  /** Carried by reference: `merge()` over this is the country outline. */
  topology: Topology;
  /** File order, which is `id` ascending — the build sorts for byte stability. */
  units: ProvinceUnit[];
  /**
   * GeoNames city id → unit id, holding only ids the file actually ships.
   *
   * A Map, not a record, because the keys come from a data file: on a plain
   * object `cityProvince["constructor"]` resolves to a function, so a lookup
   * that should miss reads as a hit.
   */
  cityProvince: ReadonlyMap<string, string>;
}

export interface ProvinceIndexEntry {
  code: string;
  /** SELECTABLE units, not geometries. CN ships 35 and offers 31. */
  count: number;
  idKey: ProvinceIdKey;
  /** Cities in the country's shard that neither containment nor `a1c` placed. */
  unplaced: number;
}

export interface ProvinceIndex {
  generatedAt: string;
  countries: ProvinceIndexEntry[];
}

function fail(detail: string): never {
  throw new Error(`province file: ${detail}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Empty strings become null: a unit labelled "" renders as a blank choice. */
function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Validates at the boundary and narrows.
 *
 * Throws rather than degrading on anything structural, the policy
 * `parseCityShard`, `parseWorldTopology` and `parseGlobeTopology` all take: a
 * half-parsed file draws a country quietly missing provinces, and nothing
 * downstream can tell that from a country that genuinely has few.
 *
 * `cityProvince` is the single exception and degrades instead, for the reason
 * `parseCityEnrichment` gives for the same split: an entry naming a unit the
 * file does not ship costs one city its province, while throwing costs the
 * whole country its map. The build gates that case, so a drop here means a
 * committed file disagrees with itself.
 */
export function parseProvinceTopology(raw: unknown, expectedCountry?: string): ProvinceFile {
  const root = asRecord(raw);
  if (!root) fail("root is not an object");

  const country = typeof root.country === "string" ? root.country.trim().toUpperCase() : "";
  if (!isCountryCode(country)) {
    fail(`country is not a country code (${JSON.stringify(root.country)})`);
  }
  // A file is identified by its URL AND by its envelope, and the two must
  // agree. Nothing downstream reads this field — callers take the topology and
  // the units — so a cache entry, a CDN rewrite or a mis-copied fixture that
  // served one country's provinces under another country's path would be
  // completely invisible: Peru's departments would draw on Japan's map and
  // every test would stay green. `isCountryCode` is only `/^[A-Za-z]{2}$/`, so
  // it would happily accept "JP" on Peru's file.
  if (expectedCountry !== undefined) {
    const wanted = expectedCountry.trim().toUpperCase();
    if (country !== wanted) fail(`is ${country}'s file, but ${wanted} was requested`);
  }

  const idKey = typeof root.idKey === "string" ? root.idKey : "";
  if (!ID_KEYS.has(idKey)) {
    fail(
      `idKey is not an id scheme this app builds (${JSON.stringify(root.idKey)}) — ` +
        `expected "adm1_code" or "adcode"`
    );
  }

  const topology = asRecord(root.topology);
  if (!topology || topology.type !== "Topology" || !Array.isArray(topology.arcs)) {
    fail("topology is missing or is not a TopoJSON Topology (was scripts/build-provinces.mjs run?)");
  }
  const objects = asRecord(topology.objects);
  const collection = objects ? asRecord(objects[PROVINCE_OBJECT]) : null;
  const geometries = collection?.geometries;
  if (!Array.isArray(geometries)) {
    fail(`topology.objects.${PROVINCE_OBJECT}.geometries is missing or is not an array`);
  }

  const ids = new Set<string>();
  const units: ProvinceUnit[] = (geometries as unknown[]).map((entry, i): ProvinceUnit => {
    const geometry = asRecord(entry);
    if (!geometry) fail(`unit ${i} is not an object`);
    if (typeof geometry.id !== "string" || geometry.id === "") {
      fail(`unit ${i} has no id (${JSON.stringify(geometry.id)}) — ${idKey} is what cityProvince joins on`);
    }
    if (ids.has(geometry.id)) {
      // adm1_code is unique across all 4,596 source features and adcode across
      // the 35 curated ones. A duplicate means the id came from a field with
      // no such guarantee — iso_3166_2 carries 4,501 distinct values for 4,596
      // features — and every city in the pair joins to whichever polygon a
      // lookup reaches first.
      fail(`has a duplicate unit id (${geometry.id}) — a city could not be joined to one polygon`);
    }
    ids.add(geometry.id);
    const properties = asRecord(geometry.properties);
    if (!properties) fail(`unit ${i} (${geometry.id}) has no properties`);
    const sel = properties.sel;
    if (sel !== 0 && sel !== 1) {
      // Both defaults are wrong: assuming selectable makes Northern Cyprus a
      // clickable district of Cyprus, which is the outcome §7.2 exists to
      // prevent, and assuming the opposite makes a whole country unclickable.
      fail(`unit ${i} (${geometry.id}) has no selectable flag (sel is ${JSON.stringify(sel)}, expected 1 or 0)`);
    }
    return {
      id: geometry.id,
      name: text(properties.name),
      nameEn: text(properties.name_en),
      iso3166_2: text(properties.iso_3166_2),
      gnA1Code: text(properties.gn_a1_code),
      selectable: sel === 1,
    };
  });

  const cityProvince = new Map<string, string>();
  const assignments = asRecord(root.cityProvince);
  if (assignments) {
    for (const [cityId, unitId] of Object.entries(assignments)) {
      if (typeof unitId !== "string" || !ids.has(unitId)) continue;
      cityProvince.set(cityId, unitId);
    }
  }

  return {
    country,
    generatedAt: typeof root.generatedAt === "string" ? root.generatedAt : "",
    idKey: idKey as ProvinceIdKey,
    // By reference, not rebuilt: this is the object PR4 hands to `merge()` and
    // `feature()`, and re-quantised or re-keyed geometry is different geometry.
    topology: topology as unknown as Topology,
    units,
    cityProvince,
  };
}
