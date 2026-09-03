import { GEONAMES_NO_DATA_ELEVATION } from "./cityShard";
import type { MonthFit } from "./months";
import type { ChinaRegion } from "./types";

/**
 * The fit model: one city's 60-int climate row → a `MonthFit` for one month.
 *
 * Spec §9.4:
 *
 *     penalty = heat(hi) + cold(hi, lo) + mugginess(td) + rain(precip) + cloud(clt)
 *     fit     = great | ok | poor | avoid, banded on penalty
 *
 * Pure. No I/O, no globals mutated, nothing cached. The row is the artifact
 * tuple `scripts/ingest-climate.mjs` writes — `[12 lo, 12 hi, 12 precip,
 * 12 cloud, 12 td]`, calendar-indexed, January at 0 in every block — and the
 * month is that same 0-based calendar index. `seasonIn` is never applied to
 * it: the rows come out of CHELSA calendar-ordered for both hemispheres, and
 * putting them through the hemisphere flip would read Sydney's January at
 * index 6 (spec §9.4).
 *
 * THIS IS A PROVISIONAL MODEL. Every constant below is a knob and every knob
 * will be re-tuned; the docblock's job is to say why each term has the shape
 * it has, and to keep the calibration record honest.
 *
 * ## Terms
 *
 * Every term is a hinge: zero until an input crosses its knee, then linear at
 * one band per `span`. So `heatSpanC: 4` reads "every 4 °C of daily high
 * above the knee costs one band". Terms add, and the sum is banded on fixed
 * edges — `< 1` great, `< 2` ok, `< 3` poor, else avoid — which the spec
 * leaves unstated and this module decides: **one unit of penalty is one
 * band.** The edges are constants and the spans are the knobs; tuning both
 * would be tuning the same thing twice.
 *
 *   - `heat`: the corrected daily high above `heatKneeC`.
 *   - `cold`: the corrected daily high below `coldKneeHiC`, plus the raw
 *     daily low below `coldKneeLoC`. Two knees because they measure different
 *     things: a 16 °C day with frost at night is a fine sightseeing day, a
 *     4 °C day is not, and the curated table agrees — it calls hi 16–18 great
 *     and hi ≤ 15 ok or worse almost regardless of the low.
 *   - `mugginess`: the corrected dew point above `muggyKneeC`. 18 °C is where
 *     the NWS scale turns from "comfortable" to "sticky"; 22 is "very humid",
 *     26 "oppressive".
 *   - `rain`: precipitation above a knee that is the city's own (fix 3).
 *   - `cloud`: cloud fraction above `cloudKneePct` (fix 1).
 *
 * ## The four fixes (spec §9.4)
 *
 * 1. **Cloud cover.** The term is here and does measurable work where the
 *    sky is the season: Tokyo's June rainy-season overcast (61%, +0.5),
 *    Nairobi's grey July (56%, +0.4), Cusco's wet-season cloud (67%, +0.7).
 *    It does NOT do what §9.4 promised for Lima. Sampled at
 *    Lima's own cell, CHELSA V2.1 `clt` reads the Jun–Sep garúa months at
 *    34–36% and Jan–Mar at 63–64% — the inverse of the sky over the city —
 *    and the inversion runs the length of the Peruvian coast (Trujillo 23 vs
 *    55, Ica 12 vs 55). The probe that vouched for fix 1 sampled January
 *    alone. Once cloud points the wrong way nothing else in the stored row
 *    separates Lima's season: the T−td depression is 5–6 °C in every month
 *    of its year and the diurnal range 3–5 °C, both flat, and the one signal
 *    left — a daily high of 18–19 °C in Jun–Sep — reads `great` on the very
 *    scale this model is fitted to (`lib/months.ts`, North April, lo 7 /
 *    hi 20, is `great`). So no honest monotone function of these five inputs
 *    marks Lima's winter down at all. One `test.fails` keeps the brief's
 *    name and says so.
 * 2. **Humidity bias correction**, in dew-point space, at read time. `hurs`
 *    runs low in humid climates (Iquitos 72% vs ~85% observed); the artifact
 *    carries the UNCORRECTED dew point so this can be retuned without a
 *    6.2 GB re-ingest. `correctedDewPoint` recovers RH from `td` and the
 *    month's mean temperature, multiplies it by `humidityGain` (85/72, the
 *    Iquitos ratio), caps at saturation, and re-derives the dew point. A gain
 *    rather than an offset so dry air is left alone: Dunhuang's −15 °C dew
 *    point moves by a fraction of a degree, Iquitos' by two and a half.
 * 3. **Climate-relative rain knee.** `rainKnee` is `rainRelative` × the
 *    city's WETTEST month, clamped to `[rainFloorMm, rainCapMm]`. Relative,
 *    so Nairobi's April (191 mm) and November (118 mm) both cost against its
 *    18–26 mm dry season; floored, so Dunhuang's 10 mm July costs nothing;
 *    capped, so Iquitos at 185–332 mm every month is not told every month is
 *    fine because every month is the same. The wettest month rather than the
 *    mean because the question a traveller asks is "is this the rainy
 *    season", and the season is defined by its peak.
 * 4. **Elevation-dependent temperature correction.** CHELSA's daily-high
 *    bias measures −1.94 °C overall and −3.62 °C above 2,000 m (§9.4), and
 *    §9.5 measured that applying the global figure made China agreement
 *    WORSE (35 → 29 of 48) — the curated table sits close to raw CHELSA in
 *    the lowlands. So the warming is zero below `elevWarmFromM`, rises at
 *    `elevWarmPerKmC` and caps at `elevWarmMaxC`; the lowland anchors get
 *    nothing, Kunming (1,892 m) +2.5 °C, Cusco (3,312 m) the cap. It is
 *    applied to the daily high only, which is the quantity that was
 *    measured. `usableElevation` treats `null`, anything non-finite and
 *    GeoNames' −9999 sentinel as "no elevation" — the sentinel through
 *    `GEONAMES_NO_DATA_ELEVATION`, not a second literal. The hinge already
 *    makes a negative elevation harmless; the guard is so the sentinel can
 *    never be mistaken for a depth by any future term either.
 *
 * ## Calibration record (spec §9.4's protocol)
 *
 * Calibration set: the curated `REGION_MONTHS` table (lib/months.ts), seven
 * regions × twelve months, against `data/climate-anchors.json` — CHELSA rows
 * sampled at §9.5's nine region–anchor pairs. A region with two anchors
 * (Northwest: Xi'an and Dunhuang; Southwest: Chengdu and Kunming) is scored
 * on the band of the MEAN of its anchors' penalties.
 *
 *   - Tuned on: East, Northwest, Central — 36 cells (Shanghai; Xi'an and
 *     Dunhuang; Wuhan). The four holdout regions (North, Northeast, South,
 *     Southwest — 48 cells; Beijing, Harbin, Guangzhou, Chengdu and
 *     Kunming) were not scored, printed or inspected until the knobs were
 *     frozen; the sampling script does not even print their rows. With one
 *     disclosed exception: before tuning began, the holdout pin in
 *     `lib/climateModel.test.ts` still held a `-1` placeholder, and its
 *     failure message printed the UNTUNED holdout aggregate once —
 *     `expected 26 to be -1`, the 26/48 recorded below. That is one scalar
 *     of a model nobody had tuned yet: it names no cell, no region and no
 *     direction, so it cannot say which knob to move or which way, and it
 *     cannot have steered the 30/48 that follows. The test was skipped from
 *     that moment until the knobs were frozen.
 *   - Method: coordinate descent over a coarse grid, 60 random restarts,
 *     objective in order: no symptom-city test violated (those cities are
 *     not holdout), exact agreement, within-one agreement, fewest knobs
 *     moved from the first guess. The humidity gain and the elevation
 *     profile were held at their measured priors, not searched.
 *   - Untuned first guess (`FIRST_GUESS_KNOBS`, comfort-scale priors fixed
 *     before any scoring): 22/36 on the tuning cells (34 within one);
 *     26/48 on holdout (45 within one).
 *   - Tuned (`KNOBS`): 30/36 on the tuning cells (36 within one).
 *     **Holdout 30/48 exact (62.5%), 45/48 within one band (93.8%)**,
 *     scored once on 2026-09-04. Across all nine pairs, scored per pair:
 *     61/108 → 71/108 (65.7%).
 *   - **The spec's 35/48 was NOT reproduced.** §9.5 reports 25/48 → 35/48
 *     exact and 93.8% within one; this model matches the within-one figure
 *     to the cell and falls five short on exact. Reported as it came out;
 *     nothing was touched after the holdout was scored.
 *   - Holdout misses, 18 of 48, by cause:
 *       - Cold read as `avoid` where the table says poor or ok (9): North
 *         Jan, Feb, Dec and Nov (ok→poor); Northeast Jan, Feb, Mar, Nov,
 *         Dec. The table never uses `avoid` for cold — Beijing at −9/2 and
 *         Harbin at −24/−13 are poor and ok — while this cold hinge is
 *         unbounded. Northeast Jan, Feb and Dec are Harbin's Ice Festival
 *         months, the three cells §9.5 already calls un-reproducible: the
 *         discriminator is the festival, not the weather. The same overshoot
 *         shows on the TUNING set (Northwest Jan and Dec, poor→avoid), so a
 *         cap on the cold term at the poor/avoid edge is the first candidate
 *         for the next re-tune — visible before the holdout, not chosen
 *         from it.
 *       - Humid-subtropical summer stacked past poor (4): South May
 *         (ok→poor) and Jun, Jul, Aug (poor→avoid). Heat, mugginess, rain
 *         and cloud all fire on Guangzhou at once, and the plain sum
 *         overshoots.
 *       - Too generous by a month or a note (5): South Feb and Mar
 *         (ok→great; the table's ok is "CNY crowds; coastal mist"), North
 *         Jun and Southwest Jun (ok→great; "Getting hot", "Rainy season
 *         starts", each a month before the data shows it), North Jul
 *         (ok→poor, 2.03 — three hundredths over the edge).
 *   - The table's only two `avoid` cells, Wuhan Jul and Aug, are in the
 *     tuning set: July is reproduced (3.4), August reads poor (2.02).
 *
 * `lib/climateModel.test.ts` pins all of these numbers. A re-tune that
 * changes them has to change the test, in the open.
 */

