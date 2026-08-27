import countryFactsJson from "../data/country-facts.json";

/**
 * The reader for `data/country-facts.json` — the CC0 Wikidata artifact the
 * T25 ingest built and a human committed.
 *
 * Structured after lib/countryImagery.ts, deliberately and for the same two
 * reasons: the data is bundled by a static import rather than read from disk
 * (serverless deployments have no `data/` directory, and the wizard preview
 * generates client-side), and the file is a GENERATED artifact, so this module
 * is the only thing standing between an upstream shape change and a sentence
 * shown to a traveller.
 *
 * Two rules govern everything below.
 *
 * **The boundary drops, it never repairs.** A value that fails its shape check
 * is discarded, not coerced: `"220"` does not become `220`, `"pen"` does not
 * become `"PEN"`, `["A", "BB"]` does not become `["A"]`. Repairing invents
 * data, and a repaired fact is indistinguishable from a real one by the time
 * it reaches a template. Dropping produces the honest gap that
 * lib/countryTips.ts is built to name out loud, so a dropped record is never
 * silent — it surfaces as the gap note listing every field it lost.
 *
 * **Copy on read.** `countryProfile.test.ts:45-50` pins that a profile hands
 * out fresh objects whose arrays a caller may mutate without corrupting the
 * curated tables for everyone else. `COUNTRY_FACTS` is one shared object built
 * once at module load, so that contract survives only if every read copies.
 */

/** One emergency service number as the artifact carries it. */
export interface EmergencyNumber {
  /** Digits only, as dialled. Never a formatted or spaced variant. */
  readonly number: string;
  /**
   * `"police"`, `"fire"`, `"ambulance"`, `"rescue"`, `"emergency"` — or null
   * for a general number upstream gives no role for. Measured 2026-08-27: 69
   * of the 221 countries carrying emergency numbers carry only roleless ones,
   * and no country mixes roled and roleless entries. Null is a fact about the
   * number, not a gap.
   */
  readonly role: string | null;
}

/**
 * One country's facts. Every field is optional and **absent when unknown** —
 * never an empty array, an empty string or a sentinel. The templates in
 * lib/countryTips.ts read absence directly, so an empty value here would
 * render as a broken sentence where an absent one renders as nothing at all.
 */
export interface CountryFacts {
  /** ISO 4217 alpha-3, e.g. `"PEN"`. */
  readonly currencyCode?: string;
  /**
   * The currency's own upstream label, e.g. `"Nuevo sol"`.
   *
   * **Carried, validated, and never rendered.** See the block comment below on
   * why the money templates render only `currencyCode`. Treat this like `lat`:
   * a field the artifact ships that no template may put before a traveller.
   */
  readonly currencyName?: string;
  /** Sorted IEC plug-type letters, e.g. `["A", "B", "C"]`. */
  readonly plugs?: readonly string[];
  /** Mains voltage, e.g. `220`. */
  readonly voltageV?: number;
  readonly drivingSide?: "left" | "right";
  readonly emergency?: readonly EmergencyNumber[];
  /** Official languages, alphabetical. Upstream states no primacy and neither does this. */
  readonly officialLanguages?: readonly string[];
  /** E.164 country calling code with its plus, e.g. `"+51"`. */
  readonly callingCode?: string;
  /**
   * Centroid latitude. Never rendered: its only consumer is the `SOUTHERN`
   * cross-check in lib/countryFacts.test.ts.
   */
  readonly lat?: number;
}

/** Keyed by uppercase ISO 3166-1 alpha-2. */
export type CountryFactsIndex = Readonly<Record<string, CountryFacts>>;

/*
 * WHY THE MONEY TEMPLATES RENDER `currencyCode` AND NEVER `currencyName`.
 *
 * T25 measured it: Peru's committed `currencyName` is `"Nuevo sol"`, which is
 * the pre-2015 name — Peru dropped "nuevo" that year and the unit is now the
 * sol. So the artifact publishes a label that is simply wrong, and it publishes
 * 238 more that nobody has checked.
 *
 * A one-country correction would fix the country we happened to look at and
 * leave the class untouched, which is the worse outcome: it makes the field
 * feel verified. An ISO 4217 code is a different kind of value — it is
 * validated by shape, it is stable by treaty, it is what `lib/money.ts` pivots
 * on, and it cannot go stale the way a name can. So `currencyName` joins `lat`
 * as a field this module carries and no template may read.
 *
 * `countryTips.test.ts` holds the line with a test that no template output for
 * any country contains that country's `currencyName`, armed with PE's known-
 * wrong `"Nuevo sol"` as its positive case. That is stronger than a comment,
 * because the day someone reaches for the nicer-reading label it goes red.
 */

