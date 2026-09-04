import { describe, expect, test } from "vitest";
import fixture from "@/data/climate-anchors.json";
import { GEONAMES_NO_DATA_ELEVATION } from "./cityShard";
import {
  BAND_EDGES,
  FIRST_GUESS_KNOBS,
  HOLDOUT_REGIONS,
  KNOBS,
  TUNING_REGIONS,
  bandOf,
  climateMonth,
  correctedDewPoint,
  elevationWarming,
  monthFit,
  penaltyOf,
  rainKnee,
  usableElevation,
  type ClimateKnobs,
  type DerivedFit,
} from "./climateModel";
import { getCountryBaseProfile } from "./countryBaseProfile";
import { REGION_MONTHS, type MonthFit } from "./months";
import type { ChinaRegion } from "./types";

/**
 * The fit model is tested against `data/climate-anchors.json`: real CHELSA
 * rows for spec §9.5's nine China anchors and for the symptom cities §9.4's
 * four fixes are named after, sampled by `scripts/sample-climate-anchors.mjs`
 * from the cached rasters. Twenty-three cities, about 23 KB of fixture, so these
 * tests never touch `public/` or a raster.
 *
 * Each of the seven brief tests is named by the SYMPTOM that proves its fix,
 * and each also asserts the counterfactual — the same city with the fix
 * switched off — so removing the fix fails the test rather than merely
 * changing a number nobody reads.
 *
 * The calibration tests at the bottom pin the record in the module docblock.
 * Spec §9.4's protocol: knobs tuned on East, Northwest and Central only; the
 * four holdout regions scored once, after tuning, and the number reported as
 * it came out. If a re-tune moves it, that test moves with it — visibly.
 */

const JAN = 0;
const FEB = 1;
const MAR = 2;
const APR = 3;
const JUN = 5;
const JUL = 6;
const AUG = 7;
const SEP = 8;
const NOV = 10;
const DEC = 11;
const MONTHS = Array.from({ length: 12 }, (_, i) => i);

interface FixtureCity {
  key: string;
  name: string;
  role: "tuning" | "holdout" | "symptom";
  region: ChinaRegion | null;
  elev: number | null;
  row: number[];
}

const ROLES = new Set(["tuning", "holdout", "symptom"]);

/** The fixture, validated once: twenty-three rows of exactly 60 integers. */
const CITIES: FixtureCity[] = fixture.cities.map((city) => {
  if (!ROLES.has(city.role)) throw new Error(`${city.key}: unknown role ${city.role}`);
  if (city.row.length !== 60 || !city.row.every((v) => Number.isSafeInteger(v))) {
    throw new Error(`${city.key}: row is not 60 integers`);
  }
  return {
    key: city.key,
    name: city.name,
    role: city.role as FixtureCity["role"],
    region: city.region as ChinaRegion | null,
    elev: city.elev,
    row: city.row,
  };
});

function city(key: string): FixtureCity {
  const found = CITIES.find((c) => c.key === key);
  if (!found) throw new Error(`fixture has no city ${key}`);
  return found;
}

const fitOf = (c: FixtureCity, month: number, knobs: ClimateKnobs = KNOBS): DerivedFit =>
  monthFit(c.row, c.elev, month, knobs);
const totalOf = (c: FixtureCity, month: number, knobs: ClimateKnobs = KNOBS): number =>
  penaltyOf(c.row, c.elev, month, knobs).total;

// ---------------------------------------------------------------------------
// The four fixes, by symptom
// ---------------------------------------------------------------------------

