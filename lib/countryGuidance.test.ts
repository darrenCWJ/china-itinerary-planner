import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { NEUTRAL_PACKING, NEUTRAL_TIPS } from "./countryData/neutral";
import { DESTINATIONS } from "./data";
import { buildItinerary, type ScheduledItem, type TripInput, type TripPlan } from "./itinerary";
import { buildPackingList } from "./packing";
import { geoNamesCityToDestination } from "./server/catalog";
import type { CityIndexEntry } from "./server/cityIndex";
import type { Destination, PackingGroup } from "./types";

/**
 * T21's gate: the generated plan stops being unconditionally Chinese.
 *
 * Two halves, and the second is the one that is usually missing. The negative
 * half proves a Peru trip carries none of China's copy. On its own it would
 * also pass against a generator that emitted nothing at all, so the positive
 * half pins that the same fixture still produces a plan, a packing list and
 * tips — and pins the exact sentences, because three of the four leaks this
 * task closes contain no forbidden token:
 *
 *   "High-speed rail or flight to Cusco"
 *   "Arrive at the station 30–40 minutes early; passport needed to board."
 *   "Lip balm and moisturiser — northern air is very dry"
 *
 * A token scan alone reports all three as clean. That is the hollow half of
 * the task's own prescribed test story, and the explicit copy pins below are
 * the repair.
 *
 * The scan is also run against a China plan and asserted to *fail*, because a
 * scan that silently matches nothing looks exactly like a clean one.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Two real Peruvian cities, with the ids, names and coordinates the committed
 * shard `public/cities/PE.json` carries (GeoNames cities500, generated
 * 2026-08-25). Written out here rather than read from disk so this gate cannot
 * be skipped into silence on a checkout without the committed shards — and
 * cross-checked against that shard whenever it is present, so the values
 * cannot quietly rot away from the real data.
 */
const PE_SHARD_ROWS = [
  { id: "G3936456", n: "Lima", lat: -12.04318, lon: -77.02824, a1: "Lima Province" },
  { id: "G3941584", n: "Cusco", lat: -13.53188, lon: -71.96701, a1: "Cuzco Department" },
] as const;

/** The production path a worldwide city takes into the generators. */
function peruDestinations(): Destination[] {
  return PE_SHARD_ROWS.map((row) => {
    const entry: CityIndexEntry = {
      id: row.id,
      name: row.n,
      country: "PE",
      lat: row.lat,
      lon: row.lon,
      region: row.a1,
    };
    return geoNamesCityToDestination(entry);
  });
}

const PERU_CITIES = peruDestinations();

/** Winter (June–August in Peru), two adults and a child, two cities. */
function peruInput(overrides: Partial<TripInput> = {}): TripInput {
  return {
    destinationIds: PE_SHARD_ROWS.map((r) => r.id),
    days: 6,
    season: "winter",
    adults: 2,
    kids: 1,
    interests: ["food", "history"],
    country: "PE",
    ...overrides,
  };
}

/** The same shape of trip in China: winter, two cities, one child. */
function chinaInput(overrides: Partial<TripInput> = {}): TripInput {
  return {
    destinationIds: ["beijing", "xian"],
    days: 6,
    season: "winter",
    adults: 2,
    kids: 1,
    interests: ["food", "history"],
    country: "CN",
    ...overrides,
  };
}

const CHINA_CITIES = DESTINATIONS.filter((d) => ["beijing", "xian"].includes(d.id));

function itemsOf(plan: TripPlan): ScheduledItem[] {
  return plan.days.flatMap((d) => d.items);
}

function firstOfKind(plan: TripPlan, kind: ScheduledItem["kind"]): ScheduledItem {
  const item = itemsOf(plan).find((i) => i.kind === kind);
  expect(item, `no ${kind} item in the plan`).toBeDefined();
  return item!;
}

