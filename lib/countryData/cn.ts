/**
 * China's editorial layer: the country data a human wrote, as plain values.
 *
 * This file imports nothing, and that is the whole point. Before T20 the same
 * strings lived inside the generators — the tips in `lib/itinerary.ts`, the
 * packing document in `lib/packing.ts` (and a second, byte-identical copy in
 * `lib/countryProfile.ts`), the rail speed in `lib/route.ts`. `countryProfile`
 * value-imported two of those modules to reach them, so routing the generators
 * back through a country profile would have closed a runtime cycle. Moving the
 * data down into a leaf lets both sides import it instead.
 *
 * `countryData.test.ts` reads this file's own source and fails if any import
 * ever appears here.
 *
 * Adding a second country means a sibling file of this shape: roughly five
 * tips, one packing document, a booking line, the hop and departure copy, and
 * optionally a rail speed with a citation. Nothing here is generated or
 * derived — every line is hand-written and specific to China.
 */

/** Typical average speed of China's high-speed rail network, station to station. */
export const CN_RAIL_KMH = 230;

/**
 * Snapshotted into a China trip when it is created, and published on that
 * trip's unauthenticated briefing.
 */
export const CN_GENERAL_TIPS = [
  "Set up Alipay and WeChat Pay with your home bank card before flying — most of China is cashless.",
  "Install and test a VPN before arrival if you need Google, WhatsApp or Instagram.",
  "Book high-speed rail seats on Trip.com or the official 12306 app up to 15 days ahead.",
  "Carry your passport everywhere — it's required for hotels, train travel and many attractions.",
  "Download offline maps (Amap 高德 works best in China) and a translation app with offline packs.",
];

/**
 * The China packing document: the country-level groups, without the seasonal,
 * activity and kids groups that `buildPackingList` adds around them.
 *
 * One object. Until T20 this was two byte-identical copies — `CHINA_PACKING`
 * in `lib/countryProfile.ts` and the literal inside `buildPackingList` —
 * with nothing pinning them equal. `countryData.test.ts` now pins both
 * consumers to this array by reference, and pins that the document appears in
 * exactly one source file.
 */
export const CN_PACKING = [
  {
    title: "Documents & Money",
    emoji: "🛂",
    items: [
      "Passport (6+ months validity) and visa or visa-free confirmation",
      "Printed hotel bookings and return flight (border control may ask)",
      "Alipay + WeChat Pay set up and tested with your bank card",
      "Some RMB cash (¥300–500) as a backup",
      "Travel insurance policy details",
    ],
  },
  {
    title: "Tech",
    emoji: "🔌",
    items: [
      "Phone + power bank — everything in China runs through your phone",
      "VPN installed and tested before departure",
      "Universal power adapter (China uses type A/C/I plugs, 220V)",
      "Offline translation app (Pleco or Google Translate offline pack)",
      "Offline maps app (Amap 高德 has the best China coverage)",
    ],
  },
  {
    title: "Health & Comfort",
    emoji: "💊",
    items: [
      "Prescription medicines in original packaging",
      "Pocket tissues and hand sanitiser — many restrooms lack paper",
      "Basic meds: stomach relief, cold tablets, motion sickness",
      "Reusable water bottle — hotels have kettles; tap water isn't potable",
    ],
  },
];

/** Generation-time copy: where and how far ahead to book. */
export const CN_BOOKING_COPY = [
  "High-speed rail seats open about 15 days ahead on 12306 or Trip.com.",
  "Your passport is the ticket — carry it to collect seats and to board.",
];

/**
 * Title for the morning of a day that moves to a new city. `{city}` is the
 * arrival city — substituted by the caller, never by string concatenation
 * here, so the template stays a single reviewable sentence.
 */
export const CN_HOP_TITLE = "High-speed rail or flight to {city}";

/** Note under the hop title. */
export const CN_HOP_NOTE = "Arrive at the station 30–40 minutes early; passport needed to board.";

/** Departure when the morning was already spent in transit. */
export const CN_DEPARTURE_EVENING = "Evening train or flight out — safe travels home!";

/** Departure when the afternoon is free to travel. */
export const CN_DEPARTURE_AFTERNOON = "Head to the airport or station — safe travels home!";

/** Added to the tips when the party includes children. */
export const CN_KIDS_TIP =
  "Travelling with kids: metro stations often lack lifts at every exit — pack light and allow buffer time.";

/**
 * Winter clothing line. A claim about northern China's winter air, so it is
 * country data rather than a general cold-weather item — it is wrong on a
 * coastal-fog winter anywhere in the southern hemisphere.
 */
export const CN_WINTER_CLOTHING_NOTE = "Lip balm and moisturiser — northern air is very dry";
