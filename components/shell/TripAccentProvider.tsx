"use client";

import { PrefsProvider } from "./PrefsProvider";
import { useShellTrip } from "./ShellTripContext";
import { tripCountry } from "@/lib/tripCountry";

/**
 * Feeds the open trip's country into `PrefsProvider`, which is what makes the
 * per-country accent (spec §4.3) actually move.
 *
 * It exists because of an ordering problem. `PrefsProvider` takes a `country`
 * prop and its own docblock says PR2 passes the open trip's country — but the
 * trip lives in `ShellTripContext`, which was mounted *below* prefs, so prefs
 * could not see it and every trip rendered China's hue. A closeout audit caught
 * that the feature was inert.
 *
 * The fix is to nest the trip store outside prefs and bridge them here, rather
 * than to give `PrefsProvider` a dependency on the trip store: prefs are a user
 * concern and the trip is not, and inverting that would make the provider
 * unusable on any page without a trip.
 *
 * Off a trip route there is no trip, and `tripCountry` treats an absent country
 * as an explicit "CN" — so the fallback is the same value the app has always
 * used, not a guess.
 *
 * `tripCountry` comes from lib/tripCountry.ts, NOT from lib/tripShared.ts where
 * it used to live and is still re-exported. tripShared reaches the 70 KB CC0
 * facts artifact through `tripCurrency`, and this provider is mounted in
 * app/layout.tsx, so importing it from there put those bytes in the shared
 * client chunk of every route — /login and the unauthenticated /b/[code]
 * briefing included — to read one field off `data.input`.
 * lib/countryFacts.test.ts asserts the root layout stays clear of it.
 */
export function TripAccentProvider({ children }: { children: React.ReactNode }) {
  const trip = useShellTrip();
  const data = trip?.payload?.data;
  return <PrefsProvider country={data ? tripCountry(data) : "CN"}>{children}</PrefsProvider>;
}
