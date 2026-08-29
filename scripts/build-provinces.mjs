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
