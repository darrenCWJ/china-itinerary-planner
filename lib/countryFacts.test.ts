import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, test } from "vitest";
import {
  COUNTRY_CODES,
  EXPECTED_COUNTRIES,
  MIN_FIELD_COVERAGE,
  PLUG_LETTER_SET,
  REQUIRED_NAMES,
  RENDERED_FIELDS,
} from "@/scripts/ingest-country-facts.mjs";

/**
 * The COMMITTED artifact, checked as data rather than as code.
 *
 * scripts/ingest-country-facts.test.ts proves the rules; this file proves the
 * file those rules produced on 2026-08-27 and that a human then committed.
 * They are different questions: every gate can be correct while the artifact
 * on disk is a stale copy from before a rule existed, and every number in a
 * doc-comment can be true while the file it describes was never rebuilt.
 *
 * Every figure asserted below was produced by that run. None of them is
 * carried forward from the design's prototype — the design's own note on this
 * is explicit ("re-measure, do not carry the number forward untested"), and
 * the prototype was wrong about four of them: currency coverage (its `en`-only
 * label filter dropped every eurozone country), plug coverage (it assumed a
 * letter for BS 546), latitude coverage, and the artifact's size.
 */
const FACTS_PATH = join(process.cwd(), "data", "country-facts.json");
const SHARD_DIR = join(process.cwd(), "public", "cities");

/**
 * The artifact is a committed build artefact, not source: `npm ci` does not
 * produce it and `scripts/ingest-country-facts.mjs` needs network egress. A
 * checkout without it skips here rather than failing, which is the house
 * precedent (lib/cityShard.test.ts, lib/isoTopology.test.ts) and is the
 * difference between "this went unchecked" and "this is broken".
 */
const hasAssets = existsSync(FACTS_PATH);

type EmergencyNumber = { number: string; role: string | null };
type CountryFacts = {
  name?: string;
  currencyCode?: string;
  currencyName?: string;
  plugs?: string[];
  voltageV?: number;
  drivingSide?: string;
  emergency?: EmergencyNumber[];
  officialLanguages?: string[];
  callingCode?: string;
  lat?: number;
};
type Artifact = {
  generatedAt: string;
  source: string;
  license: string;
  countries: Record<string, CountryFacts>;
};

const artifact: Artifact | null = hasAssets
  ? (JSON.parse(readFileSync(FACTS_PATH, "utf8")) as Artifact)
  : null;

/**
 * Per-field coverage the shipping query produced on 2026-08-27, exact.
 *
 * Pinned exactly rather than as floors, and that is deliberate even though
 * `MIN_FIELD_COVERAGE` already carries floors: a floor answers "has this
 * collapsed", and an exact pin answers "is the committed file the one that run
 * produced". A rebuild that legitimately moves a number changes one line here
 * next to the artifact it describes, which is a diff a reviewer can read.
 */
const MEASURED_COVERAGE: Record<string, number> = {
  name: 246,
  currencyCode: 239,
  currencyName: 239,
  plugs: 207,
  voltageV: 221,
  drivingSide: 245,
  emergency: 221,
  officialLanguages: 243,
  callingCode: 237,
  lat: 246,
};

/**
 * Measured: 70,443 bytes for 246 countries, 2,098 facts and 246 names, 10,387
 * gzipped.
 *
 * The design's prototype said 50,265 and said to re-measure rather than carry
 * it forward; the real figure is 40% larger, mostly because 243 countries
 * carry their official languages and `currencyName` ships beside every code.
 * Adding the country name cost 4,927 bytes — 1,440 gzipped — which is the
 * price of every gap note and every packing line naming a country instead of
 * a two-letter code.
 *
 * The budget matters because this file reaches the BROWSER —
 * components/PlanStep.tsx generates the wizard preview client-side, and
 * serving guidance server-only would reintroduce the preview/saved-trip
 * disagreement this whole work exists to fix. For scale:
 * data/country-images.json is 6,505 bytes and fine, and
 * lib/server/cityIndex.ts is 3.65 MB and explicitly forbidden from client
 * components. The budget STAYS at 80 KB rather than moving up with the
 * measurement: 12% of headroom is still room for real upstream growth and is
 * now much less room for a shape change, which is the direction a budget
 * should travel. The next field that costs 5 KB should have to argue for
 * itself here.
 *
 * NOT ASSERTED, and stated so it is not assumed: the gzipped size. It is
 * measured (10,387 bytes) and recorded, and nothing here or anywhere else in
 * the repo checks it.
 */
