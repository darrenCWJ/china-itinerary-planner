import { describe, expect, test } from "vitest";
import { ISO_NUMERIC_TO_ALPHA2 } from "./countries";
import {
  NEUTRAL_ADAPTER_ITEM,
  NEUTRAL_PACKING,
  NEUTRAL_TIPS,
} from "./countryData/neutral";
import { COUNTRY_FACTS } from "./countryFacts";
import { getCountryProfile, isCurrencyResearched } from "./countryProfile";
import { GENERAL_TIPS } from "./itinerary";
import { HOLIDAY_BANDS, NATIONAL_CROWD, REGION_MONTHS } from "./months";
import { TRANSPORT } from "./route";

describe("China profile", () => {
  const cn = getCountryProfile("CN");

  test("seasons follow the northern calendar", () => {
    expect(cn.seasonOfMonth(1)).toBe("winter");
    expect(cn.seasonOfMonth(4)).toBe("spring");
    expect(cn.seasonOfMonth(7)).toBe("summer");
    expect(cn.seasonOfMonth(10)).toBe("autumn");
  });

  test("carries the curated China data the generator already uses", () => {
    expect(cn.crowdByMonth).toEqual(NATIONAL_CROWD);
    expect(cn.holidays).toEqual(HOLIDAY_BANDS);
    expect(cn.tips).toEqual([...GENERAL_TIPS]);
    expect(cn.transport.railKmh).toBe(230);
    expect(cn.transport.flightThresholdKm).toBe(1200);
    expect(cn.transport.groundTransferKmh).toBe(TRANSPORT.groundTransferKmh);
    expect(cn.transport.airportSearchRadiusKm).toBe(TRANSPORT.airportSearchRadiusKm);
    expect(cn.currency).toBe("CNY");
    expect(cn.packing.length).toBeGreaterThan(0);
  });

  test("climate rows come from the region table", () => {
    const east = cn.climateFor("East");
    expect(east).toHaveLength(12);
    expect(east).toEqual(REGION_MONTHS.East);
  });

  test("an unknown region degrades to null instead of throwing", () => {
    expect(() => cn.climateFor("Bavaria")).not.toThrow();
    expect(cn.climateFor("Bavaria")).toBeNull();
  });

  test("inherited object keys are not mistaken for climate rows", () => {
    expect(cn.climateFor("constructor")).toBeNull();
    expect(cn.climateFor("toString")).toBeNull();
  });

  test("callers cannot mutate the shared curated data through the profile", () => {
    const crowd = cn.crowdByMonth;
    // Narrowing, and an assertion in its own right: China's curve is the one
    // that must never be null, so a `?? []` here would hide the regression
    // this test is holding down.
    expect(crowd).not.toBeNull();
    if (crowd === null) return;
    crowd[0] = 99;
    cn.tips.push("mutated");
    expect(getCountryProfile("CN").crowdByMonth).toEqual(NATIONAL_CROWD);
    expect(getCountryProfile("CN").tips).toEqual([...GENERAL_TIPS]);
  });
});

describe("hemisphere", () => {
  test("a southern country inverts the seasons", () => {
    const au = getCountryProfile("AU");
    expect(au.seasonOfMonth(1)).toBe("summer");
    expect(au.seasonOfMonth(4)).toBe("autumn");
    expect(au.seasonOfMonth(7)).toBe("winter");
    expect(au.seasonOfMonth(10)).toBe("spring");
  });

  test("every southern month is the northern season six months away", () => {
    const north = getCountryProfile("CN");
    for (const south of [getCountryProfile("AU"), getCountryProfile("PE"), getCountryProfile("NZ")]) {
      for (let month = 1; month <= 12; month++) {
        expect(south.seasonOfMonth(month)).toBe(north.seasonOfMonth(((month + 5) % 12) + 1));
      }
    }
  });
});

