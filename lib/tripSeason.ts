import { getCountryProfile } from "./countryProfile";
import type { Season } from "./types";

/**
 * Which season a trip is in, decided server-side (spec §5.2).
 *
 * The client sends both the month it picked and a season it derived from that
 * month using `lib/months.ts` — whose table is hardcoded northern-hemisphere.
 * That is wrong for half the planet, and the app is going to all countries. So
 * when a month is present it is the fact, and the season the client computed
 * from it is discarded in favour of the country profile's answer.
 *
 * Pure and free of the request, so the rule is testable without a route.
 */
export function resolveTripSeason(
  clientSeason: Season,
  month: number | undefined,
  country: string
): Season {
  // No month means an old client that never sent one. Its season is all there
  // is, and rejecting the trip over a field that did not exist would break it.
  if (month === undefined) return clientSeason;
  // Defence in depth — the schema rejects these first. A nonsense month must
  // not be allowed to produce a confidently nonsense season.
  if (!Number.isInteger(month) || month < 1 || month > 12) return clientSeason;

  return getCountryProfile(country).seasonOfMonth(month);
}
