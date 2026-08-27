import { describe, expect, test } from "vitest";
import { buildBriefing, type Briefing } from "./briefing";
import { chinaLeaks, CHINA_TOKENS, peruMisses, PERU_TOKENS } from "./chinaLeakScan";
import {
  CN_BOOKING_COPY,
  CN_DEPARTURE_AFTERNOON,
  CN_DEPARTURE_EVENING,
  CN_GENERAL_TIPS,
  CN_HOP_NOTE,
  CN_HOP_TITLE,
  CN_KIDS_TIP,
  CN_PACKING,
  CN_WINTER_CLOTHING_NOTE,
} from "./countryData/cn";
import { getCountryProfile } from "./countryProfile";
import type { TripInput } from "./itinerary";
import { KIND_EMOJI } from "./meta";
import { HOLIDAY_BANDS } from "./months";
import { suggestRoute, type RoutePlace, type RouteSuggestion } from "./route";
import { airportsForCountry } from "./server/airports";
import { resolveDestinations } from "./server/catalog";
import { buildTripData } from "./server/planService";
import { resolveTripSeason } from "./tripSeason";
import type { TripData, TripPayload } from "./tripShared";

/**
 * T30 — the Peru acceptance gate, node half.
 *
 * The phase's original acceptance criterion, verbatim: *"A user picks Peru on
 * the globe, sees Peruvian cities, taps one, and it appears in their plan with
 * day counts and a route leg."* Every layer under that sentence has its own
 * suite. What has never been tested is the whole flow in one go, which is what
 * this file does: one Peru trip assembled through the same functions
 * `/api/trips` runs, serialised, and scanned in both directions.
 *
 * **Three assertions, and each closes a hole the other two leave open.**
 *
 * 1. **Negative** — nothing Chinese reached a Peru plan. This is what the whole
 *    phase was for.
 * 2. **Positive** — the plan is not merely *empty*. Deleting every generator's
 *    output would pass the negative half; the positive half is what stops that.
 *    A one-directional scan is this repo's single most common hollow-test shape.
 * 3. **Arming** — the identical scan, over a real *China* plan built by the same
 *    functions, reports leaks. A token list with a typo in it, a regex that
 *    never compiles, a scan handed an empty string: each matches nothing and
 *    passes forever. Nothing but the arming proof can tell those apart from a
 *    genuinely clean Peru plan.
 *
 * **Every input is real.** City ids and coordinates come from the committed
 * `public/cities/PE.json` and resolve through `data/cities-index.json`; the
 * airports are the rows `data/airports.json` ships; the facts behind every
 * Peruvian sentence are `data/country-facts.json`'s `PE` record. Nothing here
 * is a fixture, because "a Peru plan says nothing Chinese" measured against an
 * invented Peru would be worth nothing.
 *
 * **Everything expensive is built once, at module scope.** Resolving a GeoNames
 * city parses a 58,742-row index and the airport artifact is 877 KB; done
 * inside a `test`, that work is charged to that test's wall-clock budget and
 * makes it flake under parallel load (see commit 84cd61e). Collection carries
 * no per-test timeout, so each `test` below is a string scan and nothing else.
 */

/**
 * Lima, Cusco, Arequipa — GeoNames ids straight out of `public/cities/PE.json`.
 *
 * `G3941584` Cusco is at -13.53188, -71.96701 in that shard, and the same id
 * resolves through `data/cities-index.json` server-side, which is the path a
 * real trip takes: the wizard sends ids, `resolveDestinations` turns them into
 * `Destination`s. Three cities rather than one so the plan contains hops, which
 * is where `hopTitle` and `hopNote` — China's most quotable leak — would land.
 */
const PERU_CITY_IDS = ["G3936456", "G3941584", "G3947322"];

/** Beijing, Xi'an, Shanghai — curated ids, the richest China data there is. */
const CHINA_CITY_IDS = ["beijing", "xian", "shanghai"];

/**
 * June, and the season the *server* derives from it — not the one a client
 * would send.
 *
 * `lib/months.ts` is a hardcoded northern table, so a browser computes "summer"
 * for June. `resolveTripSeason` discards that in favour of the country profile,
 * which knows Peru is southern. Asserting the resolved value below rather than
 * writing `"winter"` into the input is the point: if the hemisphere fix ever
 * regresses, this trip silently becomes a summer trip and the packing list
 * stops being the one T30 asked for.
 */
const JUNE = 6;