describe("neutral profile", () => {
  const xx = getCountryProfile("XX");

  test("crowd pressure is absent rather than invented", () => {
    // Was `toHaveLength(12)` over a flat `[3,3,3,…]`. A flat curve is not the
    // absence of a claim: rendered under the label its consumers carry —
    // *typical national crowd pressure this month* — it says every month is
    // equally busy, which nobody researched. `null` is the honest state, and
    // components/map/MonthTimeline.test.tsx pins that it renders as no element
    // at all rather than as a row of three-of-five dots.
    expect(xx.crowdByMonth).toBeNull();
  });

  test("no holidays and no climate rows", () => {
    expect(xx.holidays).toEqual([]);
    expect(xx.climateFor("East")).toBeNull();
    expect(xx.climateFor("anything")).toBeNull();
  });

  test("packing and tips are the neutral document itself, not a variant of it", () => {
    // The single-country version of the sweep at the bottom of this file. It
    // stays because it pins something the sweep cannot: that the branch a code
    // with no facts lands on emits the neutral document unchanged, which is
    // the baseline the facts branch is measured against.
    expect(xx.tips).toEqual([...NEUTRAL_TIPS]);
    expect(xx.packing).toEqual(NEUTRAL_PACKING);
    expect(xx.packing).not.toBe(NEUTRAL_PACKING);
    expect(xx.packing.length).toBeGreaterThan(0);
    expect(xx.tips.length).toBeGreaterThan(0);
  });

  test("each packing GROUP gets a fresh items array, not a shared reference", () => {
    // `not.toBe(NEUTRAL_PACKING)` compares the outer array only, so
    // `copyPacking`'s `items: [...group.items]` could become `items:
    // group.items` with every assertion above still green — and the mutation
    // test at the top of this file edits `crowdByMonth` and `tips` but never a
    // group's items. That inner copy is the contract `lib/countryFacts.ts`
    // cites as the reason `getCountryFacts` is not memoised: a caller may edit
    // what it is handed. Pinned by writing through the handle and re-reading.
    const first = getCountryProfile("XX");
    expect(first.packing[0].items).not.toBe(NEUTRAL_PACKING[0].items);
    first.packing[0].items.push("mutated");
    expect(getCountryProfile("XX").packing[0].items).not.toContain("mutated");
    expect(NEUTRAL_PACKING[0].items).not.toContain("mutated");
  });

  test("a code that is not a country gets no gap note, because it cannot name one", () => {
    // `buildGapNote` returns [] for a blank country name, and "XX" has none.
    // A note that cannot say whose data is missing is not actionable.
    expect(xx.gapNote).toEqual([]);
  });

  test("no rail estimate is offered where no rail network is known", () => {
    expect(xx.transport.railKmh).toBeNull();
    expect(xx.transport.flightKmh).toBe(TRANSPORT.flightKmh);
    expect(xx.transport.flightThresholdKm).toBe(TRANSPORT.flightThresholdKm);
  });

  test("ground transfer speed and airport search radius are offered everywhere, not just researched countries", () => {
    expect(xx.transport.groundTransferKmh).toBe(TRANSPORT.groundTransferKmh);
    expect(xx.transport.airportSearchRadiusKm).toBe(TRANSPORT.airportSearchRadiusKm);
  });

  test("currency is absent, not a placeholder pivot", () => {
    // Was `toBe("USD")`. That placeholder was the last guess in this module:
    // it is a real ISO code, so nothing downstream could tell it from a
    // researched answer, and `isCurrencyResearched` existed only to keep it
    // off the money surfaces. Absent is the honest state, and the predicate
    // now reads the absence instead of re-deriving it.
    expect(xx.currency).toBeNull();
    expect(isCurrencyResearched("XX")).toBe(false);
  });

  test("garbage input yields a profile instead of an exception", () => {
    for (const junk of ["", "   ", "CHN", "🙂", "constructor"]) {
      expect(() => getCountryProfile(junk)).not.toThrow();
      // Was `crowdByMonth` — now null for anything unresearched, so it can no
      // longer witness that a whole profile came back. Two fields that are
      // still populated do that instead, or "yields a profile" would be
      // asserted by a check that a field is empty.
      expect(getCountryProfile(junk).crowdByMonth).toBeNull();
      expect(getCountryProfile(junk).tips.length).toBeGreaterThan(0);
      expect(getCountryProfile(junk).packing.length).toBeGreaterThan(0);
    }
  });
});

