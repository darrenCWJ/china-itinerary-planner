/** ISO 3166-1 alpha-2, uppercase. */
export type CountryCode = string;

export interface Country {
  code: CountryCode;
  name: string;
  localName: string | null;
  hemisphere: "north" | "south";
  /**
   * Curated OKLCH hue override, 0–359. Omitted means derive it.
   * A hue rather than a colour deliberately: lightness and chroma stay pinned
   * in lib/accent, so no override can produce an illegible accent.
   */
  accentHue?: number;
  /** Wikimedia Commons hero image. Unused until the imagery work. */
  image?: string;
  /** Cultural glyph shown as a chop mark, e.g. 同行 for China. */
  mark?: string;
}

/**
 * Hand-tuned records. Everything absent here is synthesised, so this table
 * grows only when a country earns bespoke treatment — it is not a registry of
 * supported countries. Adding a country to the app is data elsewhere.
 */
const CURATED: Record<string, Omit<Country, "code" | "hemisphere">> = {
  // Hues are hand-assigned one per palette slot, so the countries people
  // actually travel to are all distinguishable from each other. Derivation
  // alone put four of these on the same hue — see lib/accent.
  VN: { name: "Vietnam", localName: "Việt Nam", accentHue: 0 },
  MA: { name: "Morocco", localName: "المغرب", accentHue: 15 },
  // 30 sits on the vermilion seal (#c93b2e) the app already uses for China.
  CN: { name: "China", localName: "中国", accentHue: 30, mark: "同行" },
  EG: { name: "Egypt", localName: "مصر", accentHue: 45 },
  ES: { name: "Spain", localName: "España", accentHue: 60 },
  MX: { name: "Mexico", localName: "México", accentHue: 75 },
  TR: { name: "Türkiye", localName: "Türkiye", accentHue: 90 },
  TH: { name: "Thailand", localName: "ไทย", accentHue: 105 },
  DE: { name: "Germany", localName: "Deutschland", accentHue: 120 },
  KR: { name: "South Korea", localName: "한국", accentHue: 135 },
  SG: { name: "Singapore", localName: null, accentHue: 150 },
  PT: { name: "Portugal", localName: "Portugal", accentHue: 165 },
  GR: { name: "Greece", localName: "Ελλάδα", accentHue: 180 },
  US: { name: "United States", localName: null, accentHue: 195 },
  FR: { name: "France", localName: "France", accentHue: 210 },
  IN: { name: "India", localName: "भारत", accentHue: 225 },
  GB: { name: "United Kingdom", localName: null, accentHue: 240 },
  AU: { name: "Australia", localName: null, accentHue: 255 },
  ZA: { name: "South Africa", localName: null, accentHue: 270 },
  IT: { name: "Italy", localName: "Italia", accentHue: 285 },
  NZ: { name: "New Zealand", localName: "Aotearoa", accentHue: 300 },
  ID: { name: "Indonesia", localName: "Indonesia", accentHue: 315 },
  BR: { name: "Brazil", localName: "Brasil", accentHue: 330 },
  JP: { name: "Japan", localName: "日本", accentHue: 345 },
};

/**
 * Southern-hemisphere countries, which invert the seasons.
 *
 * DERIVED, NOT HAND-MAINTAINED. Every code here is a country whose centroid
 * latitude in `data/country-facts.json` is negative, plus the named
 * straddlers below. The artifact has carried a `lat` for all 246 countries
 * since the country-facts ingest landed, and
 * `lib/countryFacts.test.ts`'s `SOUTHERN cross-check` re-derives this set from
 * it in BOTH directions on every run: a code listed here whose centroid is not
 * negative fails, and a country whose centroid IS negative and is missing from
 * here fails too.
 *
 * The second direction is the one that was missing. This list was hand-written
 * when no centroid data existed in the repo, the check that arrived later only
 * ever walked the list, and the list had 34 of the 58 negative-latitude
 * countries — so Ecuador, Gabon, Mauritius, the Falklands, the Comoros and 20
 * others were told a June trip was summer when it is winter. A one-directional
 * check cannot see a missing entry; that is why the reconciliation is
 * bidirectional and why this comment says derived rather than curated.
 *
 * IT IS A LITERAL RATHER THAN A LOOKUP, and that is a bundle constraint, not
 * an oversight. This module is a zero-import leaf, pinned as one by
 * `lib/countryFacts.test.ts`, because client components import it for accents,
 * marks and hemispheres; `data/country-facts.json` is 70 KB, so reading the
 * latitudes here at runtime would put the whole artifact into every page that
 * wants a hue. The derivation therefore happens in the test, which runs on
 * every commit and has no bundle to pay for, and the answer is checked in.
 * Regenerating after an ingest is a one-liner over the artifact's `lat`
 * fields; the test tells you exactly which codes moved.
 *
 * TWO JUDGEMENTS SIT ON TOP OF THE SIGN, both named rather than rounded:
 *
 * - KE (+0.1) is listed although its centroid is north of the equator. Kenya
 *   straddles it, and Nairobi, the Mara and the coast — everywhere a visitor
 *   goes — are south of it, so its travel season is the southern one. It is
 *   the sole entry on `EQUATOR_STRADDLERS` in the cross-check, which fails if
 *   Wikidata ever moves the centroid south and makes the exception cruft.
 * - CG (-0.75), EC (-1.0), GA (-0.68) and NR (-0.53) are listed on the sign
 *   alone, and NO THRESHOLD EXCLUDES THEM. Within a degree of the equator
 *   neither hemisphere's seasons mean anything — these places have wet and dry
 *   seasons, not summer and winter — and this app has only two answers to
 *   give. Rounding them to "north" would be picking the wrong one of two wrong
 *   answers and hiding the choice in a magic number; the sign is at least the
 *   one the data states. Naming them here is the honest version of that.
 */
