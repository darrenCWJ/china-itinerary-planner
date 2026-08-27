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

/**
 * The neutral packing group titles, and the three neutral items the facts
 * layer in lib/countryProfile.ts edits around.
 *
 * Named here, and read from here by both sides, so the two cannot drift. The
 * facts layer replaces the generic adapter line with the plug-and-voltage one
 * when it knows the sockets, slips a currency-named cash line in after the
 * payment-card item, and puts a single-language translation pack in front of
 * the generic offline-maps line. A retyped copy of any of these strings over
 * there would go stale the day this file is reworded, and the failure mode is
 * silent: the anchor stops matching, and the fact item lands somewhere else.
 *
 * This stays a zero-import leaf — these are its own strings, exported under a
 * name rather than duplicated.
 */
export const NEUTRAL_DOCUMENTS_GROUP = "Documents & Money";
export const NEUTRAL_TECH_GROUP = "Tech";
export const NEUTRAL_PAYMENT_CARD_ITEM =
  "A payment card that works abroad, and a small amount of local cash";
export const NEUTRAL_ADAPTER_ITEM = "Universal power adapter";
export const NEUTRAL_OFFLINE_MAPS_ITEM =
  "Offline maps and a translation app downloaded before you fly";

export const NEUTRAL_PACKING = [
  {
    title: NEUTRAL_DOCUMENTS_GROUP,
    emoji: "🛂",
    items: [
      "Passport with at least six months' validity, plus any visa you need",
      NEUTRAL_PAYMENT_CARD_ITEM,
      "Travel insurance policy details",
      "Copies of your bookings, stored offline",
    ],
  },
  {
    title: NEUTRAL_TECH_GROUP,
    emoji: "🔌",
    items: [
      NEUTRAL_ADAPTER_ITEM,
      "Phone and power bank",
      NEUTRAL_OFFLINE_MAPS_ITEM,
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