/**
 * Hand-verified overrides, applied per field and winning over the artifact.
 *
 * Empty, and that is the intended steady state rather than an unfinished job.
 * `scripts/ingest-country-facts.mjs` carries its own `CURATED_FACTS` for the
 * five countries whose UPSTREAM shape defeats the withhold rules (NL, FR, PL,
 * ZW, MO); those are repaired before the artifact is written. This table is
 * the different escape hatch — it can override a value the artifact already
 * publishes, which the ingest's table structurally cannot, because a row there
 * whose field upstream supplies is judged *stale* and refuses the write.
 *
 * The one candidate found so far was Peru's stale `currencyName`, and the
 * answer was not a row here — see the block comment above. Correcting the one
 * country somebody checked would have made 238 unchecked labels look verified.
 *
 * The `CURATED_HEROES` precedent (lib/countryImagery.ts:69) governs the rules:
 * a row is written only when a human verified it, and every row passes through
 * the same boundary as an ingested one, so a malformed override is dropped
 * rather than trusted for being hand-written. `countryTips.test.ts` pins both.
 */
export const CURATED_FACTS: CountryFactsIndex = {};

/**
 * Longest a fact string may be.
 *
 * Measured against the committed artifact on 2026-08-27: the longest
 * `currencyName` is 27 characters and the longest official language is 31, so
 * nothing legitimate is near this. The ceiling exists because the file is
 * called country-FACTS and that name is a guardrail — the failure this whole
 * design is shaped to prevent is a SENTENCE arriving from upstream and being
 * rendered as advice. Paired with the prose check below, which is the same
 * signature lib/countryFacts.test.ts scans the raw artifact for.
 */
export const MAX_FACT_TEXT_LENGTH = 80;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const normaliseCode = (code: unknown): string =>
  typeof code === "string" ? code.trim().toUpperCase() : "";

const isCode = (value: string): boolean => /^[A-Z]{2}$/.test(value);

/**
 * A short label, not prose. Rejects anything carrying a full stop followed by
 * whitespace — the shape of a sentence — or padded with whitespace, which is
 * the one thing this module will not quietly tidy away.
 */
const factText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  if (value.length === 0 || value.length > MAX_FACT_TEXT_LENGTH) return undefined;
  if (value !== value.trim()) return undefined;
  if (/\.\s/.test(value)) return undefined;
  return value;
};

/**
 * Every element valid, or the whole field is dropped.
 *
 * Filtering the bad elements out and keeping the rest would be a repair, and a
 * quietly destructive one: `["A", "BB"]` reduced to `["A"]` states that a
 * country uses exactly one plug type, which upstream never said.
 */
function allOrNothing<T>(value: unknown, read: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: T[] = [];
  for (const item of value) {
    const parsed = read(item);
    if (parsed === undefined) return undefined;
    out.push(parsed);
  }
  return out;
}

/**
 * A language, not a Wikidata category about languages.
 *
 * Measured 2026-08-27 across the committed artifact's 215 distinct language
 * values: exactly one is not a language. Guinea's P37 includes Q35759,
 * *"languages of Guinea"* — a meta-item — beside French, and rendered by
 * `languageTip` it reads "languages of Guinea is the official language". That
 * is risk 2 of the design ("a template renders a true fact into a false
 * sentence") arriving in real data on the first build.
 *
 * The value is refused rather than filtered out of the list, because
 * `allOrNothing` is what stops a filter from silently strengthening a claim:
 * keeping French alone would state that French is Guinea's *only* official
 * language, which is an assertion this module would be making, not reading.
 * So Guinea loses the field and the gap note says so out loud.
 *
 * The upstream fix belongs to the ingest's extract; `countryTips.test.ts` pins
 * the drop by name, so the day the artifact stops carrying the meta-item this
 * goes red and the rule can be deleted rather than rotting.
 */
const languageName = (value: unknown): string | undefined => {
  const text = factText(value);
  if (text === undefined) return undefined;
  return /^languages? of /i.test(text) ? undefined : text;
};

/** A single IEC plug-type letter. Measured set in the artifact: A, B, C, E–L, N. */
const plugLetter = (value: unknown): string | undefined =>
  typeof value === "string" && /^[A-Z]$/.test(value) ? value : undefined;

/**
 * Mains voltage, bounded to a range a socket plausibly carries.
 *
 * The 100–260 band mirrors the allowlist in scripts/ingest-country-facts.mjs,
 * which is what turns Belize's upstream `550/220` into a withhold rather than
 * into "Belize runs at 550 V". Stated in both places on purpose: the ingest
 * gate protects the artifact, this one protects the render from an artifact
 * edited by hand or served from a stale deploy. A test asserts every voltage
 * in the committed file passes here, so the two cannot drift apart silently.
 */
const voltage = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 260
    ? value
    : undefined;

const emergencyNumber = (value: unknown): EmergencyNumber | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  if (typeof record.number !== "string" || !/^\d{2,6}$/.test(record.number)) return undefined;
  const number = record.number;
  // Absent and null both spell "upstream gave no role", and `null` is how this
  // type spells it. Mapping one to the other is not a repair — no value is
  // invented, the absence is preserved under its own name.
  if (record.role === undefined || record.role === null) return { number, role: null };
  const role = factText(record.role);
  return role === undefined ? undefined : { number, role };
};

/**
 * One record, field by field. A field that fails its check is absent from the
 * result; a record that is not an object, or that ends up with no valid field
 * at all, yields null and is dropped whole by `readCountryFactsIndex`.
 */