const SOUTHERN = new Set([
  "AO", "AR", "AS", "AU", "BI", "BO", "BR", "BW", "CC", "CD", "CG", "CK",
  "CL", "CX", "EC", "FJ", "FK", "GA", "GS", "ID", "IO", "KE", "KM", "LS",
  "MG", "MU", "MW", "MZ", "NA", "NC", "NF", "NR", "NU", "NZ", "PE", "PF",
  "PG", "PN", "PY", "RE", "RW", "SB", "SC", "SH", "SZ", "TF", "TK", "TL",
  "TO", "TV", "TZ", "UY", "VU", "WF", "WS", "YT", "ZA", "ZM", "ZW",
]);

/**
 * ISO 3166-1 numeric → alpha-2.
 *
 * Exists because Natural Earth (and the world-atlas TopoJSON derived from it)
 * keys country features by numeric code, while everything in this app speaks
 * alpha-2. `scripts/build-world-topology.mjs` re-keys the topology through this
 * table; `lib/isoTopology.ts` reconciles the result.
 *
 * Generated from two independent public references and cross-checked against
 * each other — `i18n-iso-countries@7/codes.json` and the datasets/country-codes
 * CSV. They agreed on all 249 official entries; nothing here is hand-typed.
 *
 * `983`/`XK` is the one non-official entry: Kosovo has no assigned ISO code, and
 * 983/XK is the user-assigned pair in common use. It is listed so Kosovo has a
 * code to be *documented under* — the topology carries no id for it either, so
 * it lands in `SEARCH_ONLY`.
 *
 * Keys are zero-padded three-character strings because that is the literal form
 * TopoJSON feature ids take; a numeric key would silently lose the padding.
 */
