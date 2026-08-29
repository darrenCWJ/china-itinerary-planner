/**
 * Builds public/provinces/<CC>.json — one admin-1 topology per country, from
 * which `merge()` also yields that country's outline (spec §4.1).
 *
 * Run by hand and the output committed:
 *
 *     node scripts/build-provinces.mjs
 *
 * Modelled on build-globe-topology.mjs: every gate fires before any write, the
 * pure functions are exported for tests and the I/O is not, and an entry-point
 * guard keeps an import from refetching 40 MB and rewriting 246 files.
 */

import { topology } from 'topojson-server';
import { presimplify, simplify } from 'topojson-simplify';
import { quantize } from 'topojson-client';
import { geoContains } from 'd3-geo';

/**
 * Quantisation, per country over its own bbox. Not a guess: world-countries
 * .json's transform against its bbox measures Qx = Qy = 100000 exactly.
 */
const QUANTISATION = 1e5;

/**
 * The four stages, in the only order that works.
 *
 * `quantize` throws `already quantized` if `topology()` is handed a
 * quantisation argument, so quantisation is LAST and `topology()` is called
 * bare.
 *
 * `simplify` runs even at tolerance 0. `presimplify` annotates every
 * coordinate with a third element — its planar triangle area — and `simplify`
 * is what strips them. Skipping it at tol 0 measured 25,313,808 B raw across
 * the 246 files against 8,906,972 correct, and put 12 countries over the gzip
 * cap instead of none.
 */
export function buildCountryTopology(featureCollection, tolerance) {
  let t = topology({ provinces: featureCollection });
  t = presimplify(t);
  t = simplify(t, tolerance);
  return quantize(t, QUANTISATION);
}

/** A country code as this project uses it everywhere: two uppercase letters. */
const ALPHA2 = /^[A-Z]{2}$/;

/**
 * A3 -> alpha-2, from `admin_0_map_units`.
 *
 * Read `ISO_A2_EH`, not `ISO_A2`. 67 of the layer's 298 rows carry something
 * that is not a country code in `ISO_A2` — "-99" for the 13 disputed units,
 * and "FR-971"-style department numbers for the French overseas units. Keying
 * on `ISO_A2` resolves GLP to "FR-971" and quietly loses Guadeloupe,
 * Martinique, French Guiana, Réunion and Mayotte, which are five of the 13
 * countries this phase exists to reach. `ISO_A2_EH` is clean for all of them.
 *
 * Maps rather than object literals, because these keys come from a data file
 * and "constructor" on a plain object resolves to a function.
 */
export function buildAlpha2Index(mapUnits) {
  const byGuA3 = new Map();
  const byAdm0A3 = new Map();
  for (const feature of mapUnits.features) {
    const p = feature.properties;
    const code = ALPHA2.test(String(p.ISO_A2))
      ? p.ISO_A2
      : (ALPHA2.test(String(p.ISO_A2_EH)) ? p.ISO_A2_EH : null);
    if (code === null) continue;
    if (p.GU_A3) byGuA3.set(p.GU_A3, code);
    // First wins: FRA's own unit (FXX -> FR) is what ADM0_A3 "FRA" should mean,
    // not whichever overseas department happens to be iterated last.
    if (p.ADM0_A3 && !byAdm0A3.has(p.ADM0_A3)) byAdm0A3.set(p.ADM0_A3, code);
  }
  return { byGuA3, byAdm0A3 };
}

/**
 * The country an admin-1 feature belongs to, or null.
 *
 * Spec §7.1, most specific first. `iso_a2` is deliberately NOT first: that
 * order folds YT RE GP MQ GF into FR, TK into NZ, SJ into NO and BQ into NL,
 * and drops CC and CX entirely — precisely the set Phase 4 exists to reach.
 *
 * Seven real features return null, and all seven are rows of §7.2's override
 * table. Task 3 decides what happens to them; this function only reports that
 * no ISO rule reaches them.
 */
export function attributeFeature(properties, index) {
  // The three Caribbean-Netherlands units carry gu_a3 = NLD, so every general
  // rule sends them to NL. ISO 3166 gives them BQ.
  if (/^NL-BQ[0-9]$/.test(String(properties.iso_3166_2))) return 'BQ';
  const viaGu = index.byGuA3.get(properties.gu_a3);
  if (viaGu !== undefined) return viaGu;
  const prefix = /^([A-Z]{2})-/.exec(String(properties.iso_3166_2 ?? ''));
  if (prefix !== null) return prefix[1];
  if (ALPHA2.test(String(properties.iso_a2 ?? ''))) return properties.iso_a2;
  const viaAdm0 = index.byAdm0A3.get(properties.adm0_a3);
  if (viaAdm0 !== undefined) return viaAdm0;
  return null;
}

/**
 * Territories whose geometry shapes another country's outline but which are
 * not themselves selectable subdivisions (spec §7.2).
 *
 * ISO 3166-1 governs territorial EXTENT; ISO 3166-2 governs SUBDIVISION
 * identity. Cyprus's shape therefore includes the north while its clickable
 * subdivisions follow 3166-2, and that asymmetry is the intended reading of
 * "ISO 3166 as the single rule" rather than an inconsistency.
 *
 * Named overrides, not key precedence: nothing here should be decided by which
 * property happens to be read first.
 */