export type DerivedFit = Exclude<MonthFit, "unknown">;

export interface ClimateMonth {
  /** Mean daily minimum, °C. */
  lo: number;
  /** Mean daily maximum, °C. */
  hi: number;
  /** mm/month. */
  precip: number;
  /** Cloud area fraction, %. */
  cloud: number;
  /** Uncorrected dew point, °C — see `correctedDewPoint`. */
  td: number;
}

export interface ClimateKnobs {
  heatKneeC: number;
  heatSpanC: number;
  coldKneeHiC: number;
  coldSpanHiC: number;
  coldKneeLoC: number;
  coldSpanLoC: number;
  muggyKneeC: number;
  muggySpanC: number;
  /** Fix 2: multiplier on the RH recovered from `td`; 1 switches it off. */
  humidityGain: number;
  /** Fix 3: the knee as a fraction of the city's wettest month. */
  rainRelative: number;
  rainFloorMm: number;
  rainCapMm: number;
  rainSpanMm: number;
  cloudKneePct: number;
  cloudSpanPct: number;
  /** Fix 4: no warming below this elevation. */
  elevWarmFromM: number;
  elevWarmPerKmC: number;
  elevWarmMaxC: number;
}

export interface PenaltyTerms {
  heat: number;
  cold: number;
  mugginess: number;
  rain: number;
  cloud: number;
  total: number;
}