const MAX_ARTIFACT_BYTES = 80_000;

describe("COUNTRY_CODES is the app's shard universe", () => {
  const hasShards = existsSync(SHARD_DIR);

  test.skipIf(!hasShards)("equals the committed city shards exactly, in both directions", () => {
    // A derived contract, not a restatement: the ingest asks Wikidata about a
    // hard-coded list, and the only thing making that list the RIGHT list is
    // this check. A shard added without a row here is a country that silently
    // never gets facts; a row here without a shard is a country whose facts
    // nothing can ever read.
    const shards = readdirSync(SHARD_DIR)
      .filter((file) => /^[A-Z]{2}\.json$/.test(file))
      .map((file) => file.slice(0, 2))
      .sort();
    expect(shards).toHaveLength(EXPECTED_COUNTRIES);
    expect(COUNTRY_CODES).toEqual(shards);
  });
});

describe.skipIf(!hasAssets)("the committed data/country-facts.json", () => {
  test("carries 246 countries under a CC0 envelope", () => {
    expect(Object.keys(artifact!.countries)).toHaveLength(EXPECTED_COUNTRIES);
    expect(artifact!.license).toBe("CC0-1.0");
    expect(artifact!.source).toBe("Wikidata (CC0)");
    expect(artifact!.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Sorted keys, or a rebuild with no data change rewrites the file and the
    // nightly job commits and redeploys production for nothing.
    const codes = Object.keys(artifact!.countries);
    expect([...codes].sort()).toEqual(codes);
  });

  test("reproduces China's answer, which a human wrote before this ingest existed", () => {
    // lib/packing.ts:64 says "Universal power adapter (China uses type A/C/I
    // plugs, 220V)" and was written without ever seeing Wikidata. This is the
    // one country where a wrong upstream edit is DETECTABLE rather than merely
    // plausible, and it is not self-referential: CN's P2853 values are
    // Europlug + NEMA 1-15 + AS/NZS 3112, which sort to exactly A, C and I.
    const cn = artifact!.countries.CN;
    expect(cn.name).toBe(REQUIRED_NAMES.CN);
    expect(cn.currencyCode).toBe("CNY");
    expect(cn.plugs).toEqual(["A", "C", "I"]);
    expect(cn.voltageV).toBe(220);
    expect(cn.drivingSide).toBe("right");
    expect(cn.callingCode).toBe("+86");
    expect(cn.emergency).toEqual([
      { number: "110", role: "police" },
      { number: "119", role: "fire" },
      { number: "120", role: "ambulance" },
    ]);
  });

  test("reproduces Peru's answer, the design's acceptance case", () => {
    const pe = artifact!.countries.PE;
    // "Peru", not "PE". Wiring the gap note before this field existed would
    // have rendered "We don't have PE-specific guidance" for 222 countries.
    expect(pe.name).toBe("Peru");
    expect(pe.name).toBe(REQUIRED_NAMES.PE);
    expect(pe.currencyCode).toBe("PEN");
    expect(pe.plugs).toEqual(["A", "B", "C"]);
    expect(pe.voltageV).toBe(220);
    expect(pe.drivingSide).toBe("right");
    expect(pe.callingCode).toBe("+51");
    const byRole = new Map((pe.emergency ?? []).map((entry) => [entry.role, entry.number]));
    expect(byRole.get("police")).toBe("105");
    expect(byRole.get("fire")).toBe("116");
    // 106 and 117 are both roled `ambulance` upstream; the design pins 106 and
    // the ingest keeps both, so this asserts presence rather than the pair.
    expect((pe.emergency ?? []).map((entry) => entry.number)).toContain("106");
    expect(pe.officialLanguages).toContain("Spanish");
  });

  test("has the per-field coverage the shipping query measured", () => {
    const records = Object.values(artifact!.countries);
    for (const [field, expected] of Object.entries(MEASURED_COVERAGE)) {
      const covered = records.filter((record) => record[field as keyof CountryFacts] !== undefined).length;
      expect(covered, `${field} coverage`).toBe(expected);
      // And the floor the ingest itself enforces, so the two cannot drift into
      // saying different things about the same field.
      const floor = (MIN_FIELD_COVERAGE as Record<string, number>)[field];
      expect(covered, `${field} against its floor`).toBeGreaterThanOrEqual(floor);
    }
  });

  test("has real gaps: countries missing a rendered field, and no country carrying an empty one", () => {
    // The honest-gap rule made checkable. If every country had every field,
    // either the world is simpler than it is or the withhold rules stopped
    // withholding — and a coverage floor cannot see the second, because floors
    // only ever count downwards.
    const records = Object.entries(artifact!.countries);
    const withGaps = records.filter(([, record]) =>
      RENDERED_FIELDS.some((field) => record[field as keyof CountryFacts] === undefined)
    );
    expect(withGaps.length).toBeGreaterThan(0);
    // Measured 2026-08-27: 187 of 246 carry all seven, 31 carry six, 12 five,
    // 10 four and 6 three or fewer. Pinned as the complement, so a build where
    // the gaps quietly disappeared fails here.
    expect(records.length - withGaps.length).toBe(187);
    // ABSENT, never empty. An empty array or an empty string would render as a
    // broken sentence where an absent field renders as nothing at all.
    for (const [code, record] of records) {
      expect(record.plugs?.length ?? 1, `${code}.plugs`).toBeGreaterThan(0);
      expect(record.emergency?.length ?? 1, `${code}.emergency`).toBeGreaterThan(0);
      expect(record.officialLanguages?.length ?? 1, `${code}.officialLanguages`).toBeGreaterThan(0);
      expect(JSON.stringify(record), code).not.toMatch(/""/);
    }
  });

  test("every record names its country, and no record is only a name", () => {
    // Two halves of one rule. `name` is identity, so every record carries one;
    // and it is not a fact, so it can never be the only thing keeping a record
    // in the file — a country we know nothing else about falls through to the
    // neutral profile instead, which is what the ingest's `factCount` enforces.
    for (const [code, record] of Object.entries(artifact!.countries)) {
      expect(typeof record.name, code).toBe("string");
      expect(record.name!.trim(), code).toBe(record.name);
      expect(record.name!.length, code).toBeGreaterThan(1);
      const facts = Object.keys(record).filter((field) => field !== "name");
      expect(facts.length, `${code} carries only a name`).toBeGreaterThan(0);
    }
    // Guinea's meta-item is gone from the extract, so the reader's language
    // rule has nothing left to refuse in the committed file.
    expect(artifact!.countries.GN?.officialLanguages).toEqual(["French"]);
  });

  test("every plug letter is one the hand-checked standard table can emit", () => {
    for (const [code, record] of Object.entries(artifact!.countries)) {
      for (const letter of record.plugs ?? []) expect(PLUG_LETTER_SET.has(letter), `${code} ${letter}`).toBe(true);
    }
  });

  test("carries no prose — this file is called country-FACTS and that name is a guardrail", () => {
    // A sentence reaching a traveller from upstream is the failure the whole
    // design is shaped to prevent. Nothing here should contain a full stop
    // followed by a space, and nothing should be long enough to be a clause.
    for (const [code, record] of Object.entries(artifact!.countries)) {
      for (const value of JSON.stringify(record).match(/"[^"]*"/g) ?? []) {
        expect(value, `${code}: ${value}`).not.toMatch(/\.\s/);
        expect(value.length, `${code}: ${value}`).toBeLessThanOrEqual(82);
      }
    }
  });

  test("stays inside a byte budget a client bundle will not notice", () => {
    // There is no byte budget on any other data/*.json in this repo. This one
    // has it because the artifact reaches the browser.
    const bytes = statSync(FACTS_PATH).size;
    expect(bytes, `data/country-facts.json is ${bytes} bytes`).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES);
    // The positive half: a budget passes perfectly on an empty file.
    expect(bytes).toBeGreaterThan(40_000);
  });
});