function tripFor(country: string, ids: string[], season: ReturnType<typeof resolveTripSeason>) {
  const input: TripInput = {
    destinationIds: ids,
    days: 10,
    season,
    adults: 2,
    // Load-bearing: this is what pulls in the "Travelling with Kids" packing
    // group and the country's `kidsTip`, and China's kidsTip is a claim about
    // Chinese metro stations.
    kids: 1,
    interests: ["history", "food", "nature"],
    country,
  };
  return input;
}

interface Assembled {
  input: TripInput;
  data: TripData;
  route: RouteSuggestion;
  gapNote: string[];
  briefing: Briefing;
  /** Everything a traveller is shown, as one string. What the scans read. */
  text: string;
}

/**
 * One country's whole trip, assembled through the production path.
 *
 * `buildTripData` is what `/api/trips` calls — it resolves the destinations,
 * runs `buildItinerary` and `buildPackingList` and returns the snapshot that is
 * persisted. `suggestRoute` is what the wizard's map runs, handed the same
 * country's transport profile and the same country's airports. `buildBriefing`
 * is what the unauthenticated `/b/[code]` page calls, in its redacted form.
 *
 * The gap note is resolved from the profile rather than read off the plan,
 * because that is where it lives: it is a claim about our current coverage, so
 * it is recomputed at render on all three surfaces and never snapshotted.
 */
function assemble(country: string, ids: string[]): Assembled {
  const season = resolveTripSeason("summer", JUNE, country);
  const input = tripFor(country, ids, season);
  const destinations = resolveDestinations(ids);
  const data = buildTripData({
    tripName: `${destinations[0]?.name ?? country} trip`,
    startDate: "2026-06-05",
    input,
  });
  const profile = getCountryProfile(country);
  const places: RoutePlace[] = destinations.map((d) => ({
    id: d.id,
    name: d.name,
    lat: d.lat,
    lon: d.lon,
  }));
  const route = suggestRoute(places, airportsForCountry(country), profile.transport);
  const payload: TripPayload = {
    id: "trip-t30",
    version: 1,
    updatedAt: 0,
    data,
    members: [{ name: "Ada", joinedAt: 1 }],
    checks: [],
    tickets: [],
    expenses: [],
    settlements: [],
    journal: [],
    currencySettings: { home: "SGD", rates: {} },
    features: { photoUploads: false },
    joinCode: "SECRET",
  };
  // Redacted: the public, unauthenticated view is the one `plan.tips` reaches
  // without a login, so it is the one worth scanning.
  const briefing = buildBriefing(payload, { redacted: true, includeBookings: false });

  const text = JSON.stringify({
    plan: data.plan,
    packing: data.packing,
    foods: data.foods,
    destinationNames: data.destinationNames,
    routeLegs: route.legs,
    routeNotes: route.notes,
    gapNote: profile.gapNote,
    currency: profile.currency,
    briefing,
  });

  return { input, data, route, gapNote: profile.gapNote, briefing, text };
}

const peru = assemble("PE", PERU_CITY_IDS);
const china = assemble("CN", CHINA_CITY_IDS);

/**
 * Every China string this repo can actually emit, read from the modules that
 * define them rather than retyped.
 *
 * This is what makes the token list falsifiable. The self-test below proves
 * only that the scanner finds its OWN spelling; the China-plan arming proof
 * exercises the twelve tokens that reach a scanned surface. That leaves
 * `Chinese`, `🧧`, `🇨🇳` and `🚄` — which live in `lib/months.ts` and
 * `lib/meta.ts`, not `cn.ts`, and are rendered on the month picker and the
 * itinerary rows — armed by nothing. Corrupt `🧧` to `🧨` in place and every
 * other assertion in this file stays green while the scanner is permanently
 * blind to the real string.
 *
 * Reading the values means a typo on EITHER side reddens: a mangled token no
 * longer matches production, and a reworded production string no longer
 * matches its token. Both are things somebody should look at.
 */
const PRODUCTION_CHINA_COPY = [
  ...CN_GENERAL_TIPS,
  ...CN_PACKING.flatMap((group) => [group.title, ...group.items]),
  ...CN_BOOKING_COPY,
  CN_HOP_TITLE,
  CN_HOP_NOTE,
  CN_DEPARTURE_EVENING,
  CN_DEPARTURE_AFTERNOON,
  CN_KIDS_TIP,
  CN_WINTER_CLOTHING_NOTE,
  ...HOLIDAY_BANDS.flatMap((band) => [band.name, band.emoji, band.note]),
  KIND_EMOJI.travel,
]
  .filter((line): line is string => typeof line === "string")
  .join("\n");