describe("fix 1 — cloud cover", () => {
  /**
   * §9.4's premise: Lima's precipitation is ~3 mm/month year-round, so only
   * cloud can separate the Jun–Sep garúa from summer. The premise fails on
   * this dataset. Sampled at Lima's own cell, CHELSA V2.1 `clt` reads
   * Jun–Sep at 34–36% and Jan–Mar at 63–64% — the garúa months are the
   * CLEAREST of the year — and the same inversion holds along the whole
   * coast (Callao 39 vs 58, Trujillo 23 vs 55, Ica 12 vs 55; only Arica in
   * Chile shows winter cloud — all four are fixture rows now, and the test
   * below reads them). The probe that vouched for fix 1 sampled January
   * alone.
   *
   * And once cloud points the wrong way, nothing else in the stored row
   * separates the season. The T−td depression is 5–6 °C in EVERY month of
   * Lima's year (Jun–Sep 5.5–6.0, Jan–Mar 6.0) and the diurnal range 3–5 °C
   * in every month; both are flat. The one signal left is a daily high of
   * 18–19 °C in Jun–Sep — and that reads `great` on the very scale this
   * model is fitted to, where `REGION_MONTHS.North` April (lo 7, hi 20) is
   * `great`. So no monotone function of the five stored inputs marks Lima's
   * winter down at all; it is not that Cusco gets in the way.
   *
   * So the cloud term is in the model — it is what separates Wuhan's grey
   * March from its clear November, and Nairobi's overcast July — but Lima
   * does not prove it. ONE `test.fails` stands for both of the brief's Lima
   * names, "fix 1 — Lima is not great in all twelve months" (kept as the
   * test's name) and "Lima's winter is not great" (what the body asserts).
   * The winter is the specific claim worth tripping on: the all-twelve
   * variant could go green for the wrong reason, because the inverted cloud
   * already penalises Lima's SUMMER. It is a tripwire — it asserts what the
   * spec expects and goes red the day the data or the model makes it true,
   * so whoever changes either has to flip it deliberately.
   */
  test.fails("fix 1 — Lima is not great in all twelve months", () => {
    const lima = city("lima");
    for (const m of [JUN, JUL, AUG, SEP]) expect(fitOf(lima, m)).not.toBe("great");
  });

  test("a month is worse for cloud alone, and the term is the reason", () => {
    // Two rows identical in every input but cloud. Wuhan's March and November
    // share a shape — mild, moderately wet — and differ in cloud by 16 points
    // (53 vs 37); this is that difference isolated.
    const wuhan = city("wuhan");
    const clear = [...wuhan.row];
    const overcast = [...wuhan.row];
    for (const m of MONTHS) {
      clear[36 + m] = 20;
      overcast[36 + m] = 95;
    }
    for (const m of MONTHS) {
      const bright = penaltyOf(clear, wuhan.elev, m);
      const grey = penaltyOf(overcast, wuhan.elev, m);
      expect(bright.cloud).toBe(0);
      expect(grey.cloud).toBeGreaterThan(0);
      expect(grey.total - bright.total).toBeCloseTo(grey.cloud, 12);
    }
    // ...and without the term nothing separates them.
    const off = { ...KNOBS, cloudKneePct: 100 };
    for (const m of MONTHS) {
      expect(penaltyOf(overcast, wuhan.elev, m, off).total).toBe(penaltyOf(clear, wuhan.elev, m, off).total);
    }
  });

  test("the coast-wide inversion the tripwire rests on is in the fixture, not only in a comment", () => {
    // Mean cloud in the garúa months against the summer months, off the
    // sampled rows. For the Peruvian coast winter reads CLEARER; Arica, in
    // Chile, is the coastal-desert city whose winter reads cloudier — which
    // is what makes the inversion a fact about CHELSA's Peruvian coast and
    // not about coastal deserts. If a re-sample ever flips one of these, the
    // rationale above is what changes, and in the open.
    const WINTER = [JUN, JUL, AUG, SEP];
    const SUMMER = [JAN, FEB, MAR];
    const meanCloud = (c: FixtureCity, months: number[]): number =>
      months.reduce((sum, m) => sum + climateMonth(c.row, m).cloud, 0) / months.length;

    for (const key of ["lima", "callao", "trujillo", "ica"]) {
      const c = city(key);
      expect(c.role, key).toBe("symptom");
      expect(meanCloud(c, WINTER), `${c.name}: winter cloud vs summer`).toBeLessThan(meanCloud(c, SUMMER));
    }
    const arica = city("arica");
    expect(arica.role).toBe("symptom");
    expect(meanCloud(arica, WINTER)).toBeGreaterThan(meanCloud(arica, SUMMER));
  });
});