export const FOLD_INTO = Object.freeze({
  CYN: 'CY',  // Northern Cyprus — ISO 3166-1 treats the island as CY
  WSB: 'CY',  // Akrotiri — ISO 3166 gives it no code
  ESB: 'CY',  // Dhekelia — as above
  SOL: 'SO',  // Somaliland — ISO 3166-1 has no SO-split
  USG: 'CU',  // Guantánamo — within Cuba's ISO territory
  NJM: 'SJ',  // Jan Mayen — ISO 3166 SJ is "Svalbard and Jan Mayen" (D9)
});

/**
 * Geometry that lands in no file at all.
 *
 * ISO offers no guidance on either, and excluding them is the only option that
 * does not require this project to take an editorial position on a territorial
 * dispute. Recorded rather than silently dropped.
 */
export const EXCLUDED = new Set(['KAS', 'PGA']);

/** Which country's file a feature belongs in, and whether it can be clicked. */
export function resolveTerritory(properties, index) {
  const gu = properties.gu_a3;
  if (EXCLUDED.has(gu)) return { country: null, selectable: false };
  const folded = Object.prototype.hasOwnProperty.call(FOLD_INTO, gu) ? FOLD_INTO[gu] : undefined;
  if (folded !== undefined) return { country: folded, selectable: false };
  return { country: attributeFeature(properties, index), selectable: true };
}

/**
 * The five properties a province feature carries.
 *
 * Natural Earth ships 121 per feature and they cost more than the geometry.
 * `name` and `name_en` are what the UI renders; `iso_3166_2` and `gn_a1_code`
 * are join keys for later work; `sel` is §7.2's selectable flag, 1 or 0 rather
 * than a boolean because it is repeated 4,589 times.
 *
 * `iso_3166_2` is deliberately NOT the feature id: 4,596 features carry only
 * 4,501 distinct values, 60 codes are reused (worst PH-MNL ×17) and 12 are
 * `-99-X##~` placeholders. `adm1_code` is unique across all 4,596.
 */
function projectProperties(p, selectable) {
  return {
    name: p.name ?? null,
    name_en: p.name_en ?? null,
    iso_3166_2: p.iso_3166_2 ?? null,
    gn_a1_code: p.gn_a1_code ?? null,
    sel: selectable ? 1 : 0,
  };
}

/** Admin-1 features grouped by country, sorted so a rebuild is byte-stable. */
export function groupByCountry(admin1, index) {
  const byCountry = new Map();
  const orphans = [];
  for (const source of admin1.features) {
    const p = source.properties;
    const { country, selectable } = resolveTerritory(p, index);
    if (country === null) {
      if (!EXCLUDED.has(p.gu_a3)) orphans.push({ adm1_code: p.adm1_code, name: p.name });
      continue;
    }
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country).push({
      type: 'Feature',
      id: p.adm1_code,
      properties: projectProperties(p, selectable),
      geometry: source.geometry,
    });
  }
  for (const features of byCountry.values()) {
    features.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return { byCountry, orphans };
}

/**
 * Every country the reference set names must have a province file.
 *
 * One-way, like build-globe-topology.mjs's gate: extra emitted countries are
 * fine. The reference is the committed city-shard set, so this asserts the
 * invariant PR4 actually depends on — a country the picker can open has
 * geometry to draw.
 *
 * Names every offender. A count tells an operator a gate failed; the names
 * tell them what broke.
 */
export function assertCoverage(emitted, reference) {
  const missing = [...reference].filter((code) => !emitted.has(code)).sort();
  if (missing.length > 0) {
    throw new Error(
      `province build cannot reach ${missing.length} countries that have a city shard: ` +
      `${missing.join(', ')} — every country the picker can open must have geometry`
    );
  }
}

/**
 * The province budget measures gzip, not raw.
 *
 * lib/cityShard.test.ts:371's 150,000 is a RAW measurement of a city shard.
 * The same UX intent applied to geometry measures what crosses the wire,
 * because these files compress roughly 3:1 and a raw cap would reject files
 * that cost a user nothing.
 */
export const GZIP_BUDGET = 150_000;

/**
 * A raw ceiling as well, so a runaway build fails loudly rather than
 * committing something pathological to parse. Measured, the worst tol-0 file
 * (RU, 707,485 B) is just over it, which is the shape this is written for.
 */
export const RAW_TRIPWIRE = 700_000;

/**
 * The only two countries that need simplification, and the whole table.
 *
 * Measured at tol 0 across all 246: RU 193,912 B gzip and CA 193,318 B gzip
 * are the sole breaches. Everything else ships quantise-only, because §8.2
 * disqualifies a global tolerance in both directions — 1e-5 erases the Vatican
 * (and VA's entire admin-1 representation is that one polygon) and 1e-4 erases
 * 30 units including 13 Maldivian atolls and both Bermudian cities.
 *
 * CA is the hardest slice in the dataset despite having only 13 features: its
 * vertices are almost all Arctic coastline, which is exactly what Visvalingam
 * defends longest.
 */
