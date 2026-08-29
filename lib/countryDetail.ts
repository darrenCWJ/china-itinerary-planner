import provinceIndexJson from "../public/provinces/index.json";
import { isCountryCode } from "./countries";
import type { ProvinceIdKey } from "./provinceTopology";

/**
 * Which countries have a drawable detail level, and what shape theirs is.
 *
 * This is the §5.1 registry, and the answer it gives is the point of PR4:
 * before it, `hasDetailLevel` was a string comparison against `"CN"` and 245
 * countries fell through to a list with no geometry beside it. `COUNTRY_DETAIL`
 * resolves the same question from `public/provinces/index.json` — the manifest
 * `scripts/build-provinces.mjs` writes next to the 246 files it builds — so a
 * country has a detail level exactly when a file exists to draw it from, and
 * adding one is a data change rather than a code change.
 *
 * **Bundled by a static import, not fetched.** `lib/provinceTopology.ts` fetches
 * the per-country files because they are large and only one is ever wanted; the
 * index is neither. It is 14,247 B raw and 1,380 B gzipped for all 246
 * countries, and the answer is needed SYNCHRONOUSLY: what `MapExplorer` and
 * `RouteMap` will ask it is which file to fetch, and a question asked in order
 * to start a fetch cannot itself await one without adding a render pass where a
 * country that has a map does not show one. Same technique as
 * lib/countryFacts.ts and lib/countryImagery.ts, for the same reason:
 * serverless has no `data/` or `public/` directory to read from, so a bundled
 * artifact is the only shape that works in both places.
 *
 * No component reads this yet — Task 5 rewires `MapExplorer`'s fetch and Task 6
 * lands the level that draws the result, the same way `lib/provinceTopology.ts`
 * shipped ahead of its first caller.
 *
 * The file stays under `public/` and keeps being served, because
 * `PROVINCE_INDEX_PATH` remains the URL a future surface would fetch it from.
 * Being both bundled and served costs 1,380 B and buys one source of truth.
 */

/**
 * What a country's detail level is made of.
 *
 * `unplaced` is deliberately not carried through: it is a build-quality figure
 * about city joins, and nothing that renders reads it. A registry that exposed
 * it would invite a surface to render it.
 */
export interface CountryDetail {
  /** SELECTABLE units, not geometries. CN ships 35 and offers 31. */
  count: number;
  /** What this country's unit ids come from, which readers never assume. */
  idKey: ProvinceIdKey;
}

const ID_KEYS: ReadonlySet<string> = new Set<ProvinceIdKey>(["adm1_code", "adcode"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One entry, or null when it could not be relied on. */
function readEntry(value: unknown): [string, CountryDetail] | null {
  if (!isRecord(value)) return null;
  const { code, count, idKey } = value;
  if (typeof code !== "string" || !isCountryCode(code)) return null;
  // A non-integer count is a different field; a negative one is a bug upstream.
  // Zero is allowed and means a country whose outline draws with nothing
  // clickable inside it — worth a map, and the list is the spine regardless.
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return null;
  if (typeof idKey !== "string" || !ID_KEYS.has(idKey)) return null;
  return [code.toUpperCase(), { count, idKey: idKey as ProvinceIdKey }];
}

/**
 * Validates at the boundary and narrows.
 *
 * Throws on the root and drops individual entries, the split
 * `parseProjectionManifest` and `parseProvinceTopology` both make. A root with
 * no `countries` array is the wrong file entirely — a 404 page, or an index
 * that was never built — and every one of the 246 countries would silently
 * lose its detail level, which is worth a hard failure at import. One
 * unusable entry costs that country its map and it falls back to the list,
 * where throwing would cost all 246 theirs.
 *
 * A Map rather than the record a plain build would produce, because the keys
 * come from a data file: on an object `registry["constructor"]` resolves to a
 * function, so a lookup that should miss reads as a hit, and an entry coded
 * `"__proto__"` writes through the prototype instead of into the registry.
 */
export function parseProvinceIndex(raw: unknown): ReadonlyMap<string, CountryDetail> {
  const countries = isRecord(raw) ? raw.countries : undefined;
  if (!Array.isArray(countries)) {
    throw new Error(
      `provinces/index.json: countries is missing or is not an array — ` +
        `was scripts/build-provinces.mjs run?`
    );
  }
  const registry = new Map<string, CountryDetail>();
  for (const value of countries) {
    const entry = readEntry(value);
    if (entry !== null) registry.set(entry[0], entry[1]);
  }
  return registry;
}

/** The committed index, read once at module load. */
export const COUNTRY_DETAIL: ReadonlyMap<string, CountryDetail> =
  parseProvinceIndex(provinceIndexJson);

/**
 * A code as the registry keys it, or `""` for anything that is not one.
 *
 * The `typeof` guard is not decoration: this is reached from component props
 * typed `string`, and TypeScript does not police what a JSON payload or an
 * untyped caller puts there.
 */
function normalise(country: string): string {
  return typeof country === "string" ? country.trim().toUpperCase() : "";
}

/**
 * One country's detail level, or null when there is no file to draw it from.
 *
 * `count` is what Plan 4's D10 reads to suppress an L3 affordance for the 34
 * countries with a single unit, and `idKey` is what a city join must key on.
 */
export function detailFor(country: string): CountryDetail | null {
  return COUNTRY_DETAIL.get(normalise(country)) ?? null;
}

/**
 * Whether a country has a drawable detail map.
 *
 * Same name and same boolean signature it had in `components/map/CountryMap.tsx`,
 * but a different answer: "is this China" became "did the build write this
 * country a file", so it is true for all 246 rather than for one. The three
 * sites that used to call it there were asking the OTHER question — which
 * renderer a country gets — and now call `hasCuratedTopology`, which still
 * means China and only China.
 *
 * It lives in `lib/` rather than beside a component so `RouteMap`,
 * `MapExplorer` and the country level can all ask without importing a renderer
 * to do it.
 */
export function hasDetailLevel(country: string): boolean {
  return COUNTRY_DETAIL.has(normalise(country));
}
