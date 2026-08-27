import type { TripData } from "./tripShared";
import type { CountryCode } from "./types";

/**
 * A leaf, on purpose: this module value-imports NOTHING.
 *
 * `tripCountry` used to live in lib/tripShared.ts beside `tripCurrency`, which
 * genuinely needs `getCountryProfile` and therefore the 70 KB CC0 facts
 * artifact. One accessor sharing a file with a currency lookup cost every route
 * in the app those bytes: components/shell/TripAccentProvider.tsx imports only
 * this function, app/layout.tsx mounts that provider, and so /login and the
 * unauthenticated /b/[code] briefing both shipped the artifact for a
 * one-line read of `data.input.country`.
 *
 * The two type imports above are erased at compile time and cost nothing —
 * the same reason lib/countryTips.ts may name `CountryFacts` and stay cheap.
 * The one back at lib/tripShared.ts is a type-level cycle only; there is no
 * runtime cycle, because nothing here evaluates anything from that module.
 *
 * lib/countryFacts.test.ts pins both halves: that this file reaches no
 * artifact, and that app/layout.tsx does not either.
 */

/**
 * The country a trip is in. The only way callers should read it: every trip
 * saved before the field existed is a China trip, so an absent country is an
 * explicit "CN" rather than an unknown — which is what removes the need for a
 * backfill. No caller should ever see `undefined` here.
 *
 * This `?? "CN"` is deliberately NOT one of the defaults the worldwide catalog
 * removed. Those were country *scopes* — "which places may we offer" — and a
 * wrong default there silently offered Chinese cities for a Japanese trip.
 * This one is a *persistence* backfill for a field that did not exist when
 * some rows were written, and deleting it would reclassify every legacy trip
 * as country-less rather than as Chinese. lib/tripShared.test.ts pins it.
 */
export function tripCountry(data: TripData): CountryCode {
  return data.input.country ?? "CN";
}