const MONTHS_PER_YEAR = 12;
const BLOCKS = 5;
const ROW_LENGTH = BLOCKS * MONTHS_PER_YEAR;
const LO = 0;
const HI = 1;
const PRECIP = 2;
const CLOUD = 3;
const TD = 4;

/** August–Roche–Magnus, the form the ingest derived `td` with. */
const MAGNUS_B = 17.625;
const MAGNUS_C = 243.04;

/** One unit of penalty is one band. Constants, not knobs — see the docblock. */
export const BAND_EDGES = { ok: 1, poor: 2, avoid: 3 } as const;

export const TUNING_REGIONS: readonly ChinaRegion[] = ["East", "Northwest", "Central"];
export const HOLDOUT_REGIONS: readonly ChinaRegion[] = ["North", "Northeast", "South", "Southwest"];

/**
 * The untuned first guess, kept so the calibration record is executable.
 * Fixed before any anchor was scored: the heat and cold knees from where
 * outdoor comfort turns, the mugginess scale from the NWS dew-point bands,
 * the humidity gain from §9.4's Iquitos figure, the elevation profile from
 * §9.4's measured bias above 2,000 m.
 */
export const FIRST_GUESS_KNOBS: ClimateKnobs = Object.freeze({
  heatKneeC: 29,
  heatSpanC: 4,
  coldKneeHiC: 15,
  coldSpanHiC: 6,
  coldKneeLoC: 0,
  coldSpanLoC: 8,
  muggyKneeC: 18,
  muggySpanC: 4,
  humidityGain: 85 / 72,
  rainRelative: 0.5,
  rainFloorMm: 40,
  rainCapMm: 150,
  rainSpanMm: 100,
  cloudKneePct: 60,
  cloudSpanPct: 20,
  // 500 m is also Chengdu's hard-coded elevation exactly, and Chengdu is a
  // HOLDOUT anchor: a re-tune that moves this knee moves a holdout cell.
  elevWarmFromM: 500,
  elevWarmPerKmC: 1.8,
  elevWarmMaxC: 4,
});

