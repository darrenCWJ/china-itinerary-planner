/**
 * The map viewBox, extracted from `components/map/mapShared.ts` so pure
 * geometry modules can import it.
 *
 * `mapShared.ts` is `"use client"` and imports React, so anything under `lib/`
 * that it fed would pull a client module into the node test project. These
 * three numbers are the only part of it that pure maths needs, and they depend
 * on nothing at all.
 */

/** One viewBox for every level, so a zoom transform means the same thing. */
export const MAP_VIEW_W = 860;
export const MAP_VIEW_H = 620;

/** Inset of the fitted extent, so coastlines aren't flush against the edge. */
export const MAP_VIEW_PAD = 10;
