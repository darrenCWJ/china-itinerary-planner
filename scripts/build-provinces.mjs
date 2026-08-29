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