/**
 * lib/countries.ts's hand-written `SOUTHERN` list, re-derived from source.
 *
 * Read out of the file rather than imported, because `SOUTHERN` is
 * module-private and the design is explicit that it is NOT retired: it encodes
 * a judgement ("countries straddling the equator are listed by where their
 * travel season actually falls") that a centroid latitude would overrule, and
 * lib/isoTopology.test.ts already scans the same block. The regex approach is
 * that file's precedent, not a new one.
 */
function southernCodes(): string[] {
  const source = readFileSync(join(process.cwd(), "lib", "countries.ts"), "utf8");
  const block = /const SOUTHERN = new Set\(\[([\s\S]*?)\]\)/.exec(source);
  if (!block) throw new Error("could not find the SOUTHERN block in lib/countries.ts");
  return [...block[1].matchAll(/"([A-Z]{2})"/g)].map((match) => match[1]);
}

/**
 * The only consumer of the ingested `lat` field. It is never rendered.
 *
 * Measured 2026-08-27 against the committed artifact: of the 34 codes in
 * `SOUTHERN`, exactly one has a non-negative centroid — KE at +0.1, Kenya
 * straddling the equator with its travel season set by the southern half. The
 * design predicted ID, KE, BR and CD would be candidates; only KE actually is,
 * and the other three have negative centroids. So the exception list is one
 * country long, and it is named rather than tolerated as a range.
 */
