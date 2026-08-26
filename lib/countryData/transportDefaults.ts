/**
 * The estimator's country-neutral constants.
 *
 * Everything here is a claim about aircraft, airports and taxis rather than
 * about one country's networks, which is why it is shared by every profile.
 * The one genuinely country-specific number, rail speed, is deliberately NOT
 * here — it lives with the country that owns it (`cn.ts`).
 *
 * Zero imports, by contract. `lib/countryProfile.ts` and `lib/route.ts` both
 * read these; if they lived in `route.ts` the profile would have to import the
 * estimator and the estimator would later have to import the profile back.
 * See `countryData.test.ts`, which reads this file's own source.
 */

/** Legs longer than this are usually better flown than railed. */
export const FLIGHT_THRESHOLD_KM = 1200;

export const RAIL_BUFFER_H = 0.75;

export const FLIGHT_KMH = 700;

/**
 * Time spent at the airport itself: check-in, security, boarding, taxi and
 * baggage reclaim. Gate-side only — it does not include getting from the city
 * to the airport. That trip is `GROUND_TRANSFER_KMH` below, added on top for
 * an airport-aware flight, so the two terms are legitimately additive and do
 * not double-count the ride to the airport.
 *
 * On the zero-airport branch there is no separate transfer term, so this same
 * 2.5h is the only non-flight time in that estimate — there it deliberately
 * stands in for the transfer time too, because no airport is known and so no
 * transfer distance is knowable to estimate it from. Relative to the
 * airport-aware model above, which adds a real transfer term on top, that
 * makes the legacy branch an under-count by exactly the transfer term it has
 * no distance to compute: the test suite pins this on the same city pair —
 * 6.5h airport-aware against 6.0h legacy for Beijing → Ürümqi.
 */
export const FLIGHT_BUFFER_H = 2.5;

/**
 * Average door-to-door speed between a city centre and its airport. Deliberately
 * slow: it stands for a taxi or airport train plus the walk at either end, not
 * a motorway cruise.
 */
export const GROUND_TRANSFER_KMH = 60;