describe("fix 2 — humidity bias correction", () => {
  test("fix 2 — Tokyo July is not great", () => {
    // hurs runs systematically low in humid climates (Iquitos 72% vs ~85%
    // observed). Tokyo's July row carries td 18 on a 25 °C mean — 65% RH,
    // against ~77% observed — which is why the uncorrected model read July
    // as great (penalty 0.41) and 338 of 750 Japanese cities with it. The
    // mugginess TERM works; the INPUT is wrong, so the correction is applied
    // to the input, in dew-point space, at read time.
    const tokyo = city("tokyo");
    expect(fitOf(tokyo, JUL)).not.toBe("great");
    // The counterfactual: the same row with the correction switched off is
    // what the spec complained about.
    const uncorrected = { ...KNOBS, humidityGain: 1 };
    expect(fitOf(tokyo, JUL, uncorrected)).toBe("great");
    expect(penaltyOf(tokyo.row, tokyo.elev, JUL).mugginess).toBeGreaterThan(
      penaltyOf(tokyo.row, tokyo.elev, JUL, uncorrected).mugginess,
    );
  });

  test("the correction raises a dew point more in humid air than in dry air", () => {
    // Iquitos, 72% → ~85%: a gain, not an offset, so that Dunhuang's desert
    // air (td −15 on a −6 °C mean) is left alone in absolute terms.
    const humid = correctedDewPoint(21, 27) - 21; // Iquitos-like
    const dry = correctedDewPoint(-15, -6) - -15; // Dunhuang-like
    expect(humid).toBeGreaterThan(1);
    expect(dry).toBeGreaterThanOrEqual(0);
    expect(dry).toBeLessThan(humid);
    // Never above saturation: RH is capped at 100% before the dew point is
    // re-derived, so td never exceeds T.
    expect(correctedDewPoint(27, 27)).toBeLessThanOrEqual(27 + 1e-9);
    expect(correctedDewPoint(5, 5, { ...KNOBS, humidityGain: 3 })).toBeLessThanOrEqual(5 + 1e-9);
  });
});

describe("fix 3 — climate-relative rain knee", () => {
  test("fix 3 — Kenya shows two rain maxima, not 78.1% great", () => {
    // Nairobi: Apr 191, Jun–Sep 18–26, Nov 118. A knee tuned on China at
    // 140 mm saw one of these and called the rest fine.
    const nairobi = city("nairobi");
    const rain = (m: number) => penaltyOf(nairobi.row, nairobi.elev, m).rain;
    expect(rain(APR)).toBeGreaterThan(0);
    expect(rain(NOV)).toBeGreaterThan(0);
    for (const m of [JUN, JUL, AUG, SEP]) expect(rain(m)).toBe(0);
    // Both maxima are worse months than every dry-season month, in the
    // total and in the verdict — the long rains are not a great month.
    for (const m of [JUN, JUL, AUG, SEP]) {
      expect(totalOf(nairobi, APR)).toBeGreaterThan(totalOf(nairobi, m));
      expect(totalOf(nairobi, NOV)).toBeGreaterThan(totalOf(nairobi, m));
    }
    expect(fitOf(nairobi, APR)).not.toBe("great");
    // The long rains are not a great month anywhere in Kenya's three
    // cycles, and rain is the term that says so. (The spec's 78.1% was
    // measured over 336 Kenyan cities; three fixture rows cannot reproduce a
    // share, so the mechanism is what is pinned, not the percentage.)
    for (const c of ["nairobi", "mombasa", "kisumu"].map(city)) {
      expect(fitOf(c, APR)).not.toBe("great");
      expect(penaltyOf(c.row, c.elev, APR).rain).toBeGreaterThan(0);
    }
    // The counterfactual is the symptom itself: under the China-tuned global
    // knee of 140 mm, Nairobi is great in all twelve months — both rainy
    // seasons vanish from the verdict, November without even a rain term.
    const global = { ...KNOBS, rainRelative: 0, rainFloorMm: 140, rainCapMm: 140 };
    expect(MONTHS.map((m) => fitOf(nairobi, m, global))).toEqual(MONTHS.map(() => "great"));
    expect(penaltyOf(nairobi.row, nairobi.elev, NOV, global).rain).toBe(0);
  });

  test("the knee is the city's own, inside an absolute corridor", () => {
    // Dunhuang's wettest month is 10 mm: the knee sits on the floor and no
    // month of the year pays for rain.
    const dunhuang = city("dunhuang");
    expect(rainKnee(dunhuang.row)).toBe(KNOBS.rainFloorMm);
    for (const m of MONTHS) expect(penaltyOf(dunhuang.row, dunhuang.elev, m).rain).toBe(0);
    // Iquitos at ~330 mm: the knee is capped, so a place that is wet all
    // year is not told every month is fine because every month is the same.
    const iquitos = city("iquitos");
    expect(rainKnee(iquitos.row)).toBe(KNOBS.rainCapMm);
    expect(penaltyOf(iquitos.row, iquitos.elev, APR).rain).toBeGreaterThan(0);
    // Everyone else is somewhere between, scaled to their own wettest month.
    for (const c of CITIES) {
      const knee = rainKnee(c.row);
      expect(knee).toBeGreaterThanOrEqual(KNOBS.rainFloorMm);
      expect(knee).toBeLessThanOrEqual(KNOBS.rainCapMm);
    }
    const nairobi = city("nairobi");
    expect(rainKnee(nairobi.row)).toBeGreaterThan(KNOBS.rainFloorMm);
    expect(rainKnee(nairobi.row)).toBeLessThan(KNOBS.rainCapMm);
  });
});