/**
 * The tuned knobs. See the calibration record above for how, and on what.
 * Five knobs moved from the first guess, all the rest are the priors: the
 * cold hinge sits where the curated table puts it (hi 15–16 is the great/ok
 * edge, hi 8–11 is poor), mugginess starts a degree later, and cloud starts
 * earlier (45% is "partly cloudy") on a gentler slope, one band per 30
 * points — the combination that keeps the rain knee at half the wettest
 * month, which Wuhan's June needs, while Nairobi's April still costs.
 */
export const KNOBS: ClimateKnobs = Object.freeze({
  ...FIRST_GUESS_KNOBS,
  coldKneeHiC: 21,
  coldSpanHiC: 5.5,
  muggyKneeC: 19,
  cloudKneePct: 45,
  cloudSpanPct: 30,
});

// ---------------------------------------------------------------------------
// Reading the row
// ---------------------------------------------------------------------------

/**
 * A malformed row is the caller's bug, not a gap in the data, and it throws —
 * the same line `tupleFor` draws. Returning a verdict for a 59-int row would
 * read December's cloud as January's dew point and nothing downstream could
 * tell. Integers, because the artifact is integers (spec §9.4: `PlacePopup`
 * interpolates `lo`/`hi` unformatted, so a float would render as `8.437°`).
 */
function assertRow(row: readonly number[]): void {
  if (!Array.isArray(row) || row.length !== ROW_LENGTH) {
    throw new Error(`climate row must be ${ROW_LENGTH} integers, got ${Array.isArray(row) ? row.length : typeof row}`);
  }
  for (let i = 0; i < ROW_LENGTH; i += 1) {
    if (!Number.isSafeInteger(row[i])) {
      throw new Error(`climate row[${i}] is not an integer: ${String(row[i])}`);
    }
  }
}

function assertMonth(month: number): void {
  if (!Number.isInteger(month) || month < 0 || month >= MONTHS_PER_YEAR) {
    throw new Error(`month must be a calendar index 0..11 (January is 0), got ${String(month)}`);
  }
}

/** One month's five values out of the row. Calendar index, January is 0. */
export function climateMonth(row: readonly number[], month: number): ClimateMonth {
  assertRow(row);
  assertMonth(month);
  return {
    lo: row[LO * MONTHS_PER_YEAR + month],
    hi: row[HI * MONTHS_PER_YEAR + month],
    precip: row[PRECIP * MONTHS_PER_YEAR + month],
    cloud: row[CLOUD * MONTHS_PER_YEAR + month],
    td: row[TD * MONTHS_PER_YEAR + month],
  };
}

// ---------------------------------------------------------------------------
// Fix 4: elevation
// ---------------------------------------------------------------------------

/**
 * An elevation the correction may use, or null. `null` is the shard's own
 * "no elevation" (301 committed rows); the sentinel is what those rows
 * carried before 2026-09-03 and what a stale browser cache can still serve.
 */
export function usableElevation(elev: number | null | undefined): number | null {
  if (typeof elev !== "number" || !Number.isFinite(elev)) return null;
  if (elev === GEONAMES_NO_DATA_ELEVATION) return null;
  return elev;
}

/** °C to add to the daily high. Zero for no elevation and for the lowlands. */
export function elevationWarming(elev: number | null | undefined, knobs: ClimateKnobs = KNOBS): number {
  const metres = usableElevation(elev);
  if (metres === null) return 0;
  const above = Math.max(0, metres - knobs.elevWarmFromM);
  return Math.min(knobs.elevWarmMaxC, (above / 1000) * knobs.elevWarmPerKmC);
}

