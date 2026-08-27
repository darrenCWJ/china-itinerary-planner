/** ISO 3166-1 alpha-2, uppercase. */
export type CountryCode = string;

/**
 * Which half of the planet a country's seasons follow.
 *
 * Named rather than written inline at each use so lib/meta.ts's season-months
 * tables and `Country.hemisphere` cannot drift into two different unions. It is
 * a `type`, so importing it costs no bytes and this module stays the zero-import
 * leaf lib/countryFacts.test.ts pins it as.
 */
export type Hemisphere = "north" | "south";

export interface Country {
  code: CountryCode;
  name: string;
  localName: string | null;
  hemisphere: Hemisphere;
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
 * The English name of every country `CURATED` above does not name.
 *
 * DERIVED, NOT HAND-MAINTAINED — the same shape, and for the same reason, as
 * `SOUTHERN` below. Every entry is the `name` field of that country's record in
 * `data/country-facts.json`, the CC0 Wikidata artifact, and
 * `lib/countryFacts.test.ts`'s `INGESTED_NAMES cross-check` re-derives this
 * table from it on every run in BOTH directions: a code here whose name differs
 * from the artifact's fails, and a country the artifact names that is missing
 * from here fails too. Regenerating after an ingest is a one-liner over the
 * artifact's `name` fields; the test names every code that moved.
 *
 * WHAT IT FIXES. `getCountry(code).name` fell back to the bare code, so the
 * map pane's heading, its "← Back to …" control, the destination step's
 * country chip and its empty state all read **GA** rather than **Gabon** — for
 * 222 of the 246 countries this app now opens, which is to say for everywhere
 * except the 24 somebody hand-tuned. The name was never missing; it was in an
 * artifact this module is forbidden to read.
 *
 * IT IS A LITERAL RATHER THAN A LOOKUP, and that is a bundle constraint, not an
 * oversight. This module is a zero-import leaf, pinned as one by
 * `lib/countryFacts.test.ts`, whose own comment names *this exact defect* and
 * the tempting fix for it: "The tempting fix for `getCountry("PE").name ===
 * "PE"` is to make THIS module fall back to the artifact." It is 70 KB and this
 * module is imported by client components for accents, marks and hemispheres,
 * so that fix would put the whole artifact into every page that wants a hue —
 * and `MUST_STAY_CHEAP` in that file forbids it outright for
 * components/map/MapExplorer.tsx, which is where the bare codes were being
 * drawn. The 222 names are 4.1 KB. The derivation therefore happens in the
 * test, which runs on every commit and has no bundle to pay for, and the answer
 * is checked in.
 *
 * THE CURATED TABLE STILL WINS, and this table does not contain the codes it
 * covers, so the precedence is structural rather than a rule in `getCountry`
 * that could be reordered. The two disagree on purpose where both would have an
 * answer: `CN` is "China" here and "People's Republic of China" upstream, `TR`
 * is "Türkiye" and "Turkey". Those 24 rows are editorial, they are what the app
 * already calls those countries everywhere else, and an ingest must never
 * overwrite them — the same precedence `getCountryName` in lib/countryFacts.ts
 * applies to the artifact, so the two resolvers cannot disagree about any code.
 */
const INGESTED_NAMES: Record<string, string> = {
  AD: "Andorra", AE: "United Arab Emirates", AF: "Afghanistan", AG: "Antigua and Barbuda",
  AI: "Anguilla", AL: "Albania", AM: "Armenia", AO: "Angola", AR: "Argentina",
  AS: "American Samoa", AT: "Austria", AW: "Aruba", AX: "Åland", AZ: "Azerbaijan",
  BA: "Bosnia and Herzegovina", BB: "Barbados", BD: "Bangladesh", BE: "Belgium",
  BF: "Burkina Faso", BG: "Bulgaria", BH: "Bahrain", BI: "Burundi", BJ: "Benin",
  BL: "Saint Barthélemy", BM: "Bermuda", BN: "Brunei", BO: "Bolivia",
  BQ: "Caribbean Netherlands", BS: "The Bahamas", BT: "Bhutan", BW: "Botswana", BY: "Belarus",
  BZ: "Belize", CA: "Canada", CC: "Cocos (Keeling) Islands",
  CD: "Democratic Republic of the Congo", CF: "Central African Republic",
  CG: "Republic of the Congo", CH: "Switzerland", CI: "Ivory Coast", CK: "Cook Islands",
  CL: "Chile", CM: "Cameroon", CO: "Colombia", CR: "Costa Rica", CU: "Cuba", CV: "Cape Verde",
  CW: "Curaçao", CX: "Christmas Island", CY: "Cyprus", CZ: "Czech Republic", DJ: "Djibouti",
  DK: "Denmark", DM: "Dominica", DO: "Dominican Republic", DZ: "Algeria", EC: "Ecuador",
  EE: "Estonia", EH: "Western Sahara", ER: "Eritrea", ET: "Ethiopia", FI: "Finland", FJ: "Fiji",
  FK: "Falkland Islands", FM: "Federated States of Micronesia", FO: "Faroe Islands",
  GA: "Gabon", GD: "Grenada", GE: "Georgia", GF: "French Guiana", GG: "Guernsey", GH: "Ghana",
  GI: "Gibraltar", GL: "Greenland", GM: "The Gambia", GN: "Guinea", GP: "Guadeloupe",
  GQ: "Equatorial Guinea", GS: "South Georgia and the South Sandwich Islands", GT: "Guatemala",
  GU: "Guam", GW: "Guinea-Bissau", GY: "Guyana", HK: "Hong Kong", HN: "Honduras", HR: "Croatia",
  HT: "Haiti", HU: "Hungary", IE: "Ireland", IL: "Israel", IM: "Isle of Man",
  IO: "British Indian Ocean Territory", IQ: "Iraq", IR: "Iran", IS: "Iceland", JE: "Jersey",
  JM: "Jamaica", JO: "Jordan", KE: "Kenya", KG: "Kyrgyzstan", KH: "Cambodia", KI: "Kiribati",
  KM: "Comoros", KN: "Saint Kitts and Nevis", KP: "North Korea", KW: "Kuwait",
  KY: "Cayman Islands", KZ: "Kazakhstan", LA: "Laos", LB: "Lebanon", LC: "Saint Lucia",
  LI: "Liechtenstein", LK: "Sri Lanka", LR: "Liberia", LS: "Lesotho", LT: "Lithuania",
  LU: "Luxembourg", LV: "Latvia", LY: "Libya", MC: "Monaco", MD: "Moldova", ME: "Montenegro",
  MF: "Saint-Martin", MG: "Madagascar", MH: "Marshall Islands", MK: "North Macedonia",
  ML: "Mali", MM: "Myanmar", MN: "Mongolia", MO: "Macau", MP: "Northern Mariana Islands",
  MQ: "Martinique", MR: "Mauritania", MS: "Montserrat", MT: "Malta", MU: "Mauritius",
  MV: "Maldives", MW: "Malawi", MY: "Malaysia", MZ: "Mozambique", NA: "Namibia",
  NC: "New Caledonia", NE: "Niger", NF: "Norfolk Island", NG: "Nigeria", NI: "Nicaragua",
  NL: "Kingdom of the Netherlands", NO: "Norway", NP: "Nepal", NR: "Nauru", NU: "Niue",
  OM: "Oman", PA: "Panama", PE: "Peru", PF: "French Polynesia", PG: "Papua New Guinea",
  PH: "Philippines", PK: "Pakistan", PL: "Poland", PM: "Saint Pierre and Miquelon",
  PN: "Pitcairn Islands", PR: "Puerto Rico", PS: "Palestine", PW: "Palau", PY: "Paraguay",
  QA: "Qatar", RE: "Réunion", RO: "Romania", RS: "Serbia", RU: "Russia", RW: "Rwanda",
  SA: "Saudi Arabia", SB: "Solomon Islands", SC: "Seychelles", SD: "Sudan", SE: "Sweden",
  SH: "Saint Helena, Ascension and Tristan da Cunha", SI: "Slovenia",
  SJ: "Svalbard and Jan Mayen", SK: "Slovakia", SL: "Sierra Leone", SM: "San Marino",
  SN: "Senegal", SO: "Somalia", SR: "Suriname", SS: "South Sudan", ST: "São Tomé and Príncipe",
  SV: "El Salvador", SX: "Sint Maarten", SY: "Syria", SZ: "Eswatini",
  TC: "Turks and Caicos Islands", TD: "Chad", TF: "French Southern and Antarctic Lands",
  TG: "Togo", TJ: "Tajikistan", TK: "Tokelau", TL: "Timor-Leste", TM: "Turkmenistan",
  TN: "Tunisia", TO: "Tonga", TT: "Trinidad and Tobago", TV: "Tuvalu", TW: "Taiwan",
  TZ: "Tanzania", UA: "Ukraine", UG: "Uganda", UY: "Uruguay", UZ: "Uzbekistan",
  VA: "Vatican City", VC: "Saint Vincent and the Grenadines", VE: "Venezuela",
  VG: "British Virgin Islands", VI: "United States Virgin Islands", VU: "Vanuatu",
  WF: "Wallis and Futuna", WS: "Samoa", XK: "Kosovo", YE: "Yemen", YT: "Mayotte", ZM: "Zambia",
  ZW: "Zimbabwe",
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
 * ever walked the list, and the list had 33 of the 58 negative-latitude
 * countries — 34 entries, of which KE is the straddler below rather than one of
 * the 58 — so Ecuador, Gabon, Mauritius, the Falklands, the Comoros and 20
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
 *   ST (+0.32) is the same call on the other side of the line, and it is named
 *   for the same reason: it is closer to the equator than Congo or Gabon, it is
 *   NOT listed here, and that is a decision rather than an oversight. The
 *   cross-check now scans both signs, so it is a country somebody looked at.
 *
 * THREE CODES ARE LISTED THAT THE ARTIFACT DOES NOT COVER: AQ, BV and HM. They
 * are Antarctica, Bouvet Island and Heard & McDonald Islands — uninhabited, so
 * the sovereign-state ingest has no record for them and every code above got
 * its sign from a centroid these three have none of. Left off, `getCountry`
 * fell through to its default and reported Antarctica's January as WINTER. That
 * is not a close call the way a country at -0.5 is: AQ's every square metre is
 * south of 60°S, BV sits at -54.4 and HM at -53.1, and the app draws all three
 * on the world map. They are the sole entries of `OUTSIDE_THE_ARTIFACT` in the
 * cross-check, which fails the day any of them gains a record — at which point
 * the sign rule covers them and the exception is deleted.
 */
const SOUTHERN = new Set([
  "AO", "AQ", "AR", "AS", "AU", "BI", "BO", "BR", "BV", "BW", "CC", "CD",
  "CG", "CK", "CL", "CX", "EC", "FJ", "FK", "GA", "GS", "HM", "ID", "IO",
  "KE", "KM", "LS", "MG", "MU", "MW", "MZ", "NA", "NC", "NF", "NR", "NU",
  "NZ", "PE", "PF", "PG", "PN", "PY", "RE", "RW", "SB", "SC", "SH", "SZ",
  "TF", "TK", "TL", "TO", "TV", "TZ", "UY", "VU", "WF", "WS", "YT", "ZA",
  "ZM", "ZW",
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
 * The hand-tuned name for a code, or `null` when `CURATED` has none.
 *
 * A DIFFERENT QUESTION from `getCountry(code).name`, and still one that
 * function cannot answer. It now names all 246 countries rather than 24, so it
 * no longer confuses a name it found with a code it fell back on — but a
 * `null` here means specifically "no human wrote this one down", which is what
 * `getCountryName` in lib/countryFacts.ts branches on to decide whether the
 * artifact may speak. `CN` proves the two are not the same question: this
 * returns "China" and the artifact says "People's Republic of China".
 *
 * This module reads no artifact to answer either question — see
 * `INGESTED_NAMES` above for why the ingested half is a checked-in literal
 * reconciled by a test rather than a lookup, and what the 70 KB alternative
 * would have cost every page that only wanted a hue.
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
 *
 * `name` resolves hand-tuned, then ingested, then the bare code — the same
 * order `getCountryName` in lib/countryFacts.ts applies, so the two can never
 * call one country two things. The bare code is now reached only by a code that
 * is not a country at all (`"ZZ"`), rather than by 222 of the 246 that are;
 * `getCountry("GA").name` was `"GA"` and is `"Gabon"`.
 */
export function getCountry(code: string): Country {
  const normalised = typeof code === "string" ? code.trim().toUpperCase() : "";
  const known = isCountryCode(normalised) ? normalised : "";
  const curated = known ? CURATED[known] : undefined;

  return {
    code: known,
    name: curated?.name ?? INGESTED_NAMES[known] ?? known,
    localName: curated?.localName ?? null,
    hemisphere: SOUTHERN.has(known) ? "south" : "north",
    ...(curated?.accentHue !== undefined ? { accentHue: curated.accentHue } : {}),
    ...(curated?.image !== undefined ? { image: curated.image } : {}),
    ...(curated?.mark !== undefined ? { mark: curated.mark } : {}),
  };
}