describe("T30 — the scan itself", () => {
  test("every token is spelled the way production spells it", () => {
    // Arming for the arming: a corpus that failed to assemble would make the
    // filter below trivially empty and this test a decoration.
    expect(PRODUCTION_CHINA_COPY.length).toBeGreaterThan(1000);
    expect(PRODUCTION_CHINA_COPY).toContain("Alipay");

    const unspoken = CHINA_TOKENS.filter(
      (token) => !PRODUCTION_CHINA_COPY.toLowerCase().includes(token.toLowerCase())
    );
    expect(unspoken).toEqual([]);
    expect(CHINA_TOKENS).toHaveLength(16);

    // Named individually for the four the China-plan arming proof cannot
    // reach, because they are emitted by modules no scanned surface renders.
    expect(HOLIDAY_BANDS[0].name).toContain("Chinese");
    expect(HOLIDAY_BANDS.map((b) => b.emoji)).toContain("🧧");
    expect(HOLIDAY_BANDS.map((b) => b.emoji)).toContain("🇨🇳");
    expect(KIND_EMOJI.travel).toBe("🚄");
  });

  test("finds every token it claims to look for, in either casing", () => {
    // Without this, a typo in one entry of CHINA_TOKENS is indistinguishable
    // from a clean plan for the rest of this file's lifetime.
    for (const token of CHINA_TOKENS) {
      expect(chinaLeaks(`a plan mentioning ${token} somewhere`)).toContain(token);
    }
    expect(CHINA_TOKENS).toHaveLength(16);
    // The casing claim, on the string most likely to actually leak: CN's hop
    // title is "High-speed rail or flight to {city}".
    expect(chinaLeaks("High-speed rail or flight to Cusco")).toContain("high-speed rail");
  });

  test("finds a CJK codepoint, and reports it rather than a boolean", () => {
    expect(chinaLeaks("启程")).toEqual(["启", "程"]);
    expect(chinaLeaks("同行 over a Japan trip")).toEqual(["同", "行"]);
    // The global matcher is rebuilt per call — a leaked lastIndex would make
    // this second scan of the same string disagree with the first.
    expect(chinaLeaks("启程")).toEqual(chinaLeaks("启程"));
  });

  test("both ends of the CJK range are armed, not just the readable one", () => {
    // The floor is self-evident — `一` IS U+4E00, so the tests above pin it.
    // The ceiling is not: `鿿` (U+9FFF) renders as nothing meaningful, so a
    // mojibake that lowered it would go unnoticed while blinding the scan to
    // everything above the new bound. The highest codepoint any other
    // assertion in this repo forces is `起` (U+8D77).
    expect(chinaLeaks("一")).toEqual(["一"]); // U+4E00, the floor
    expect(chinaLeaks("鿿")).toEqual(["鿿"]); // U+9FFF, the ceiling itself
    // Characters between `起` and the ceiling — the band a lowered bound
    // would silently drop, and full of exactly the words this repo writes.
    expect(chinaLeaks("高德")).toEqual(["高德", "高", "德"]); // U+9AD8, U+5FB7
    expect(chinaLeaks("长面馆")).toEqual(["长", "面", "馆"]); // U+957F, U+9762, U+9928
    // And the range is a range, not an allowlist of the characters above.
    expect(chinaLeaks("Cusco, Arequipa — 220 V")).toEqual([]);
  });

  test("says nothing about text that is genuinely clean", () => {
    expect(chinaLeaks("Sockets are type A, B and C at 220 V")).toEqual([]);
    expect(chinaLeaks("")).toEqual([]);
  });

  test("the positive half is armed too: it misses what is absent", () => {
    // `peruMisses` is the half that stops an empty plan passing, so it has to
    // be able to report a miss at all.
    expect(peruMisses("")).toEqual([...PERU_TOKENS]);
    expect(peruMisses("Prices are in PEN.")).not.toContain("PEN");
    expect(PERU_TOKENS).toHaveLength(6);
  });
});

