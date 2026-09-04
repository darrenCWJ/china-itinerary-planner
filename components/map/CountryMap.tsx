"use client";

import type { Airport } from "@/lib/airports";
import type { ProjectionEntry } from "@/lib/countryProjection";
import type { ProvinceFile } from "@/lib/provinceTopology";
import type { RegionId } from "@/lib/regionScheme";
import { CountryLevel } from "./CountryLevel";
import { CountryPlaceList } from "./CountryPlaceList";
import type { HoverPos } from "./mapShared";
import type { DerivedClimateIndex, MapPlace } from "./mapTypes";

/**
 * Country level of the two-level picker (spec §6), and now only the dispatcher
 * for it: a country with an admin-1 file renders `CountryLevel` over it, and a
 * country whose geometry has not arrived renders the list alone.
 *
 * It used to be a three-way dispatch, with China routed to a `ChinaLevel` of
 * its own — a second renderer over a second asset (`public/china-provinces.json`)
 * whose zoom level was China's seven curated regions rather than admin-1.
 * That made China the one country answering to a different control than the
 * other 245, in an app whose whole direction is worldwide, and it is why
 * China alone had no province picker and no airport layer: both were gated on
 * `!hasCurated`.
 *
 * China now takes this path like everyone else, over `public/provinces/CN.json`
 * — which §6.3 already specified as a re-envelope of the same curated topology,
 * Chinese names, `adcode` join key, nine-dash line and all. The seven regions
 * are not gone; they moved to where they carry meaning. `REGION_MONTHS` is
 * still keyed by them and `mapTypes.isChinaPlace` still reads a Chinese city's
 * climate off them (§6.4: "preserved verbatim"). What they stopped being is
 * the map's zoom level.
 */

interface LevelProps {
  places: MapPlace[];
  selected: string[];
  month: number;
  /**
   * The region either level is framed on, or null for the whole country.
   *
   * `RegionId`, and the judgement this reverses is worth naming: PR3's J14
   * said `ChinaRegion` "permanently", because other countries had no regions
   * to zoom into and a wider type would have been a promise the level could
   * not keep. Phase 4 built the regions — `lib/regionScheme.ts` answers "what
   * are this country's groups" for all 246 — so the promise is now kept and
   * the narrow type is the thing that would be wrong.
   *
   * `RegionId` and NOT a widened `ChinaRegion`, which is the other way to
   * write this and is unsafe: `tsconfig.json` does not set
   * `noUncheckedIndexedAccess`, so a non-China key indexing `REGION_MONTHS` or
   * `REGION_META` compiles clean and throws at render. The union below at
   * `Object.keys(REGION_META) as ChinaRegion[]` is an unchecked assertion that
   * would go on compiling and stop meaning anything.
   */
  zoomRegion: RegionId | null;
  routeIds: string[];
  onZoomRegion: (region: RegionId | null) => void;
  onTogglePlace: (place: MapPlace) => void;
  onHoverPlace: (place: MapPlace | null, pos: HoverPos | null) => void;
}

export interface CountryMapProps extends LevelProps {
  /** ISO alpha-2 of the country being planned. */
  country: string;
  /**
   * Every other country's admin-1 file, or null while it is in flight or after
   * it failed — the two are the same thing here, and deliberately: §5.2 makes
   * the map an enhancement, so both render the list on its own rather than a
   * spinner or an error.
   *
   * Required rather than optional even though it is nullable. A caller that
   * simply forgot it would otherwise get the list-only fallback in silence,
   * which is exactly the bug this PR exists to fix and is invisible on screen.
   */
  provinces: ProvinceFile | null;
  /** Its §5.4 manifest entry, or null to fall back to a fit over the units. */
  projection: ProjectionEntry | null;
  /**
   * The map is a VIEW of a plan rather than a picker for one — `RouteMap`
   * (§2.1) — so `CountryLevel` draws its markers without offering to toggle
   * anything.
   *
   * Deliberately not spread into the other two branches. `ChinaLevel` is
   * frozen by §9.5 and has no card to suppress; `CountryPlaceList` is §5.2's
   * spine and is the one control per place a read-only surface keeps, so
   * silencing it would leave a trip's stops announced by nothing at all.
   */
  readOnly?: boolean;
  /**
   * The open country's airports, for §10.2's "Main airport" line on
   * `CountryLevel`'s card.
   *
   * Here rather than on `LevelProps`, and for the reason `readOnly` above is:
   * `LevelProps` is the shape BOTH levels are built from, and `ChinaLevel` has
   * no card to put a line in. §9.5 pins China's rendered output byte for byte,
   * so the frozen path gains nothing here — not even a prop it would ignore.
   *
   * Optional, because `RouteMap` is this component's second caller and fetches
   * no airports at all.
   */
  airports?: Airport[];
  /**
   * Whether §10.1's airport layer is drawn over the country level's markers.
   *
   * Separate from `airports` above, and not inferred from it, because the
   * array has two readers and only one of them is the layer: the card's "Main
   * airport" line (§10.2) is a fact about the place a reader has just opened
   * and is never gated on a map toggle. `MapExplorer` has passed `airports`
   * since PR1 for the route estimator, so a layer that drew whenever it was
   * handed an array would already be on everywhere with nothing to turn it off.
   *
   * Optional and off, because `RouteMap` is this component's second caller and
   * has neither airports nor a control to toggle them with.
   */
  showAirports?: boolean;
  /**
   * The open country's derived climate, for `CountryLevel`'s markers and its
   * card's climate line (§9.4). Threaded, not held: `MapExplorer` and
   * `RouteMap` each build their own from the fetches they already make.
   * Optional because the list-only branch below has no marker to colour.
   */
  climate?: DerivedClimateIndex;
}

export function CountryMap({
  country,
  provinces,
  projection,
  readOnly = false,
  airports,
  showAirports,
  climate,
  ...level
}: CountryMapProps) {
  if (provinces) {
    return (
      <CountryLevel
        country={country}
        provinces={provinces}
        projection={projection}
        places={level.places}
        selected={level.selected}
        month={level.month}
        routeIds={level.routeIds}
        // The province level's framing, threaded rather than held here: the
        // caller owns it because the chrome that changes it is the caller's,
        // and because `ChinaLevel` beside this reads the same prop. One piece
        // of state, two renderers, and neither of them able to disagree with
        // the header about which region is open.
        region={level.zoomRegion}
        readOnly={readOnly}
        airports={airports}
        showAirports={showAirports}
        climate={climate}
        onTogglePlace={level.onTogglePlace}
        onHoverPlace={level.onHoverPlace}
      />
    );
  }
  // No geometry: the list is the whole level, and reaches every place in it.
  return (
    <CountryPlaceList
      country={country}
      places={level.places}
      selected={level.selected}
      onTogglePlace={level.onTogglePlace}
    />
  );
}