describe("fix 4 — elevation-dependent temperature correction", () => {
  test("fix 4 — Cusco's Jun-Aug is reachable as great", () => {
    // CHELSA's bias runs −1.94 °C overall and −3.62 °C above 2,000 m. Cusco
    // at 3,312 m reads hi 15 in its dry season, which the cold term marks
    // down; corrected, June–August — its actual peak season — come out great.
    const cusco = city("cusco");
    expect(cusco.elev).toBe(3312);
    for (const m of [JUN, JUL, AUG]) expect(fitOf(cusco, m)).toBe("great");
    // The counterfactual is "no correction", reached two ways: no elevation
    // on the call, and every elevation knob zeroed. Neither is a global
    // offset — §9.5's +1.94 °C everywhere would leave these three months
    // great (0.74 / 0.74 / 0.56); what it damages is the lowlands, which is
    // how it made China agreement worse (35 → 29 of 48).
    expect([JUN, JUL, AUG].map((m) => monthFit(cusco.row, null, m))).toContain("ok");
    const flat: ClimateKnobs = { ...KNOBS, elevWarmFromM: 0, elevWarmPerKmC: 0, elevWarmMaxC: 0 };
    expect([JUN, JUL, AUG].map((m) => fitOf(cusco, m, flat))).toContain("ok");
    // So the dependence itself belongs here, under the brief's name: a
    // lowland row is warmed by nothing at all — at sea level and at the
    // 500 m knee — while Cusco's is warmed. (The rest of the profile, growth
    // and cap, is pinned by "the correction is zero in the lowlands, grows
    // with height, and is capped" below; this is the offset/dependence
    // distinction only.)
    expect(elevationWarming(0)).toBe(0);
    expect(elevationWarming(500)).toBe(0);
    expect(elevationWarming(cusco.elev)).toBeGreaterThan(0);
    // And on a row, not just the scalar: Cusco's own row placed at sea level
    // scores exactly as a row with no elevation, every month and every term.
    for (const m of MONTHS) expect(penaltyOf(cusco.row, 0, m)).toEqual(penaltyOf(cusco.row, null, m));
  });

  test("fix 4 does not apply a 30 C correction to a -9999 elevation", () => {
    // 300 committed rows carried GeoNames' dem nodata sentinel. It is
    // finite, it is an integer, and it passes Number.isFinite. THE trap.
    // The committed shards now null it at ingest, but a browser cache can
    // serve a pre-fix shard for a day, so the model refuses it too — through
    // the one constant that names it, not a second literal.
    expect(usableElevation(GEONAMES_NO_DATA_ELEVATION)).toBeNull();
    expect(usableElevation(null)).toBeNull();
    expect(usableElevation(Number.NaN)).toBeNull();
    expect(usableElevation(Number.POSITIVE_INFINITY)).toBeNull();
    expect(usableElevation(3312)).toBe(3312);
    expect(elevationWarming(GEONAMES_NO_DATA_ELEVATION)).toBe(0);
    expect(elevationWarming(null)).toBe(0);
    // A sentinel row scores exactly as a row with no elevation, every month.
    const tromso = city("tromso");
    expect(tromso.elev).toBeNull();
    for (const c of CITIES) {
      for (const m of MONTHS) {
        expect(penaltyOf(c.row, GEONAMES_NO_DATA_ELEVATION, m)).toEqual(penaltyOf(c.row, null, m));
      }
    }
  });

  test("the correction is zero in the lowlands, grows with height, and is capped", () => {
    expect(elevationWarming(0)).toBe(0);
    expect(elevationWarming(-430)).toBe(0); // the Dead Sea shore is not cooled
    expect(elevationWarming(KNOBS.elevWarmFromM)).toBe(0);
    expect(elevationWarming(city("nairobi").elev)).toBeGreaterThan(0);
    expect(elevationWarming(city("cusco").elev)).toBeGreaterThan(elevationWarming(city("nairobi").elev));
    expect(elevationWarming(8848)).toBe(KNOBS.elevWarmMaxC);
    // §9.5's measured figure: the bias is about −3.62 °C above 2,000 m, and
    // the correction is on that scale rather than the global −1.94.
    expect(elevationWarming(2500)).toBeGreaterThan(2);
    expect(elevationWarming(2500)).toBeLessThanOrEqual(KNOBS.elevWarmMaxC);
  });
});

