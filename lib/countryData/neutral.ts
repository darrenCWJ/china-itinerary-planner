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
 */
export const NEUTRAL_BOOKING_COPY = [
  "Book long-distance transport ahead — fares climb close to the date.",
];