const EQUATOR_STRADDLERS = new Set(["KE"]);

describe.skipIf(!hasAssets)("SOUTHERN cross-check", () => {
  test("every hand-listed southern country really is south, or is a named straddler", () => {
    const southern = southernCodes();
    // Arming: the loop below passes vacuously on an empty list, and
    // lib/isoTopology.test.ts already pins this block at >= 30 codes.
    expect(southern.length).toBeGreaterThanOrEqual(30);
    const wrong: string[] = [];
    let checked = 0;
    for (const code of southern) {
      const lat = artifact!.countries[code]?.lat;
      expect(lat, `${code} has no latitude in the artifact`).toBeTypeOf("number");
      checked++;
      if (lat! >= 0 && !EQUATOR_STRADDLERS.has(code)) wrong.push(`${code}=${lat}`);
    }
    expect(checked).toBe(southern.length);
    expect(wrong, `listed as southern but not south of the equator: ${wrong.join(", ")}`).toEqual([]);
  });

  test("each named straddler is still a straddler, so the exception cannot rot", () => {
    // An exception list that no longer excepts anything is cruft nobody
    // re-checks. If Wikidata moves KE's centroid south, this goes red and the
    // entry gets deleted rather than sitting there forever.
    for (const code of EQUATOR_STRADDLERS) {
      const lat = artifact!.countries[code]?.lat;
      expect(lat, `${code} is on the exception list but no longer needs to be`).toBeGreaterThanOrEqual(0);
      expect(lat, `${code} is too far north to be called a straddler`).toBeLessThan(5);
    }
  });
});

// ---------------------------------------------------------------------------
// The bundle constraint — where the 70 KB is allowed to be reachable from
// ---------------------------------------------------------------------------

/**
 * Every non-test source file under lib/, components/ and app/.
 *
 * A source-level scan, which this repo uses for its structural contracts
 * (lib/contracts.test.ts) because the alternative — asserting a bundle size —
 * needs a build. Armed below against walking nothing.
 */
function sourceFiles(): { path: string; code: string }[] {
  const out: { path: string; code: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(process.cwd(), dir))) {
      const path = `${dir}/${entry}`;
      if (statSync(join(process.cwd(), path)).isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push({ path, code: readFileSync(join(process.cwd(), path), "utf8") });
      }
    }
  };
  for (const dir of ["lib", "components", "app"]) walk(dir);
  return out;
}

/** A VALUE import of a path — `import type` is erased and costs no bytes. */
const valueImportOf = (code: string, path: RegExp): boolean =>
  new RegExp(`import\\s+(?!type\\b)[^;]*from\\s+["'][^"']*${path.source}["']`).test(code);