export const TOLERANCE_OVERRIDE = Object.freeze({ CA: 1e-4, RU: 1e-4 });

/** Aborts the build when any file breaches either limit, naming all of them. */
export function assertBudget(sizes) {
  const overGzip = sizes.filter((s) => s.gzip > GZIP_BUDGET).sort((a, b) => a.code.localeCompare(b.code));
  if (overGzip.length > 0) {
    throw new Error(
      `${overGzip.length} province file(s) over the ${GZIP_BUDGET} B gzip budget: ` +
      overGzip.map((s) => `${s.code} ${s.gzip}`).join(', ')
    );
  }
  const overRaw = sizes.filter((s) => s.raw > RAW_TRIPWIRE).sort((a, b) => a.code.localeCompare(b.code));
  if (overRaw.length > 0) {
    throw new Error(
      `${overRaw.length} province file(s) over the ${RAW_TRIPWIRE} B raw tripwire: ` +
      overRaw.map((s) => `${s.code} ${s.raw}`).join(', ')
    );
  }
}

/**
 * Which admin-1 unit each city sits in (spec §6.5, D8).
 *
 * Containment is primary and the GeoNames code is the fallback, not the other
 * way round. The NAME join is not used at all: it reaches 63.38% of pairs and
 * scores literally zero in 35 countries, including Great Britain, Ireland,
 * Kenya, Puerto Rico, Sri Lanka and Nepal. Containment reaches 96.08% with
 * 0.00% ambiguous, and of the 20,124 cities whose pair fails the name join,
 * 19,229 (95.55%) land in a polygon anyway — containment does not care that
 * GeoNames says "England" and Natural Earth says "Shropshire".
 *
 * The 2,301 cities (3.92%) inside no polygon are why `a1c` is mandatory rather
 * than merely useful.
 */
export function assignCities(features, cities) {
  const byGnCode = new Map();
  for (const f of features) {
    const code = f.properties.gn_a1_code;
    // First wins, and only the first: gn_a1_code is not unique across NE's
    // admin-1 set, and a later feature overwriting an earlier one would make
    // the fallback depend on iteration order.
    if (code && !byGnCode.has(code)) byGnCode.set(code, f.id);
  }
  const cityProvince = {};
  const unplaced = [];
  for (const city of cities) {
    const point = [city.lon, city.lat];
    let hit = null;
    for (const f of features) {
      if (geoContains(f, point)) { hit = f.id; break; }
    }
    if (hit === null && city.a1c) hit = byGnCode.get(city.a1c) ?? null;
    if (hit === null) unplaced.push(city.id);
    else cityProvince[city.id] = hit;
  }
  return { cityProvince, unplaced };
}

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson';
const MAP_UNITS_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_map_units.geojson';
/** Natural Earth is public domain; the vector repo redistributes it unchanged. */
const SOURCE_LICENSE = 'Natural Earth (public domain), via nvkelso/natural-earth-vector v5.1.2';

/** The one country whose file is a re-envelope of a curated asset (§6.3, D7). */
const CURATED_COUNTRY = 'CN';

/**
 * A province file, with its timestamp preserved when nothing changed.
 *
 * Compared on `topology` and `cityProvince` alone — never the envelope. A
 * comparison that included `generatedAt` could never match, and the guard
 * would be dead code that looks alive.
 *
 * `idKey` rather than an assumption: China's file is a re-envelope of the
 * committed curated topology, whose join key is `adcode` (GB/T 2260) while
 * every other country's is `adm1_code`. The loader reads this field.
 */
export function provincePayload(country, topology, cityProvince, previous, now) {
  const body = { topology, cityProvince };
  const unchanged =
    previous !== null &&
    JSON.stringify({ topology: previous.topology, cityProvince: previous.cityProvince }) ===
      JSON.stringify(body);
  return {
    country,
    generatedAt: unchanged ? previous.generatedAt : now,
    source: SOURCE_URL,
    license: SOURCE_LICENSE,
    idKey: country === CURATED_COUNTRY ? 'adcode' : 'adm1_code',
    ...body,
  };
}

/**
 * China's file, from the committed curated topology rather than Natural Earth.
 *
 * Measured side by side: the curated asset is 58,650 B raw / 20,183 gz for 35
 * features and 5,823 vertices; the NE 10m slice is 296,569 / 89,818 for 32.
 * Forced to vertex parity the NE slice is STILL 10.5% larger raw. It also
 * names provinces in English, keys on iso_3166_2 rather than adcode, and
 * carries no nine-dash line at all — it treats the Spratlys as their own
 * country and the Paracels as a Chinese province.
 *
 * A rename, not a rebuild: the arcs and transform are carried by reference.
 * Re-running the pipeline over an already-quantised topology would throw
 * `already quantized`, and re-quantising hand-tuned geometry would only
 * degrade it.
 */
export function reEnvelopeCurated(curated) {
  const key = Object.keys(curated.objects)[0];
  return {
    ...curated,
    objects: { provinces: curated.objects[key] },
  };
}