function groupTitled(groups: PackingGroup[], title: string): PackingGroup {
  const group = groups.find((g) => g.title === title);
  expect(group, `no packing group titled ${title}`).toBeDefined();
  return group!;
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/**
 * Everything a plan may not say outside China. `¥` and `高德` are here as
 * literals rather than as a CJK sweep because a targeted match names the
 * offender in the failure message; the sweep below catches the rest.
 */
const CHINA_TOKENS = [
  "Alipay",
  "WeChat",
  "VPN",
  "RMB",
  "¥",
  "12306",
  "Trip.com",
  "Amap",
  "Pleco",
  "高德",
  "China",
  "Chinese",
] as const;

/** CJK Unified Ideographs — the `[一-鿿]` block. */
const CJK = /[一-鿿]/u;

function leaks(text: string): string[] {
  const found: string[] = CHINA_TOKENS.filter((token) => text.includes(token));
  if (CJK.test(text)) found.push("<CJK codepoint>");
  return found;
}

/** Everything the generators produce for one trip, as one string. */
function generatedText(input: TripInput, destinations: Destination[]): string {
  return JSON.stringify({
    plan: buildItinerary(input, destinations),
    packing: buildPackingList(input, destinations),
  });
}

// ---------------------------------------------------------------------------
// China: unchanged, byte for byte
// ---------------------------------------------------------------------------

describe("a China trip is unchanged", () => {
  const plan = buildItinerary(chinaInput(), DESTINATIONS);
  const packing = buildPackingList(chinaInput(), CHINA_CITIES);

  test("the full tips array", () => {
    expect(plan.tips).toEqual([
      "Set up Alipay and WeChat Pay with your home bank card before flying — most of China is cashless.",
      "Install and test a VPN before arrival if you need Google, WhatsApp or Instagram.",
      "Book high-speed rail seats on Trip.com or the official 12306 app up to 15 days ahead.",
      "Carry your passport everywhere — it's required for hotels, train travel and many attractions.",
      "Download offline maps (Amap 高德 works best in China) and a translation app with offline packs.",
      "Beijing in winter: Cold and dry (around -5°C) but uncrowded — a snowy Great Wall is magical.",
      "Xi'an in winter: Cold but atmospheric; far fewer crowds at the Terracotta Army.",
      "Travelling with kids: metro stations often lack lifts at every exit — pack light and allow buffer time.",
    ]);
  });

  test("every packing group, in order, item for item", () => {
    expect(packing).toEqual([
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
      {
        title: "Clothing for winter",
        emoji: "🧥",
        items: [
          "Thermal base layers",
          "Insulated coat, gloves, scarf and beanie",
          "Warm waterproof shoes",
          // Still last in the group, and still after the generic cold-weather
          // items — the order the profile seam had to preserve.
          "Lip balm and moisturiser — northern air is very dry",
        ],
      },
      {
        title: "Travelling with Kids",
        emoji: "🧸",
        items: [
          "Snacks and entertainment for long train rides",
          "Stroller or carrier — expect stairs at older attractions",
          "Copies of kids' passports kept separately",
          "Wet wipes (endlessly useful)",
        ],
      },
    ]);
  });

  test("the hop and departure copy", () => {
    const hop = firstOfKind(plan, "travel");
    expect(hop.title).toBe("High-speed rail or flight to Xi'an");
    expect(hop.note).toBe("Arrive at the station 30–40 minutes early; passport needed to board.");
    expect(firstOfKind(plan, "departure").title).toBe(
      "Head to the airport or station — safe travels home!"
    );
  });

  test("the evening departure, on a trip whose last morning is transit", () => {
    const short = buildItinerary(chinaInput({ days: 3 }), DESTINATIONS);
    expect(firstOfKind(short, "departure").title).toBe(
      "Evening train or flight out — safe travels home!"
    );
  });

  test("a trip with no country named is still a China trip", () => {
    // DEFAULT_COUNTRY, not a second "CN" literal — and the reason
    // `planService.ts` and `PlanStep.tsx` needed no change: TripInput.country
    // is optional, and every trip written before it existed is Chinese.
    const { country: _country, ...noCountry } = chinaInput();
    expect(buildItinerary(noCountry, DESTINATIONS).tips).toEqual(plan.tips);
    expect(buildPackingList(noCountry, CHINA_CITIES)).toEqual(packing);
  });
});

// ---------------------------------------------------------------------------
// Peru: the negative half
// ---------------------------------------------------------------------------

describe("a Peru trip carries none of China's copy", () => {
  const text = generatedText(peruInput(), PERU_CITIES);

  test("no forbidden token and no CJK codepoint anywhere in the output", () => {
    expect(leaks(text)).toEqual([]);
  });

  test("the scan is armed: the identical scan on a China plan fails", () => {
    // Without this, a scan whose serialisation silently produced "" would look
    // exactly like a clean one.
    const chinaLeaks = leaks(generatedText(chinaInput(), DESTINATIONS));
    expect(chinaLeaks).toContain("Alipay");
    expect(chinaLeaks).toContain("12306");
    expect(chinaLeaks).toContain("<CJK codepoint>");
    expect(chinaLeaks.length).toBeGreaterThanOrEqual(8);
  });

  test("the scanned text is a real plan, not an empty string", () => {
    expect(text.length).toBeGreaterThan(1000);
    expect(text).toContain("Lima");
    expect(text).toContain("Cusco");
  });

  test("every token in the list is one the scan can actually find", () => {
    // A typo in the list would remove a token from the gate silently.
    for (const token of CHINA_TOKENS) {
      expect(leaks(`prefix ${token} suffix`)).toContain(token);
    }
    expect(CHINA_TOKENS).toHaveLength(12);
    expect(leaks("一")).toEqual(["<CJK codepoint>"]);
    expect(leaks("鿿")).toEqual(["<CJK codepoint>"]);
    expect(leaks("Travel to Cusco")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Peru: the positive half
// ---------------------------------------------------------------------------

describe("a Peru trip still produces a plan", () => {
  const plan = buildItinerary(peruInput(), PERU_CITIES);
  const packing = buildPackingList(peruInput(), PERU_CITIES);

  test("at least one day, one packing group and one tip", () => {
    // A leak "fixed" by emitting nothing passes the scan above and fails here.
    expect(plan.days.length).toBeGreaterThanOrEqual(1);
    expect(packing.length).toBeGreaterThanOrEqual(1);
    expect(plan.tips.length).toBeGreaterThanOrEqual(1);
    expect(plan.days).toHaveLength(6);
    expect(plan.days.every((d) => d.items.length > 0)).toBe(true);
  });

  test("the tips are the neutral set, Peru's own facts, then the neutral kids tip", () => {
    // T27 added the middle five. They come from the CC0 Wikidata artifact via
    // lib/countryTips.ts, and every one is a statement about Peru rather than
    // about China — which is what this gate was always asking for and could
    // not have until the facts existed.
    expect(plan.tips).toEqual([
      "Check your passport validity and entry requirements well before you book.",
      "Tell your bank you are travelling so your cards keep working.",
      "Download offline maps and a translation pack before you leave.",
      "Prices are in PEN. Set your home currency on the Money tab for live conversions.",
      "Sockets are type A, B and C at 220 V — bring a universal adapter.",
      "Emergency numbers: 105 police, 116 fire, 106 or 117 ambulance.",
      "Aymara, Quechua and Spanish are official languages — download an offline translation pack before you go.",
      "Traffic drives on the right. The international dialling code is +51.",
      "Travelling with kids: pack light and allow buffer time between stops.",
    ]);
    expect(plan.tips.slice(0, NEUTRAL_TIPS.length)).toEqual([...NEUTRAL_TIPS]);
  });

  test("the country packing groups are the neutral document with Peru's facts spliced in", () => {
    // Was `toEqual(NEUTRAL_PACKING)`. T27 splices two fact lines in: the
    // plug-and-voltage adapter REPLACES the generic one, as China's
    // hand-written document does, and the currency cash line follows the
    // payment-card item. No third line — Peru has three official languages, so
    // no single-language translation pack is claimed.
    expect(packing.slice(0, NEUTRAL_PACKING.length)).toEqual([
      {
        title: "Documents & Money",
        emoji: "\u{1F6C2}",
        items: [
          "Passport with at least six months' validity, plus any visa you need",
          "A payment card that works abroad, and a small amount of local cash",
          "Some PEN cash as a backup",
          "Travel insurance policy details",
          "Copies of your bookings, stored offline",
        ],
      },
      {
        title: "Tech",
        emoji: "\u{1F50C}",
        items: [
          "Universal power adapter (Peru uses type A/B/C plugs, 220V)",
          "Phone and power bank",
          "Offline maps and a translation app downloaded before you fly",
        ],
      },
      {
        title: "Health & Comfort",
        emoji: "\u{1F48A}",
        items: [
          "Prescription medicines in their original packaging",
          "Basic meds: stomach relief, painkillers, motion sickness",
          "Reusable water bottle",
          "Comfortable broken-in walking shoes",
        ],
      },
    ]);
    // Still the neutral document underneath: same groups in the same order,
    // and every neutral item still present bar the generic adapter the
    // specific one replaced.
    expect(packing.slice(0, NEUTRAL_PACKING.length).map((g) => g.title)).toEqual(
      NEUTRAL_PACKING.map((g) => g.title)
    );
    expect(NEUTRAL_PACKING).toHaveLength(3);
  });

  test("the hop names no network, and carries no note it cannot support", () => {
    // The leak a token scan cannot see: "High-speed rail or flight to Cusco"
    // contains no forbidden token and no CJK.
    const hop = firstOfKind(plan, "travel");
    expect(hop.title).toBe("Travel to Cusco");
    expect(hop.note).toBeUndefined();
    expect("note" in hop).toBe(false);
  });

  test("the departure copy names no station", () => {
    expect(firstOfKind(plan, "departure").title).toBe("Time to head home — safe travels!");
    const short = buildItinerary(peruInput({ days: 3 }), PERU_CITIES);
    expect(firstOfKind(short, "departure").title).toBe(
      "Evening departure — safe travels home!"
    );
  });

  test("winter clothing carries no claim about northern air", () => {
    // The other leak a token scan cannot see. Peru's winter is real — the
    // group must still be there — but "northern air is very dry" is a claim
    // about northern China and wrong on Lima's coastal fog.
    const clothing = groupTitled(packing, "Clothing for winter");
    expect(clothing.items).toEqual([
      "Thermal base layers",
      "Insulated coat, gloves, scarf and beanie",
      "Warm waterproof shoes",
    ]);
    expect(clothing.items.join(" ")).not.toContain("northern air is very dry");
  });

  test("the kids group is still added", () => {
    expect(groupTitled(packing, "Travelling with Kids").items.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The fixture is real data
// ---------------------------------------------------------------------------

const PE_SHARD = join(process.cwd(), "public", "cities", "PE.json");

/**
 * The committed shards are build artefacts, not source — a checkout without
 * them skips this cross-check, exactly as lib/cityShard.test.ts does. Nothing
 * above depends on it: the gate itself runs on the inline rows either way.
 */
describe.skipIf(!existsSync(PE_SHARD))("the Peru fixture is the committed shard's own data", () => {
  const shard = existsSync(PE_SHARD)
    ? (JSON.parse(readFileSync(PE_SHARD, "utf8")) as {
        country: string;
        cities: { id: string; n: string; lat: number; lon: number; a1: string | null }[];
      })
    : null;

  test("every fixture row matches the shard row of the same id, field for field", () => {
    expect(shard!.country).toBe("PE");
    let checked = 0;
    for (const row of PE_SHARD_ROWS) {
      const real = shard!.cities.find((c) => c.id === row.id);
      expect(real, `${row.n} (${row.id}) is not in the committed PE shard`).toBeDefined();
      expect({ id: real!.id, n: real!.n, lat: real!.lat, lon: real!.lon, a1: real!.a1 }).toEqual({
        id: row.id,
        n: row.n,
        lat: row.lat,
        lon: row.lon,
        a1: row.a1,
      });
      checked += 1;
    }
    // The loop's own iteration count, so a shard that parsed to zero cities
    // cannot make this pass by matching nothing.
    expect(checked).toBe(PE_SHARD_ROWS.length);
    expect(checked).toBe(2);
  });

  test("the destinations the generators were handed carry those coordinates", () => {
    expect(PERU_CITIES.map((d) => [d.name, d.country, d.lat, d.lon])).toEqual([
      ["Lima", "PE", -12.04318, -77.02824],
      ["Cusco", "PE", -13.53188, -71.96701],
    ]);
  });
});
