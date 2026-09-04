/**
 * Spec §9.7's honesty surface, as lines for `components/plan/GapNote.tsx`.
 *
 * `GapNote` takes `string[]` rather than a country code so it drags no data
 * module into any bundle, and the spec is explicit that "it must not resolve
 * the climate artifact itself, and it renders nothing for China". So the
 * decision is made here, from two facts the caller already holds — which
 * country is open, and how many derived rows it is drawing — and the
 * component is handed the answer.
 *
 * One paragraph, deliberately: it is a footnote under a map, not a second
 * tip list, and `GapNote` renders each line as its own `<p>`.
 */
export const DERIVED_CLIMATE_NOTE =
  "Temperatures are 1981–2010 grid normals sampled at each city, not station records. " +
  "Mountain towns above 2,000 m typically read about 3–4 °C colder than they are, and " +
  "coastal fog and monsoon timing are not modelled.";

/**
 * The one country whose month table is hand-authored (`lib/months.ts`'s
 * `REGION_MONTHS`) and whose pins therefore carry a curated claim rather than
 * a derived one. Restates `components/map/mapTypes.ts`'s `CLIMATE_COUNTRY`
 * because lib/ cannot import components/; `mapTypes.test.tsx` pins that the
 * two agree.
 */
const CURATED_CLIMATE_COUNTRY = "CN";

/**
 * `[]` for China, and `[]` where no derived row was read — a country whose
 * climate file 404s draws grey pins, and grey is the absence of a claim, so
 * there is nothing to qualify. Otherwise the one paragraph above.
 */
export function climateGapNote(country: string, derivedRows: number): string[] {
  if (country.trim().toUpperCase() === CURATED_CLIMATE_COUNTRY) return [];
  if (!Number.isFinite(derivedRows) || derivedRows <= 0) return [];
  return [DERIVED_CLIMATE_NOTE];
}