describe("crowdByMonth is null or twelve long, for every country there is", () => {
  /**
   * The guard TypeScript cannot give and nothing at runtime does.
   *
   * `number[] | null` says nothing about the length, and every consumer indexes
   * it by `month - 1`. A curve of the wrong length is not a type error and does
   * not throw — it renders `undefined` dots, or silently reads a neighbouring
   * month. So the shape is swept over the whole code table rather than sampled.
   */
  const CODES = [...new Set(Object.values(ISO_NUMERIC_TO_ALPHA2))];

  test("the sweep runs over the whole table, not over nothing", () => {
    // The iteration floor. Without it, an empty or renamed table turns the
    // sweep below into a loop over zero countries that passes perfectly.
    expect(CODES.length).toBeGreaterThanOrEqual(240);
    expect(CODES).toContain("CN");
    expect(CODES).toContain("PE");
  });

  test("every profile is either twelve months of crowd or none at all", () => {
    let researched = 0;
    let withheld = 0;
    for (const code of CODES) {
      const curve = getCountryProfile(code).crowdByMonth;
      if (curve === null) {
        withheld += 1;
        continue;
      }
      researched += 1;
      expect(curve, `${code} has a crowd curve of the wrong length`).toHaveLength(12);
      for (const value of curve) {
        expect(Number.isInteger(value), `${code} has a non-integer crowd value`).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
      }
    }
    // Both arms observed, or the sweep proves only that one branch exists.
    expect(researched).toBe(1);
    expect(withheld).toBe(CODES.length - 1);
  });

  test("China is the researched one and Peru is not", () => {
    expect(getCountryProfile("CN").crowdByMonth).toEqual(NATIONAL_CROWD);
    expect(getCountryProfile("PE").crowdByMonth).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The anti-leak sweep — every country, not one sample
// ---------------------------------------------------------------------------

/** Every country the artifact carries, plus every ISO code there is, minus CN. */
const SWEPT = [
  ...new Set([...Object.keys(COUNTRY_FACTS), ...Object.values(ISO_NUMERIC_TO_ALPHA2)]),
]
  .filter((code) => code !== "CN")
  .sort();

/**
 * Everything a profile may not say outside China. The same list
 * lib/countryGuidance.test.ts scans a generated plan with — kept as literals
 * rather than folded into the CJK sweep so a failure names the offender.
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

/**
 * The three legitimate hits, enumerated rather than filtered out of the token
 * list, and each one verified by hand on 2026-08-27.
 *
 * Hong Kong, Macau and Singapore give `Standard Chinese` as an official
 * language in the committed artifact, and `languageTip` and
 * `translationPackItem` render it. "Standard Chinese is the official language"
 * of Hong Kong is a true sentence about Hong Kong, not China's copy leaking
 * into it — which is what the sweep is for. Dropping "Chinese" from the token
 * list instead would have disarmed the sweep for all 249 countries to excuse
 * three; pinning the exact pairs keeps it armed, and a fourth fails here.
 */
const ALLOWED_HITS = ["HK: Chinese", "MO: Chinese", "SG: Chinese"];

/** Everything a profile says that a traveller could read as advice. */
function profileText(code: string): string {
  const profile = getCountryProfile(code);
  return JSON.stringify({
    tips: profile.tips,
    packing: profile.packing,
    gapNote: profile.gapNote,
    bookingCopy: profile.transport.bookingCopy,
    holidays: profile.holidays,
  });
}

function hits(code: string, text: string): string[] {
  const found: string[] = CHINA_TOKENS.filter((token) => text.includes(token)).map(
    (token) => `${code}: ${token}`
  );
  if (CJK.test(text)) found.push(`${code}: <CJK codepoint>`);
  return found;
}

describe("no country anywhere is handed China's copy", () => {
  test("the sweep is armed: it walks the real artifact, not an empty one", () => {
    // THE ITERATION FLOOR. A loop over a failed artifact load iterates zero
    // times and passes perfectly, and this repo has paid for that shape more
    // than once. Measured 2026-08-27: 246 countries in the artifact, 250 codes
    // in the ISO table, 249 in the union once China is removed.
    expect(Object.keys(COUNTRY_FACTS).length).toBeGreaterThanOrEqual(240);
    expect(Object.keys(COUNTRY_FACTS)).toContain("PE");
    expect(SWEPT.length).toBeGreaterThanOrEqual(245);
    expect(SWEPT).not.toContain("CN");
    expect(SWEPT).toContain("PE");
    expect(SWEPT).toContain("HK");
  });

  test("the sweep is armed twice: the profiles it scans carry ingested sentences", () => {
    // The second way this can go vacuous, and the one a row count cannot see:
    // an artifact that loads but reaches nothing would have the loop scan 249
    // copies of the neutral document, which contains no forbidden token by
    // construction. Measured 2026-08-27: 245 of 249 carry at least one fact
    // tip, 238 carry a currency, and 204 carry a country-specific plug line.
    const withFactTips = SWEPT.filter((code) => getCountryProfile(code).tips.length > 3);
    expect(withFactTips.length).toBeGreaterThanOrEqual(200);
    const withPlugLine = SWEPT.filter(
      (code) => !getCountryProfile(code).packing[1].items.includes(NEUTRAL_ADAPTER_ITEM)
    );
    expect(withPlugLine.length).toBeGreaterThanOrEqual(180);
  });

  test("every profile, scanned, with the three verified exceptions pinned", () => {
    let scanned = 0;
    const found: string[] = [];
    for (const code of SWEPT) {
      scanned += 1;
      found.push(...hits(code, profileText(code)));
    }
    expect(found).toEqual(ALLOWED_HITS);
    expect(scanned).toBe(SWEPT.length);
    expect(scanned).toBeGreaterThanOrEqual(245);
  });

  test("the scan is armed: the identical scan on China's own profile fails", () => {
    // A scan that silently matched nothing would look exactly like a clean one.
    // China's hand-written profile trips every token in the list and the CJK
    // sweep, which is what proves the scan can see.
    const cn = hits("CN", profileText("CN"));
    expect(cn).toHaveLength(CHINA_TOKENS.length + 1);
    expect(cn).toContain("CN: Alipay");
    expect(cn).toContain("CN: 12306");
    expect(cn).toContain("CN: <CJK codepoint>");
  });

  test("every token in the list is one the scan can actually find", () => {
    // A typo in the list would remove a token from the gate silently.
    for (const token of CHINA_TOKENS) {
      expect(hits("ZZ", `prefix ${token} suffix`)).toContain(`ZZ: ${token}`);
    }
    expect(CHINA_TOKENS).toHaveLength(12);
    expect(hits("ZZ", "一")).toEqual(["ZZ: <CJK codepoint>"]);
    expect(hits("ZZ", "Travel to Cusco")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The facts branch
// ---------------------------------------------------------------------------

describe("a country the ingest reached gets the ingested sentences", () => {
  const pe = getCountryProfile("PE");
  const xx = getCountryProfile("XX");

  /** The four facts-derived fields, and only those. The rest is hand-curated. */
  const factsHalf = (code: string): string => {
    const profile = getCountryProfile(code);
    return JSON.stringify({
      tips: profile.tips,
      packing: profile.packing,
      currency: profile.currency,
      gapNote: profile.gapNote,
    });
  };

  test("Peru's profile is not the neutral default", () => {
    // The proof that the ingest ran for Peru at all. Everything else in this
    // describe is a detail of *how* it differs; this is the claim that it does.
    // "XX" is the neutral default because it is a permanently-unassigned ISO
    // code: no artifact record, no name, nothing for the facts branch to read.
    expect(factsHalf("PE")).not.toBe(factsHalf("XX"));
    expect(pe.tips).not.toEqual(xx.tips);
    expect(pe.packing).not.toEqual(xx.packing);
    expect(pe.currency).not.toBe(xx.currency);
  });

  test("the neutral tips still open the panel, with the fact tips after them", () => {
    expect(pe.tips.slice(0, NEUTRAL_TIPS.length)).toEqual([...NEUTRAL_TIPS]);
    expect(pe.tips.slice(NEUTRAL_TIPS.length)).toEqual([
      "Prices are in PEN. Set your home currency on the Money tab for live conversions.",
      "Sockets are type A, B and C at 220 V — bring a universal adapter.",
      "Emergency numbers: 105 police, 116 fire, 106 or 117 ambulance.",
      "Aymara, Quechua and Spanish are official languages — download an offline translation pack before you go.",
      "Traffic drives on the right. The international dialling code is +51.",
    ]);
  });

  test("the packing document carries the plug line and the cash line", () => {
    expect(pe.packing.map((group) => group.title)).toEqual(
      NEUTRAL_PACKING.map((group) => group.title)
    );
    expect(pe.packing[0].items).toEqual([
      "Passport with at least six months' validity, plus any visa you need",
      "A payment card that works abroad, and a small amount of local cash",
      "Some PEN cash as a backup",
      "Travel insurance policy details",
      "Copies of your bookings, stored offline",
    ]);
    expect(pe.packing[1].items).toEqual([
      // The specific line REPLACES the generic one, as China's hand-written
      // document does — it does not sit beside it.
      "Universal power adapter (Peru uses type A/B/C plugs, 220V)",
      "Phone and power bank",
      "Offline maps and a translation app downloaded before you fly",
    ]);
    // Peru has three official languages, so no single-language pack is
    // claimed. Japan has one and gets it — the arming half of the same rule.
    expect(pe.packing[1].items).not.toContain("Offline Spanish translation pack");
    expect(getCountryProfile("JP").packing[1].items).toEqual([
      "Universal power adapter (Japan uses type A/B plugs, 100V)",
      "Phone and power bank",
      "Offline Japanese translation pack",
      "Offline maps and a translation app downloaded before you fly",
    ]);
  });

  test("the splice anchors are still found, so the append fallback is not the live path", () => {
    // `spliced` appends when its anchor has gone, which keeps a fact sentence
    // rather than dropping it — but that is a safety net, not the path this
    // runs on. If an anchor were reworded out of NEUTRAL_PACKING the cash line
    // would land at the end of its group, and these positions would fail.
    expect(pe.packing[0].items.indexOf("Some PEN cash as a backup")).toBe(2);
    expect(
      getCountryProfile("JP").packing[1].items.indexOf("Offline Japanese translation pack")
    ).toBe(2);
    // And the generic adapter is gone wherever a specific one fired.
    expect(pe.packing[1].items).not.toContain(NEUTRAL_ADAPTER_ITEM);
    expect(xx.packing[1].items).toContain(NEUTRAL_ADAPTER_ITEM);
  });

  test("the gap note names the source, and names no field Peru actually has", () => {
    // Peru carries all six fields the note can name, so it gets one line.
    expect(pe.gapNote).toHaveLength(1);
    expect(pe.gapNote[0]).toContain("Peru-specific guidance");
    expect(pe.gapNote[0]).toContain("open reference data");
    // Measured against the committed artifact: 61 of the 249 swept codes are
    // missing at least one field and get the second line.
    const twoLine = SWEPT.filter((code) => getCountryProfile(code).gapNote.length === 2);
    expect(twoLine).toHaveLength(61);
    expect(getCountryProfile(twoLine[0]).gapNote[1]).toContain("We also have no ");
    // What the ingest's territorial-scope rule costs that number, DERIVED
    // rather than restated. The previous version of this comment named a moved
    // set of "AF, AZ, BE, BQ and PW" and put US outside it "for its plugs" —
    // backwards on both counts. BQ was already two-line (it is missing plugs,
    // voltage and emergency numbers as well) so it never moved; US carries
    // every other rendered field, so its languages are its WHOLE gap and it
    // moved. AZ and BE are off the list again, their languages restored by a
    // hand-verified CURATED_FACTS row. So the set is read off the profiles
    // instead: the codes whose only missing field is their languages, minus
    // the three upstream never had any for.
    const languagesAreTheWholeGap = twoLine.filter((code) => {
      const profile = getCountryProfile(code);
      return profile.gapNote[1] === `We also have no official language for ${profile.name}.`;
    });
    const movedByTheRule = languagesAreTheWholeGap.filter(
      (code) => !["GP", "MQ", "UY"].includes(code)
    );
    expect(movedByTheRule).toEqual(["AF", "PW", "US"]);
    // Which makes the "before" figure 58 — computed, not copied.
    expect(twoLine.length - movedByTheRule.length).toBe(58);
    // Armed: the filter above is a whole-string match, so a reworded gap note
    // would silently empty it. GP, MQ and UY are the three it must still find
    // beside the three the rule moved.
    expect(languagesAreTheWholeGap).toHaveLength(6);
  });

  test("China gets no gap note, because it is researched by hand", () => {
    expect(getCountryProfile("CN").gapNote).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

/**
 * `name` — what the profile calls this country to a traveller.
 *
 * Added so a client component can have the facts-backed name without importing
 * lib/countryFacts.ts: `components/PlanStep.tsx` may not name that module
 * (lib/countryFacts.test.ts pins that it does not, as the arming assertion for
 * its transitive-import walk), and the alternative it was using —
 * `getCountry(code).name` — falls back to the bare code, so the wizard headline
 * read "Your PE itinerary" for the 222 countries lib/countries.ts does not
 * curate.
 */
describe("name is the traveller-facing one, for every country there is", () => {
  test("hand-tuned beats ingested, and it is the same rule getCountryName has", () => {
    // CN is in BOTH tables and they disagree: lib/countries.ts says "China",
    // the CC0 artifact says "People's Republic of China". The curated one wins,
    // which is what makes this a precedence test rather than a spelling one.
    expect(getCountryProfile("CN").name).toBe("China");
    expect(COUNTRY_FACTS.CN?.name).toBe("People's Republic of China");
    // Same disagreement, opposite spelling direction, so a `name` wired to the
    // artifact instead would redden here too rather than only on CN.
    expect(getCountryProfile("TR").name).toBe("T\u00fcrkiye");
    expect(COUNTRY_FACTS.TR?.name).toBe("Turkey");
  });

  test("an uncurated country gets its real name, not its code", () => {
    // The defect this field exists to fix, stated on the country it was found
    // on and on two more so it cannot pass by a single lucky record.
    expect(getCountryProfile("PE").name).toBe("Peru");
    expect(getCountryProfile("NP").name).toBe("Nepal");
    expect(getCountryProfile("BO").name).toBe("Bolivia");
  });

  test("a code that is not a country has no name, and says so with a blank", () => {
    // Not the code, and not a hedge: the blank is what `buildGapNote` and
    // `powerAdapterItem` already branch on, and the wizard drops the word
    // rather than printing "Your XX itinerary".
    expect(getCountryProfile("XX").name).toBe("");
    expect(getCountryProfile("\ud83d\ude42").name).toBe("");
    expect(getCountryProfile("").name).toBe("");
  });

  test("no swept code is ever named after itself, and only four have no name", () => {
    // Collected and asserted once rather than ~500 expects: a per-code matcher
    // call in a loop puts thousands of them inside one test's timeout, which is
    // what commit 84cd61e was about.
    const nameless: string[] = [];
    const namedAfterTheCode: string[] = [];
    for (const code of SWEPT) {
      const name = getCountryProfile(code).name;
      if (name === "") nameless.push(code);
      if (name === code) namedAfterTheCode.push(code);
    }
    // The bug, swept: not one of 249 codes renders as its own two letters.
    expect(namedAfterTheCode).toEqual([]);
    // And the blanks are named, not bounded. All four are uninhabited —
    // Antarctica, Bouvet Island, Heard & McDonald, US Minor Outlying Islands —
    // so the sovereign-state ingest has no record for them and nobody is
    // planning a trip there. A fifth appearing means the artifact lost a
    // country, which is a thing to look at rather than to tolerate.
    expect(nameless).toEqual(["AQ", "BV", "HM", "UM"]);
    // Armed: the sweep is the real list, not an empty one that passes for free.
    expect(SWEPT.length).toBeGreaterThan(240);
  });
});

describe("currency is a fact or an absence, never a placeholder", () => {
  test("a country the artifact covers reads its ISO code", () => {
    expect(getCountryProfile("JP").currency).toBe("JPY");
    expect(getCountryProfile("PE").currency).toBe("PEN");
    expect(getCountryProfile("CN").currency).toBe("CNY");
  });

  test("a code that is not a country reads null", () => {
    expect(getCountryProfile("XX").currency).toBeNull();
    for (const junk of ["", "   ", "CHN", "🙂", "constructor"]) {
      expect(getCountryProfile(junk).currency).toBeNull();
    }
  });

  test("isCurrencyResearched agrees with the field, for every country there is", () => {
    // The two must move together: a predicate that still answered "CN only"
    // while the field carried Japan's real JPY would report a fact as a guess,
    // and one that answered "always" while the field could be null would
    // report a guess as a fact. Neither is a compile error.
    let researched = 0;
    for (const code of ["CN", ...SWEPT]) {
      const currency = getCountryProfile(code).currency;
      expect(isCurrencyResearched(code), `${code} disagrees with its own currency`).toBe(
        currency !== null
      );
      if (currency !== null) researched += 1;
    }
    // Both arms observed, or the equality above is satisfied by a predicate
    // that is a constant. Measured 2026-08-27: 238 of the 249 swept codes carry
    // a currency, plus China.
    expect(researched).toBe(239);
    expect(researched).toBeLessThan(SWEPT.length + 1);
  });
});