describe("T30 — the Peru trip is the one the gate asks for", () => {
  test("real Peruvian cities, resolved from the committed index", () => {
    // Arming for everything below: a trip whose destinations failed to resolve
    // is an empty plan, and an empty plan leaks nothing.
    expect(peru.data.destinationNames).toEqual(["Lima", "Cusco", "Arequipa"]);
    const cusco = peru.briefing.cities.find((c) => c.id === "G3941584");
    expect(cusco?.name).toBe("Cusco");
  });

  test("the season is the southern one the server derives, not the client's", () => {
    expect(peru.input.season).toBe("winter");
    expect(resolveTripSeason("summer", JUNE, "CN")).toBe("summer");
    // And it reached the packing list, which is where a wrong season shows up.
    expect(peru.data.packing.map((g) => g.title)).toContain("Clothing for winter");
  });

  test("kids > 0 reached both the tips and the packing list", () => {
    expect(peru.input.kids).toBeGreaterThan(0);
    expect(peru.data.plan.tips).toContain(
      "Travelling with kids: pack light and allow buffer time between stops."
    );
    expect(peru.data.packing.map((g) => g.title)).toContain("Travelling with Kids");
  });

  test("day counts and route legs — the acceptance sentence's own two nouns", () => {
    expect(peru.data.plan.days).toHaveLength(10);
    expect(peru.data.plan.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(peru.data.plan.days.map((d) => d.destinationName))).toEqual(
      new Set(["Lima", "Cusco", "Arequipa"])
    );
    expect(peru.route.legs.length).toBeGreaterThanOrEqual(1);
  });

  test("Lima → Cusco is a flight on real airports, and no leg is rail", () => {
    // `railKmh` is null for Peru, so nothing may come back rail — and the pair
    // that resolves is the one Peruvians actually fly.
    const first = peru.route.legs[0];
    expect(first.kind).toBe("estimated");
    if (first.kind !== "estimated") return;
    expect(first.mode).toBe("flight");
    expect(first.airports?.from.iata).toBe("LIM");
    expect(first.airports?.to.iata).toBe("CUZ");
    for (const leg of peru.route.legs) {
      expect(leg.kind === "estimated" ? leg.mode : leg.kind).not.toBe("rail");
    }
  });

  test("the gap note fires, is one line, and is not a tip", () => {
    expect(peru.gapNote).toHaveLength(1);
    expect(peru.gapNote[0]).toContain("Peru-specific guidance");
    // Peru carries all six gap-note fields, so there is no second line.
    expect(peru.gapNote.join(" ")).not.toContain("We also have no");
    // Never snapshotted: the note is about our coverage, not about the trip.
    expect(peru.data.plan.tips).not.toContain(peru.gapNote[0]);
    expect(peru.briefing.gapNote).toEqual(peru.gapNote);
  });

  test("the unauthenticated briefing carries the tips and names no member", () => {
    // `plan.tips` reaches a bearer-link holder through lib/briefing.ts, which
    // is why the tips are scanned on this side of the redaction too.
    expect(peru.briefing.logistics.tips).toEqual(peru.data.plan.tips);
    expect(peru.briefing.redacted).toBe(true);
    expect(peru.briefing.crew).toBeNull();
  });
});

describe("T30 — the negative half", () => {
  test("no China marker anywhere in a Peru plan", () => {
    expect(chinaLeaks(peru.text)).toEqual([]);
  });

  test("and the surfaces individually, so a failure names which one", () => {
    expect(chinaLeaks(JSON.stringify(peru.data.plan))).toEqual([]);
    expect(chinaLeaks(JSON.stringify(peru.data.packing))).toEqual([]);
    expect(chinaLeaks(peru.route.notes.join(" "))).toEqual([]);
    expect(chinaLeaks(peru.data.plan.tips.join(" "))).toEqual([]);
    expect(chinaLeaks(peru.gapNote.join(" "))).toEqual([]);
    expect(chinaLeaks(JSON.stringify(peru.briefing))).toEqual([]);
  });

  /**
   * The one scanned key where "clean" and "empty" are the same thing, said out
   * loud so it is a known limit rather than an accident.
   *
   * `buildTripData` filters `foods` to destinations with dishes, and a GeoNames
   * city carries none — so `peru.data.foods` is `[]` by construction and
   * scanning it can never fail. That is the design's own "these make Peru
   * *thin*, not *wrong*" non-goal, not a defect. The China side is asserted
   * non-empty so the emptiness is a fact about Peru's data rather than about
   * the field being dead everywhere.
   */
  test("the foods surface is empty for Peru by construction, not by accident", () => {
    expect(peru.data.foods).toEqual([]);
    // Live for a country that has dishes, so Peru's emptiness is a fact about
    // Peru's data rather than about the field being dead everywhere. (China's
    // dish names happen to carry no marker of their own — "Peking duck" is not
    // in the token list — so this arms the field, not the scan.)
    expect(china.data.foods.length).toBeGreaterThan(0);
    expect(china.data.foods.flatMap((f) => f.dishes).length).toBeGreaterThan(0);
  });

  /**
   * The known deferred item, pinned rather than left to be rediscovered.
   *
   * `buildPackingList`'s kids group says "Snacks and entertainment for long
   * train rides" (lib/packing.ts). It does NOT trip the scan: "train" is not
   * one of CHINA_TOKENS, and deliberately so — Peru has trains, and PeruRail's
   * Cusco–Machu Picchu service is one of the country's better-known journeys.
   * The line is generic travel advice, not a claim about a Chinese network, so
   * it is out of scope here and tracked with the rest of the branding sweep.
   *
   * What this asserts is that it stays that way: the line may not grow into a
   * country claim without reddening.
   */
  test("the kids packing line is generic, not a country claim", () => {
    const kids = peru.data.packing.find((g) => g.title === "Travelling with Kids");
    expect(kids?.items).toContain("Snacks and entertainment for long train rides");
    expect(chinaLeaks(JSON.stringify(kids))).toEqual([]);
    expect(CHINA_TOKENS as readonly string[]).not.toContain("train");
  });
});