describe("plain verdicts", () => {
  test("Norway January is never great", () => {
    for (const key of ["oslo", "bergen", "tromso"]) {
      const c = city(key);
      expect(fitOf(c, JAN)).not.toBe("great");
      expect(penaltyOf(c.row, c.elev, JAN).cold).toBeGreaterThan(0);
    }
  });

  test("Tromsø, with no elevation, still gets a verdict", () => {
    const tromso = city("tromso");
    expect(tromso.elev).toBeNull();
    for (const m of MONTHS) expect(["great", "ok", "poor", "avoid"]).toContain(fitOf(tromso, m));
  });
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe("shape", () => {
  test("every fixture city gets one of the four verdicts every month — never unknown", () => {
    const allowed: MonthFit[] = ["great", "ok", "poor", "avoid"];
    for (const c of CITIES) {
      for (const m of MONTHS) expect(allowed).toContain(fitOf(c, m));
    }
  });

  test("climateMonth reads the calendar-indexed blocks", () => {
    // Lima's January, as data/climate-probe.md printed it from the raster:
    // 19.95 / 24.05 °C, 3.7 mm, 62.7% — rounded.
    const lima = city("lima");
    expect(climateMonth(lima.row, JAN)).toEqual({ lo: 20, hi: 24, precip: 4, cloud: 63, td: 16 });
    // And no hemisphere flip: Sydney's problem is not this table's. Lima's
    // warmest high is in February, its coolest in July–August.
    const highs = MONTHS.map((m) => climateMonth(lima.row, m).hi);
    expect(highs.indexOf(Math.max(...highs))).toBe(FEB);
    expect(Math.min(...highs)).toBe(highs[JUL]);
  });

  test("penalty terms are non-negative and sum to the total", () => {
    for (const c of CITIES) {
      for (const m of MONTHS) {
        const p = penaltyOf(c.row, c.elev, m);
        for (const term of [p.heat, p.cold, p.mugginess, p.rain, p.cloud]) {
          expect(term).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(term)).toBe(true);
        }
        expect(p.total).toBeCloseTo(p.heat + p.cold + p.mugginess + p.rain + p.cloud, 12);
        expect(bandOf(p.total)).toBe(fitOf(c, m));
      }
    }
  });

  test("bands are one penalty unit wide and monotone", () => {
    expect(BAND_EDGES).toEqual({ ok: 1, poor: 2, avoid: 3 });
    expect(bandOf(0)).toBe("great");
    expect(bandOf(0.999)).toBe("great");
    expect(bandOf(1)).toBe("ok");
    expect(bandOf(1.999)).toBe("ok");
    expect(bandOf(2)).toBe("poor");
    expect(bandOf(2.999)).toBe("poor");
    expect(bandOf(3)).toBe("avoid");
    expect(bandOf(50)).toBe("avoid");
  });

  test("a malformed row or month is the caller's bug, and throws", () => {
    const lima = city("lima");
    expect(() => monthFit(lima.row.slice(0, 59), lima.elev, JAN)).toThrow(/60/);
    expect(() => monthFit([...lima.row, 0], lima.elev, JAN)).toThrow(/60/);
    const floaty = [...lima.row];
    floaty[0] = 19.95;
    expect(() => monthFit(floaty, lima.elev, JAN)).toThrow(/integer/);
    const holed = [...lima.row] as (number | null)[];
    holed[30] = null;
    expect(() => monthFit(holed as number[], lima.elev, JAN)).toThrow(/integer/);
    expect(() => monthFit(lima.row, lima.elev, 12)).toThrow(/month/);
    expect(() => monthFit(lima.row, lima.elev, -1)).toThrow(/month/);
    expect(() => monthFit(lima.row, lima.elev, 1.5)).toThrow(/month/);
    expect(() => monthFit(lima.row, lima.elev, Number.NaN)).toThrow(/month/);
  });

  test("does not mutate the row it is given", () => {
    const lima = city("lima");
    const before = [...lima.row];
    for (const m of MONTHS) monthFit(lima.row, lima.elev, m);
    expect(lima.row).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Contract requirements — spec §9.4. Two of the table's four are pinned
// elsewhere already (total/hasOwnProperty and 12-rows-or-null, both in
// countryProfile.test.ts) and are not repeated here. These two are the ones
// the spec says must be written fresh, not ported from anywhere.
// ---------------------------------------------------------------------------

describe("contract requirements — spec §9.4", () => {
  test("returns fresh objects per call", () => {
    // The curated side. Implemented at countryBaseProfile.ts's chinaClimate
    // (`rows.map((row) => ({ ...row }))`, around line 191) but nothing
    // proved it before this test — the existing mutation test at
    // countryProfile.test.ts:52-63 covers only crowdByMonth and tips.
    // Mutate what one call hands back, in both the object and the array
    // sense, and prove a second call — and the shared curated table itself —
    // are untouched.
    const east = getCountryBaseProfile("CN").climateFor("East");
    expect(east).not.toBeNull();
    if (east === null) return; // narrows for TS; the assertion above already failed the test if so
    east[0].lo = 99;
    east.push({ lo: 1, hi: 1, fit: "great" });
    expect(getCountryBaseProfile("CN").climateFor("East")).toEqual(REGION_MONTHS.East);
    expect(REGION_MONTHS.East[0].lo).not.toBe(99);
    expect(REGION_MONTHS.East).toHaveLength(12);

    // The derived side: the same claim about climateMonth. Every field it
    // returns is copied out of the row by value already, so mutating the
    // returned object cannot reach back into the row's own numbers — this
    // guards against a future cache that hands back one shared object
    // instead of building a fresh one per call.
    const lima = city("lima");
    const before = [...lima.row];
    const jan = climateMonth(lima.row, JAN);
    jan.lo = 99;
    jan.hi = 99;
    jan.td = 99;
    expect(climateMonth(lima.row, JAN)).toEqual({ lo: 20, hi: 24, precip: 4, cloud: 63, td: 16 });
    expect(lima.row).toEqual(before);
  });

  test("every temperature is an integer", () => {
    // The curated half. Every REGION_MONTHS cell is already a hand-typed
    // integer literal (lib/months.ts), so this is GREEN ON DAY ONE — it is
    // not proving a bug fix, it is a regression guard: nothing before this
    // test asserted it anywhere.
    for (const region of Object.keys(REGION_MONTHS) as ChinaRegion[]) {
      for (const row of REGION_MONTHS[region]) {
        expect(Number.isInteger(row.lo)).toBe(true);
        expect(Number.isInteger(row.hi)).toBe(true);
      }
    }

    // The derived half, where this test earns its keep. penaltyOf applies
    // fix 4's elevation warming and fix 2's dew-point correction — both real
    // floats (Kunming's elevation warming alone is +2.5 °C) — but neither
    // must leak into what climateMonth hands back, because PlacePopup.tsx:101
    // interpolates `{climate.lo}°–{climate.hi}°C` with no formatting: a float
    // would render as "8.437°". Checked against every fixture city and
    // month, including several with real elevation (Kunming 1892 m, Cusco
    // 3312 m, Dunhuang 1142 m) where a leaked correction would show up as a
    // non-integer or a value that no longer matches the stored row.
    for (const c of CITIES) {
      for (const m of MONTHS) {
        const month = climateMonth(c.row, m);
        expect(Number.isInteger(month.lo)).toBe(true);
        expect(Number.isInteger(month.hi)).toBe(true);
        expect(Number.isInteger(month.td)).toBe(true);
        // Equal to the row's own stored ints (layout per data/climate-anchors
        // .json: block 0 is lo, block 1 is hi, January at index 0 of each) —
        // proves climateMonth reads the row raw rather than through penaltyOf's
        // corrected `high`/`dewPoint` locals.
        expect(month.lo).toBe(c.row[m]);
        expect(month.hi).toBe(c.row[12 + m]);
        // td pinned to its raw position for the same reason, and it is the
        // one that needs it most: `correctedDewPoint` is a real float on the
        // penalty path, so integer-ness alone would stay green if climateMonth
        // ever handed back a corrected value that happened to round.
        expect(month.td).toBe(c.row[48 + m]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Calibration record — spec §9.4's protocol, made executable
// ---------------------------------------------------------------------------

const BAND_RANK: Record<DerivedFit, number> = { great: 0, ok: 1, poor: 2, avoid: 3 };

/**
 * A region's derived verdict for a month is the band of the MEAN penalty of
 * its anchors — Southwest is Chengdu and Kunming, Northwest is Xi'an and
 * Dunhuang, and the curated table's lo/hi for those regions sit between
 * their anchors. Mean penalty rather than mean inputs, because the terms are
 * non-linear: averaging Kunming's 24 °C July with Chengdu's 30 °C would hide
 * all of Chengdu's heat, where averaging penalties keeps half of it.
 */
function regionFit(region: ChinaRegion, month: number, knobs: ClimateKnobs): DerivedFit {
  const anchors = CITIES.filter((c) => c.region === region);
  if (anchors.length === 0) throw new Error(`fixture has no anchor for ${region}`);
  const mean = anchors.reduce((sum, c) => sum + totalOf(c, month, knobs), 0) / anchors.length;
  return bandOf(mean);
}

interface Agreement {
  exact: number;
  withinOne: number;
  cells: number;
  misses: string[];
}

function agreement(regions: readonly ChinaRegion[], knobs: ClimateKnobs): Agreement {
  const out: Agreement = { exact: 0, withinOne: 0, cells: 0, misses: [] };
  for (const region of regions) {
    for (const m of MONTHS) {
      const curated = REGION_MONTHS[region][m].fit as DerivedFit;
      const derived = regionFit(region, m, knobs);
      out.cells += 1;
      if (curated === derived) out.exact += 1;
      else out.misses.push(`${region}[${m}] ${curated}->${derived}`);
      if (Math.abs(BAND_RANK[curated] - BAND_RANK[derived]) <= 1) out.withinOne += 1;
    }
  }
  return out;
}

describe("calibration record", () => {
  test("the curated table never uses unknown, so exact-band agreement is well defined", () => {
    for (const region of [...TUNING_REGIONS, ...HOLDOUT_REGIONS]) {
      for (const cell of REGION_MONTHS[region]) expect(cell.fit).not.toBe("unknown");
    }
  });

  test("the split is the spec's: tuned on East, Northwest, Central; four regions held out", () => {
    expect([...TUNING_REGIONS].sort()).toEqual(["Central", "East", "Northwest"]);
    expect([...HOLDOUT_REGIONS].sort()).toEqual(["North", "Northeast", "South", "Southwest"]);
    // Every region has at least one anchor in the fixture, and the anchors'
    // roles agree with the split — a holdout anchor printed by the sampling
    // script would have leaked into tuning.
    for (const c of CITIES) {
      if (c.role === "symptom") expect(c.region).toBeNull();
      if (c.role === "tuning") expect(TUNING_REGIONS).toContain(c.region);
      if (c.role === "holdout") expect(HOLDOUT_REGIONS).toContain(c.region);
    }
  });

  test("tuning agreement (36 cells) — pinned so a re-tune has to say so", () => {
    const untuned = agreement(TUNING_REGIONS, FIRST_GUESS_KNOBS);
    const tuned = agreement(TUNING_REGIONS, KNOBS);
    expect(untuned.cells).toBe(36);
    expect(tuned.cells).toBe(36);
    expect(untuned.exact).toBe(22);
    expect(untuned.withinOne).toBe(34);
    expect(tuned.exact).toBe(30);
    expect(tuned.withinOne).toBe(36);
    // The six tuning misses, so a re-tune can see what it traded.
    expect(tuned.misses).toEqual([
      "East[8] ok->great",
      "Northwest[0] poor->avoid",
      "Northwest[11] poor->avoid",
      "Central[1] poor->ok",
      "Central[7] avoid->poor",
      "Central[8] ok->great",
    ]);
    // Five knobs moved; everything else is the prior.
    const moved = (Object.keys(KNOBS) as (keyof ClimateKnobs)[]).filter((k) => KNOBS[k] !== FIRST_GUESS_KNOBS[k]);
    expect(moved.sort()).toEqual(["cloudKneePct", "cloudSpanPct", "coldKneeHiC", "coldSpanHiC", "muggyKneeC"]);
  });

  test("holdout agreement (48 cells) — scored once, pinned exactly", () => {
    // Scored ONCE, on 2026-09-04, after the knobs were frozen. The spec's
    // figures were 25/48 → 35/48; this model's are below, as they came out.
    // A re-tune must not touch these cells while tuning — it re-scores once,
    // then rewrites these numbers with whatever it got.
    const untuned = agreement(HOLDOUT_REGIONS, FIRST_GUESS_KNOBS);
    const tuned = agreement(HOLDOUT_REGIONS, KNOBS);
    expect(untuned.cells).toBe(48);
    expect(tuned.cells).toBe(48);
    expect(untuned.exact).toBe(26);
    expect(untuned.withinOne).toBe(45);
    expect(tuned.exact).toBe(30);
    expect(tuned.withinOne).toBe(45);
    expect(tuned.misses).toEqual([
      "North[0] poor->avoid",
      "North[1] poor->avoid",
      "North[5] ok->great",
      "North[6] ok->poor",
      "North[10] ok->poor",
      "North[11] poor->avoid",
      "Northeast[0] ok->avoid",
      "Northeast[1] ok->avoid",
      "Northeast[2] poor->avoid",
      "Northeast[10] poor->avoid",
      "Northeast[11] ok->avoid",
      "South[1] ok->great",
      "South[2] ok->great",
      "South[4] ok->poor",
      "South[5] poor->avoid",
      "South[6] poor->avoid",
      "South[7] poor->avoid",
      "Southwest[5] ok->great",
    ]);
    // The three cells two bands out are Harbin's Ice Festival months —
    // §9.5's un-reproducible ones, where the discriminator is the festival.
    const twoBandsOut = tuned.misses.filter((m) => /ok->avoid|avoid->ok|great->poor|poor->great/.test(m));
    expect(twoBandsOut).toEqual(["Northeast[0] ok->avoid", "Northeast[1] ok->avoid", "Northeast[11] ok->avoid"]);
  });

  test("all nine region–anchor pairs, scored per pair, for comparison with §9.5's 78.7%", () => {
    let exact = 0;
    let cells = 0;
    for (const c of CITIES) {
      if (c.region === null) continue;
      for (const m of MONTHS) {
        cells += 1;
        if (fitOf(c, m) === REGION_MONTHS[c.region][m].fit) exact += 1;
      }
    }
    expect(cells).toBe(108);
    expect(exact).toBe(71);
  });
});