export function readCountryFactsRecord(raw: unknown): CountryFacts | null {
  const record = asRecord(raw);
  if (!record) return null;

  const currencyCode =
    typeof record.currencyCode === "string" && /^[A-Z]{3}$/.test(record.currencyCode)
      ? record.currencyCode
      : undefined;
  const currencyName = factText(record.currencyName);
  const plugs = allOrNothing(record.plugs, plugLetter);
  const voltageV = voltage(record.voltageV);
  const drivingSide =
    record.drivingSide === "left" || record.drivingSide === "right" ? record.drivingSide : undefined;
  const emergency = allOrNothing(record.emergency, emergencyNumber);
  const officialLanguages = allOrNothing(record.officialLanguages, languageName);
  const callingCode =
    typeof record.callingCode === "string" && /^\+\d{1,4}$/.test(record.callingCode)
      ? record.callingCode
      : undefined;
  const lat =
    typeof record.lat === "number" && Number.isFinite(record.lat) && Math.abs(record.lat) <= 90
      ? record.lat
      : undefined;

  const facts: CountryFacts = {
    ...(currencyCode !== undefined ? { currencyCode } : {}),
    ...(currencyName !== undefined ? { currencyName } : {}),
    ...(plugs !== undefined ? { plugs } : {}),
    ...(voltageV !== undefined ? { voltageV } : {}),
    ...(drivingSide !== undefined ? { drivingSide } : {}),
    ...(emergency !== undefined ? { emergency } : {}),
    ...(officialLanguages !== undefined ? { officialLanguages } : {}),
    ...(callingCode !== undefined ? { callingCode } : {}),
    ...(lat !== undefined ? { lat } : {}),
  };
  return Object.keys(facts).length > 0 ? facts : null;
}

/**
 * Validate the ingest output at the boundary. A record that survives with no
 * usable field is not indexed at all — which is the same thing, to every
 * consumer, as a country the artifact never mentioned: `getCountryFacts`
 * answers with an empty record and the gap note names every missing field.
 */
export function readCountryFactsIndex(raw: unknown): CountryFactsIndex {
  const wrapper = asRecord(raw);
  if (!wrapper) return {};
  const entries = asRecord(wrapper.countries) ?? wrapper;

  const index: Record<string, CountryFacts> = {};
  for (const [key, value] of Object.entries(entries)) {
    const code = normaliseCode(key);
    if (!isCode(code)) continue;
    const facts = readCountryFactsRecord(value);
    if (facts) index[code] = facts;
  }
  return index;
}

/**
 * Bundled rather than read from disk at request time, mirroring
 * lib/countryImagery.ts:181 and lib/server/catalog.ts: serverless deployments
 * have no data/ directory, and components/PlanStep.tsx generates the wizard
 * preview in the browser.
 */
export const COUNTRY_FACTS: CountryFactsIndex = readCountryFactsIndex(countryFactsJson);

export interface CountryFactsOptions {
  /** Ingested facts. Defaults to the committed artifact. */
  readonly facts?: CountryFactsIndex;
  /** Hand-picked overrides, which win field by field. Defaults to `CURATED_FACTS`. */
  readonly curated?: CountryFactsIndex;
}

/**
 * Total function: every code yields a record, and an unknown code, a dropped
 * record or junk yields an empty one rather than null. Callers read absence
 * per field instead of branching on whether the country exists, which is what
 * makes "we have nothing for this country" and "we have four of seven fields"
 * the same code path.
 *
 * Curated overrides win **field by field** rather than wholesale, mirroring
 * `pickHero`'s precedence over usable values: a one-field override does not
 * blank the six ingested fields beside it. Both sides pass through the same
 * validator, so a malformed hand-written row is dropped exactly like a
 * malformed ingested one — an index handed in through `options` gets no more
 * trust than the bundled artifact, which is `pickHero`'s rule too.
 *
 * **Re-reading through the boundary is what makes this copy-on-read**, and it
 * is load-bearing rather than incidental: `readCountryFactsRecord` builds a
 * new object and a new array for every field it accepts, so nothing a caller
 * mutates can reach `COUNTRY_FACTS`. Returning the stored record here — or
 * memoising this function — would hand out the shared table and break
 * `countryProfile.test.ts:45-50`'s fresh-object contract the moment T27 wires
 * this in. There is deliberately no separate copy step to keep in sync with
 * the field list: a second copier would go stale the day a field is added,
 * and it would be dead code until then.
 */
export function getCountryFacts(code: string, options: CountryFactsOptions = {}): CountryFacts {
  const key = normaliseCode(code);
  if (!isCode(key)) return {};

  const ingested = readCountryFactsRecord(asRecord(options.facts ?? COUNTRY_FACTS)?.[key]);
  const curated = readCountryFactsRecord(asRecord(options.curated ?? CURATED_FACTS)?.[key]);
  if (!ingested && !curated) return {};
  return { ...(ingested ?? {}), ...(curated ?? {}) };
}