// ---------------------------------------------------------------------------
// Fix 2: humidity
// ---------------------------------------------------------------------------

const magnusGamma = (tempC: number): number => (MAGNUS_B * tempC) / (MAGNUS_C + tempC);

/**
 * The stored dew point with the humidity bias corrected, given the mean
 * temperature it was derived from (`(lo + hi) / 2` of the same month).
 *
 * Inverts the ingest's Magnus form to recover RH, scales it, caps it at
 * saturation, and runs the form forward again. The stored `td` is rounded to
 * a degree, so the recovered RH is approximate to a few points — fine for a
 * term that turns one band per `muggySpanC` degrees.
 */
export function correctedDewPoint(td: number, meanTempC: number, knobs: ClimateKnobs = KNOBS): number {
  const gammaT = magnusGamma(meanTempC);
  // ln(RH/100) = γ(td) − γ(T); rounding can put td a hair above T, so clamp.
  const relativeHumidity = Math.min(100, 100 * Math.exp(magnusGamma(td) - gammaT));
  const corrected = Math.min(100, relativeHumidity * knobs.humidityGain);
  const gamma = Math.log(corrected / 100) + gammaT;
  return (MAGNUS_C * gamma) / (MAGNUS_B - gamma);
}

// ---------------------------------------------------------------------------
// Fix 3: rain
// ---------------------------------------------------------------------------

/** The rain knee for this city, mm/month: relative to its wettest month, inside the corridor. */
export function rainKnee(row: readonly number[], knobs: ClimateKnobs = KNOBS): number {
  assertRow(row);
  let wettest = 0;
  for (let m = 0; m < MONTHS_PER_YEAR; m += 1) {
    wettest = Math.max(wettest, row[PRECIP * MONTHS_PER_YEAR + m]);
  }
  return Math.min(knobs.rainCapMm, Math.max(knobs.rainFloorMm, knobs.rainRelative * wettest));
}

// ---------------------------------------------------------------------------
// The penalty, and the band
// ---------------------------------------------------------------------------

/** Bands per unit above the knee; zero below it. */
const above = (value: number, knee: number, span: number): number => Math.max(0, value - knee) / span;
const below = (value: number, knee: number, span: number): number => Math.max(0, knee - value) / span;

export function bandOf(penalty: number): DerivedFit {
  if (!Number.isFinite(penalty) || penalty < 0) {
    throw new Error(`penalty must be a finite non-negative number, got ${String(penalty)}`);
  }
  if (penalty < BAND_EDGES.ok) return "great";
  if (penalty < BAND_EDGES.poor) return "ok";
  if (penalty < BAND_EDGES.avoid) return "poor";
  return "avoid";
}

/** Every term for one month, so a caller (or a test) can see WHY a month scored as it did. */
export function penaltyOf(
  row: readonly number[],
  elev: number | null | undefined,
  month: number,
  knobs: ClimateKnobs = KNOBS,
): PenaltyTerms {
  const { lo, hi, precip, cloud, td } = climateMonth(row, month);
  const high = hi + elevationWarming(elev, knobs);
  const dewPoint = correctedDewPoint(td, (lo + hi) / 2, knobs);
  const heat = above(high, knobs.heatKneeC, knobs.heatSpanC);
  const cold = below(high, knobs.coldKneeHiC, knobs.coldSpanHiC) + below(lo, knobs.coldKneeLoC, knobs.coldSpanLoC);
  const mugginess = above(dewPoint, knobs.muggyKneeC, knobs.muggySpanC);
  const rain = above(precip, rainKnee(row, knobs), knobs.rainSpanMm);
  const cloudiness = above(cloud, knobs.cloudKneePct, knobs.cloudSpanPct);
  return { heat, cold, mugginess, rain, cloud: cloudiness, total: heat + cold + mugginess + rain + cloudiness };
}

/** The verdict. Never `unknown`: that is the absence marker, and a row is presence. */
export function monthFit(
  row: readonly number[],
  elev: number | null | undefined,
  month: number,
  knobs: ClimateKnobs = KNOBS,
): DerivedFit {
  return bandOf(penaltyOf(row, elev, month, knobs).total);
}
