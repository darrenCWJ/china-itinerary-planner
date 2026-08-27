/**
 * The default a country gets when nobody has researched it.
 *
 * Deliberately thin. Anything a country has not been researched for is absent
 * rather than guessed: no holidays, no climate, no rail estimate. The one
 * thing it must get right is the hemisphere, which is the bug the country
 * profile seam exists to fix.
 *
 * Zero imports, by contract — see `cn.ts`'s header and `countryData.test.ts`.
 */

export const NEUTRAL_PACKING = [
  {
    title: "Documents & Money",
    emoji: "🛂",
    items: [
      "Passport with at least six months' validity, plus any visa you need",
      "A payment card that works abroad, and a small amount of local cash",
      "Travel insurance policy details",
      "Copies of your bookings, stored offline",
    ],
  },
  {
    title: "Tech",
    emoji: "🔌",
    items: [
      "Universal power adapter",
      "Phone and power bank",
      "Offline maps and a translation app downloaded before you fly",
    ],
  },
  {
    title: "Health & Comfort",
    emoji: "💊",
    items: [
      "Prescription medicines in their original packaging",
      "Basic meds: stomach relief, painkillers, motion sickness",
      "Reusable water bottle",
      "Comfortable broken-in walking shoes",
    ],
  },
];

export const NEUTRAL_TIPS = [
  "Check your passport validity and entry requirements well before you book.",
  "Tell your bank you are travelling so your cards keep working.",
  "Download offline maps and a translation pack before you leave.",
];

/**
 * Generation-time booking copy that names no network and no vendor, because
 * neither is known for an unresearched country.
 *
 * Naming nothing is what lets `suggestRoute` emit it on a flown route as well
 * as a ground one: it is true of a flight, a coach and a ferry alike. China's
 * version is not, which is why that one is gated on a rail speed being known.
 */
export const NEUTRAL_BOOKING_COPY = [
  "Book long-distance transport ahead — fares climb close to the date.",
];

/**
 * Title for the morning of a day that moves to a new city. `{city}` is the
 * arrival city, substituted by the caller.
 *
 * Names no mode of transport, because none is known: China's version says
 * "High-speed rail or flight", which is a claim about a network that most
 * countries do not have.
 */
export const NEUTRAL_HOP_TITLE = "Travel to {city}";

/**
 * No note under the hop title.
 *
 * China's note ("arrive 30–40 minutes early; passport needed to board") is
 * about boarding a Chinese train. Nothing equivalent is known for an
 * unresearched country, and the honest-gap rule says absent, never a hedge.
 */
export const NEUTRAL_HOP_NOTE: string | null = null;

/** Departure when the morning was already spent in transit. */
export const NEUTRAL_DEPARTURE_EVENING = "Evening departure — safe travels home!";

/** Departure when the afternoon is free to travel. */
export const NEUTRAL_DEPARTURE_AFTERNOON = "Time to head home — safe travels!";

/**
 * Added to the tips when the party includes children.
 *
 * China's version explains that metro stations often lack lifts at every exit
 * — true there, unverified anywhere else, so only the transferable half of the
 * advice survives here.
 */
export const NEUTRAL_KIDS_TIP =
  "Travelling with kids: pack light and allow buffer time between stops.";

/**
 * No extra winter clothing line.
 *
 * China's is "northern air is very dry", which is a claim about northern
 * China's winter and wrong on, say, Lima's coastal-fog winter.
 */
export const NEUTRAL_WINTER_CLOTHING_NOTE: string | null = null;