describe("T30 — the positive half", () => {
  test("the Peru plan says all six things it must say", () => {
    // Deleting every generator's output would pass the negative half. This is
    // what stops that — and it reads the SAME string the negative half scans,
    // so the two cannot be measuring different documents.
    expect(peruMisses(peru.text)).toEqual([]);
  });

  test("each token traces to a rendered sentence, not to an id or a coordinate", () => {
    const tips = peru.data.plan.tips.join(" ");
    expect(tips).toContain("Prices are in PEN.");
    expect(tips).toContain("Sockets are type A, B and C at 220 V");
    expect(tips).toContain("Emergency numbers: 105 police, 116 fire, 106 or 117 ambulance.");
    expect(tips).toContain("Aymara, Quechua and Spanish are official languages");
    expect(tips).toContain("The international dialling code is +51.");
    const packing = peru.data.packing.flatMap((g) => g.items);
    expect(packing).toContain("Universal power adapter (Peru uses type A/B/C plugs, 220V)");
    expect(packing).toContain("Some PEN cash as a backup");
  });

  test("a transport mode, and booking copy that names no network", () => {
    expect(peru.route.legs.some((l) => l.kind === "estimated" && l.mode === "flight")).toBe(true);
    expect(peru.route.notes).toContain(
      "Book long-distance transport ahead — fares climb close to the date."
    );
    expect(peru.route.totalKm).toBeGreaterThan(0);
  });

  test("the money pivot is a fact, not a placeholder", () => {
    expect(getCountryProfile("PE").currency).toBe("PEN");
  });
});

describe("T30 — the arming proof", () => {
  test("the identical scan over a China plan reports leaks", () => {
    // THE assertion that makes this file worth running. If CHINA_TOKENS is
    // misspelled, if the CJK regex never compiles, if `assemble` hands back an
    // empty document — every "expect([]).toEqual([])" above still passes, and
    // only this fails.
    const leaks = chinaLeaks(china.text);
    expect(leaks).not.toEqual([]);
    expect(leaks.length).toBeGreaterThanOrEqual(10);
  });

  test("and reports the specific markers, so it is not one lucky substring", () => {
    const leaks = chinaLeaks(china.text);
    for (const token of [
      "China",
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
      "high-speed rail",
    ]) {
      expect(leaks).toContain(token);
    }
    // CJK reached the scan through two independent routes: cn.ts's "Amap 高德"
    // and the briefing's curated `localName` ("北京").
    expect(leaks).toContain("北");
    expect(china.briefing.cities.map((c) => c.localName)).toContain("北京");
  });

  test("the China plan is a real plan, so the leaks are not from an error string", () => {
    expect(china.data.plan.days).toHaveLength(10);
    expect(china.data.destinationNames).toEqual(["Beijing", "Xi'an", "Shanghai"]);
    expect(china.route.legs.length).toBeGreaterThanOrEqual(1);
    expect(china.gapNote).toEqual([]);
    expect(getCountryProfile("CN").currency).toBe("CNY");
  });

  test("the positive half is armed in the same direction", () => {
    // A China plan says none of Peru's six things. If `peruMisses` could not
    // report a miss over a real document, the positive half above would be as
    // hollow as the negative half without this file's arming proof.
    expect(peruMisses(china.text)).toContain("PEN");
    expect(peruMisses(china.text)).toContain("+51");
  });
});