describe("data/country-facts.json stays out of the bundles that only want a name", () => {
  const FILES = sourceFiles();

  test("the scan walks a real tree, or every check below is vacuous", () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.map((file) => file.path)).toContain("lib/countries.ts");
    expect(FILES.map((file) => file.path)).toContain("lib/countryFacts.ts");
  });

  test("exactly one module imports the artifact", () => {
    // 70 KB. Every module that imports this one inherits it, so the list of
    // importers is the list of bundles paying for it — and it is one module
    // long on purpose.
    const importers = FILES.filter((file) => valueImportOf(file.code, /country-facts\.json/));
    expect(importers.map((file) => file.path)).toEqual(["lib/countryFacts.ts"]);
  });

  test("lib/countries.ts is a zero-import leaf, which is what keeps it cheap", () => {
    // The tempting fix for `getCountry("PE").name === "PE"` is to make THIS
    // module fall back to the artifact. It is imported by client components
    // for accents, marks and hemispheres, so that would put 70 KB into every
    // page that wanted a hue. The merge lives in lib/countryFacts.ts instead,
    // which already pays for the artifact — the same shape as lib/geoNamesId.ts
    // against the 3.65 MB city index.
    const countries = FILES.find((file) => file.path === "lib/countries.ts")!;
    expect(countries.code).toContain("export function curatedCountryName");
    expect(countries.code).not.toMatch(/^\s*import\s/m);
  });

  test("the template layer reaches the reader for TYPES only", () => {
    // lib/countryTips.ts is pure templates. A value import here would drag the
    // artifact into anything rendering a tip, whether or not it reads a fact.
    const tips = FILES.find((file) => file.path === "lib/countryTips.ts")!;
    expect(tips.code).toContain('import type { CountryFacts');
    expect(valueImportOf(tips.code, /countryFacts/)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The bundle constraint, transitively — added by T27
// ---------------------------------------------------------------------------

/**
 * Resolve one import specifier to a file in the scanned tree, or null.
 *
 * `@/x` is the tsconfig alias for the repo root and `./x` / `../x` are
 * relative; a bare specifier is a package and never the artifact. Extensions
 * are tried in the order the bundler tries them.
 */
function resolveSpecifier(from: string, spec: string, known: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Who imports whom, by VALUE. `import type` is erased at compile time and
 * costs no bytes, so it is not an edge — which is exactly why lib/countryTips.ts
 * may name `CountryFacts` and still not reach the artifact.
 */
function valueImportGraph(files: { path: string; code: string }[]): Map<string, string[]> {
  const known = new Set(files.map((file) => file.path));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const out = new Set<string>();
    for (const match of file.code.matchAll(/import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/g)) {
      const resolved = resolveSpecifier(file.path, match[1], known);
      if (resolved !== null) out.add(resolved);
    }
    graph.set(file.path, [...out]);
  }
  return graph;
}

/** Whether `target` is reachable from `start` by following value imports. */
function reaches(graph: Map<string, string[]>, start: string, target: string): boolean {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    for (const edge of graph.get(next) ?? []) {
      if (edge === target) return true;
      if (!seen.has(edge)) {
        seen.add(edge);
        stack.push(edge);
      }
    }
  }
  return false;
}

/**
 * The 70 KB is allowed in a bundle that reads a fact, and nowhere else.
 *
 * The direct-importer test above stopped being enough the moment T27 wired the
 * facts into `getCountryProfile`: nothing imports the JSON but lib/countryFacts.ts,
 * and every module that imports THAT one inherits the bytes. What matters is
 * which `"use client"` entry points reach it along any path at all, which is a
 * graph question, not a grep one.
 *
 * The split that keeps the list short is lib/countryBaseProfile.ts — see its
 * header. Four map and route components read a country's seasons, crowd,
 * holidays, climate and transport and none of its facts; before the split they
 * would have paid 70 KB for data nothing on the page reads.
 */
describe("only the surfaces that read a fact pay for the artifact", () => {
  const FILES = sourceFiles();
  const GRAPH = valueImportGraph(FILES);
  const ARTIFACT_READER = "lib/countryFacts.ts";
  const CLIENTS = FILES.filter((file) => /^\s*["']use client["']/m.test(file.code)).map(
    (file) => file.path
  );

  /**
   * Seasons, crowd, holidays, climate, transport — and the modules that serve
   * them. Every one of these is rendered on pages that read no country fact,
   * so a `true` here is 70 KB of dead weight in a map bundle.
   */
  const MUST_STAY_CHEAP = [
    "components/map/MapExplorer.tsx",
    "components/map/MonthTimeline.tsx",
    "components/map/PlacePopup.tsx",
    "components/trip/RouteMap.tsx",
    "lib/countryBaseProfile.ts",
    "lib/countries.ts",
    "lib/months.ts",
    "lib/route.ts",
    "lib/tripSeason.ts",
  ];

  test("the walk resolves real edges, or every check below is vacuous", () => {
    // Three independent arming claims: the tree was walked, the client set is
    // real, and the graph resolves both a direct edge and a transitive path.
    expect(FILES.length).toBeGreaterThan(150);
    expect(CLIENTS.length).toBeGreaterThan(40);
    expect(GRAPH.get("lib/countryProfile.ts")).toContain(ARTIFACT_READER);
    // PlanStep reaches it three hops away (→ itinerary → countryProfile →
    // countryFacts) and names it nowhere, so a `true` for it can only come
    // from the transitive walk actually working.
    const planStep = FILES.find((file) => file.path === "components/PlanStep.tsx");
    expect(planStep?.code).not.toContain("countryFacts");
    expect(reaches(GRAPH, "components/PlanStep.tsx", ARTIFACT_READER)).toBe(true);
  });

  test("`import type` is not an edge, so the template layer stays free", () => {
    // lib/countryTips.ts names `CountryFacts` in an `import type`. If the walk
    // counted that, every consumer of a tip template would look like it paid
    // for the artifact and this whole contract would be noise.
    expect(GRAPH.get("lib/countryTips.ts")).not.toContain(ARTIFACT_READER);
    expect(reaches(GRAPH, "lib/countryTips.ts", ARTIFACT_READER)).toBe(false);
  });

  test("no map, route or calendar surface reaches the artifact", () => {
    const offenders = MUST_STAY_CHEAP.filter((path) => reaches(GRAPH, path, ARTIFACT_READER));
    expect(offenders).toEqual([]);
    // The list is real files, not typos that can never fail.
    const scanned = FILES.map((file) => file.path);
    for (const path of MUST_STAY_CHEAP) expect(scanned).toContain(path);
    expect(MUST_STAY_CHEAP).toHaveLength(9);
  });

  test("the client entry points that pay for it are exactly these", () => {
    // Pinned, not bounded. Every name here reads a country fact — a tip, a
    // packing item, a gap note or the money pivot — and the list is short
    // because lib/countryBaseProfile.ts exists. A new name appearing is not
    // necessarily wrong, but it is 70 KB in one more bundle and it should be
    // a decision somebody made rather than one that happened.
    //
    // T28 added two, deliberately, and the reason is recorded here rather than
    // in a commit message. Rendering the gap note on the briefing needs the
    // trip's country; `buildBriefing` resolves it, so lib/briefing.ts now
    // reaches the artifact, and components/shell/ShareMenu.tsx (which builds an
    // in-app briefing client-side) and components/shell/AppShell.tsx (which
    // mounts ShareMenu) inherit it.
    //
    // The alternative was worse, not cheaper: had components/trip/BriefingView.tsx
    // resolved the note itself it would have joined this list AND dragged the
    // 70 KB into app/b/[code]/page.tsx, the UNAUTHENTICATED bearer-link route,
    // whose client bundle otherwise carries no country data at all. Keeping the
    // resolution in lib/briefing.ts keeps that page server-side-only for the
    // artifact.
    //
    // And the two new names cost nothing measurable: both are mounted from
    // app/layout.tsx, which already reaches the artifact through
    // components/shell/TripAccentProvider.tsx — already on this list, already
    // in the root layout, already shipping those bytes to every route. The
    // arming test below pins that relationship so this justification cannot
    // quietly stop being true.
    const paying = CLIENTS.filter((path) => reaches(GRAPH, path, ARTIFACT_READER)).sort();
    expect(paying).toEqual([
      "app/plan/page.tsx",
      "components/PlanStep.tsx",
      "components/TripView.tsx",
      "components/shell/AppShell.tsx",
      "components/shell/ShareMenu.tsx",
      "components/shell/TripAccentProvider.tsx",
      "components/trip/BalancesCard.tsx",
      "components/trip/DayCard.tsx",
      "components/trip/ExpenseForm.tsx",
      "components/trip/KitTab.tsx",
      "components/trip/MoneyTab.tsx",
      "components/trip/PackingSection.tsx",
      "components/trip/PlanTab.tsx",
      "components/trip/TodayTab.tsx",
      "components/trip/TrackerTab.tsx",
    ]);
    // And the complement is not empty: most client components pay nothing.
    expect(CLIENTS.length - paying.length).toBeGreaterThan(20);
  });

  test("the two names T28 added are free riders on a bundle that already paid", () => {
    // The justification above rests on one fact: the root layout already
    // reaches the artifact without ShareMenu or AppShell, through
    // TripAccentProvider. If that ever stopped being true, admitting two more
    // root-layout components would start costing real bytes on every route and
    // the comment above would be a stale excuse. So it is asserted, not
    // assumed.
    const layout = FILES.find((file) => file.path === "app/layout.tsx");
    expect(layout?.code).toContain("components/shell/TripAccentProvider");
    expect(layout?.code).toContain("components/shell/AppShell");
    expect(reaches(GRAPH, "components/shell/TripAccentProvider.tsx", ARTIFACT_READER)).toBe(true);

    // And the public briefing page is the thing the split protects: it renders
    // BriefingView, and BriefingView must not resolve the gap note itself.
    expect(reaches(GRAPH, "components/trip/BriefingView.tsx", ARTIFACT_READER)).toBe(false);
    const view = FILES.find((file) => file.path === "components/trip/BriefingView.tsx");
    expect(view?.code).not.toContain("countryProfile");
  });
});