export const ISO_NUMERIC_TO_ALPHA2: Readonly<Record<string, CountryCode>> = {
  "004": "AF", "008": "AL", "010": "AQ", "012": "DZ", "016": "AS", "020": "AD",
  "024": "AO", "028": "AG", "031": "AZ", "032": "AR", "036": "AU", "040": "AT",
  "044": "BS", "048": "BH", "050": "BD", "051": "AM", "052": "BB", "056": "BE",
  "060": "BM", "064": "BT", "068": "BO", "070": "BA", "072": "BW", "074": "BV",
  "076": "BR", "084": "BZ", "086": "IO", "090": "SB", "092": "VG", "096": "BN",
  "100": "BG", "104": "MM", "108": "BI", "112": "BY", "116": "KH", "120": "CM",
  "124": "CA", "132": "CV", "136": "KY", "140": "CF", "144": "LK", "148": "TD",
  "152": "CL", "156": "CN", "158": "TW", "162": "CX", "166": "CC", "170": "CO",
  "174": "KM", "175": "YT", "178": "CG", "180": "CD", "184": "CK", "188": "CR",
  "191": "HR", "192": "CU", "196": "CY", "203": "CZ", "204": "BJ", "208": "DK",
  "212": "DM", "214": "DO", "218": "EC", "222": "SV", "226": "GQ", "231": "ET",
  "232": "ER", "233": "EE", "234": "FO", "238": "FK", "239": "GS", "242": "FJ",
  "246": "FI", "248": "AX", "250": "FR", "254": "GF", "258": "PF", "260": "TF",
  "262": "DJ", "266": "GA", "268": "GE", "270": "GM", "275": "PS", "276": "DE",
  "288": "GH", "292": "GI", "296": "KI", "300": "GR", "304": "GL", "308": "GD",
  "312": "GP", "316": "GU", "320": "GT", "324": "GN", "328": "GY", "332": "HT",
  "334": "HM", "336": "VA", "340": "HN", "344": "HK", "348": "HU", "352": "IS",
  "356": "IN", "360": "ID", "364": "IR", "368": "IQ", "372": "IE", "376": "IL",
  "380": "IT", "384": "CI", "388": "JM", "392": "JP", "398": "KZ", "400": "JO",
  "404": "KE", "408": "KP", "410": "KR", "414": "KW", "417": "KG", "418": "LA",
  "422": "LB", "426": "LS", "428": "LV", "430": "LR", "434": "LY", "438": "LI",
  "440": "LT", "442": "LU", "446": "MO", "450": "MG", "454": "MW", "458": "MY",
  "462": "MV", "466": "ML", "470": "MT", "474": "MQ", "478": "MR", "480": "MU",
  "484": "MX", "492": "MC", "496": "MN", "498": "MD", "499": "ME", "500": "MS",
  "504": "MA", "508": "MZ", "512": "OM", "516": "NA", "520": "NR", "524": "NP",
  "528": "NL", "531": "CW", "533": "AW", "534": "SX", "535": "BQ", "540": "NC",
  "548": "VU", "554": "NZ", "558": "NI", "562": "NE", "566": "NG", "570": "NU",
  "574": "NF", "578": "NO", "580": "MP", "581": "UM", "583": "FM", "584": "MH",
  "585": "PW", "586": "PK", "591": "PA", "598": "PG", "600": "PY", "604": "PE",
  "608": "PH", "612": "PN", "616": "PL", "620": "PT", "624": "GW", "626": "TL",
  "630": "PR", "634": "QA", "638": "RE", "642": "RO", "643": "RU", "646": "RW",
  "652": "BL", "654": "SH", "659": "KN", "660": "AI", "662": "LC", "663": "MF",
  "666": "PM", "670": "VC", "674": "SM", "678": "ST", "682": "SA", "686": "SN",
  "688": "RS", "690": "SC", "694": "SL", "702": "SG", "703": "SK", "704": "VN",
  "705": "SI", "706": "SO", "710": "ZA", "716": "ZW", "724": "ES", "728": "SS",
  "729": "SD", "732": "EH", "740": "SR", "744": "SJ", "748": "SZ", "752": "SE",
  "756": "CH", "760": "SY", "762": "TJ", "764": "TH", "768": "TG", "772": "TK",
  "776": "TO", "780": "TT", "784": "AE", "788": "TN", "792": "TR", "795": "TM",
  "796": "TC", "798": "TV", "800": "UG", "804": "UA", "807": "MK", "818": "EG",
  "826": "GB", "831": "GG", "832": "JE", "833": "IM", "834": "TZ", "840": "US",
  "850": "VI", "854": "BF", "858": "UY", "860": "UZ", "862": "VE", "876": "WF",
  "882": "WS", "887": "YE", "894": "ZM", "983": "XK",
};

export function isCountryCode(s: string): boolean {
  return /^[A-Za-z]{2}$/.test(s);
}

/**
 * The hand-tuned name for a code, or `null` when this table has none.
 *
 * `getCountry(code).name` cannot answer this question and must not be made to:
 * it falls back to the code itself, so `"PE"` is both a name it found and a
 * name it did not. The other 222 countries are named by the CC0 Wikidata
 * artifact, and `getCountryName` in lib/countryFacts.ts is where the two meet
 * — hand-tuned first, ingested second.
 *
 * That direction is deliberate and it is a bundle constraint, not a taste.
 * This module is imported by client components for accents, marks and
 * hemispheres; `data/country-facts.json` is 70 KB. Reaching for the artifact
 * from HERE would put 70 KB into every page that resolves a country name,
 * including the ones that only want a hue. So this module stays a zero-import
 * leaf and the module that already pays for the artifact does the merging —
 * the same shape as `lib/geoNamesId.ts` against the 3.65 MB city index.
 */
export function curatedCountryName(code: string): string | null {
  const normalised = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!isCountryCode(normalised)) return null;
  return CURATED[normalised]?.name ?? null;
}

/**
 * Total function: always returns a record, never throws. Callers render what
 * they get rather than branching on undefined, so an unrecognised code
 * degrades to a plain one instead of breaking the page it appears on.
 */
export function getCountry(code: string): Country {
  const normalised = typeof code === "string" ? code.trim().toUpperCase() : "";
  const known = isCountryCode(normalised) ? normalised : "";
  const curated = known ? CURATED[known] : undefined;

  return {
    code: known,
    name: curated?.name ?? known,
    localName: curated?.localName ?? null,
    hemisphere: SOUTHERN.has(known) ? "south" : "north",
    ...(curated?.accentHue !== undefined ? { accentHue: curated.accentHue } : {}),
    ...(curated?.image !== undefined ? { image: curated.image } : {}),
    ...(curated?.mark !== undefined ? { mark: curated.mark } : {}),
  };
}
