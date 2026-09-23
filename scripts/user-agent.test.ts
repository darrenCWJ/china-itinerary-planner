import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every request the tree sends to Wikimedia says who is calling and how to
 * reach them.
 *
 * Wikimedia's User-Agent policy (https://meta.wikimedia.org/wiki/User-Agent_policy)
 * asks every client for contact information — a URL or an email address — and
 * enforces it. On 2026-09-23, from the owner's machine, query.wikidata.org and
 * www.wikidata.org both answered HTTP 403 "Please respect our robot policy" to
 * the bare `ChinaItineraryPlanner/1.0 (personal project)` this repo then sent
 * from nine files, and 200 to the identical request carrying a contact URL.
 *
 * The enforcement is not constant — the nightly runners were answered normally
 * that day, and so was the same machine a few hours later — which is why this
 * is pinned in source rather than left to be noticed. Where it would be noticed
 * is the problem: the refresh's P297 `codes` query is fatal by design (see
 * `run()` in scripts/ingest-country-facts.mjs), so the first night enforcement
 * reached a runner would be a red refresh; and lib/server/cityEnrichment.ts
 * fails silently by design, so there it would be nothing but thinner cards.
 *
 * The form is scripts/build-provinces.mjs's, the first compliant one here: a
 * per-script product token, then the public repo's URL. Never anyone's email
 * address — the repo is public, and so is every header sent from it.
 *
 * Blunt in lib/contracts.test.ts's sense: it reads source as text. That file's
 * harness is not reused because it does not scan `.mjs`, which is every script
 * here, and widening it would widen C1–C8 with it. The constants stay one per
 * file rather than shared, for the reason scripts/country-facts/io.mjs gives
 * `writeFileAtomic`: a scripts/ helper module would be an import edge for one
 * line, and lib/ may not import from scripts/ at all.
 */

/** Where outbound requests are made. components/ runs in a browser, which sends its own. */
const ROOTS = ["scripts", "lib", "app"] as const;

interface SourceFile {
  /** Repo-relative and forward-slashed, so assertions read the same on Windows. */
  path: string;
  text: string;
}

/** Tests are excluded: this one has to spell out the retired string to forbid it. */
const isScannable = (entry: string) =>
  /\.(mjs|js|tsx?)$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry);

function collect(): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (isScannable(entry)) {
        out.push({ path: relative(process.cwd(), full).split(sep).join("/"), text: readFileSync(full, "utf8") });
      }
    }
  };
  for (const root of ROOTS) walk(join(process.cwd(), root));
  return out;
}

/**
 * The two shapes a User-Agent is written in here: a `USER_AGENT` constant,
 * possibly wrapped onto the next line, and an inline `'user-agent'` header
 * literal. `'User-Agent': USER_AGENT` is a reference, not a declaration, and
 * does not match, because its value is not quoted.
 */
const DECLARATION_SHAPES = [
  /\bUSER_AGENT\s*=\s*(['"`])([^'"`\n]*)\1/g,
  /['"]user-agent['"]\s*:\s*(['"`])([^'"`\n]*)\1/gi,
];

function declarationsIn(text: string): string[] {
  return DECLARATION_SHAPES.flatMap((shape) => [...text.matchAll(shape)].map((match) => match[2]));
}

/**
 * build-provinces' form, anchored at both ends: a lower-case product token
 * naming the script, then the repo's URL as the contact. The anchoring is what
 * refuses an email address added after the URL, not only a missing URL.
 */
const CONTACT_FORM =
  /^china-itinerary-planner\/[a-z0-9]+(?:-[a-z0-9]+)* \(\+https:\/\/github\.com\/darrenCWJ\/china-itinerary-planner\)$/;

/**
 * A Wikimedia project host in an https URL. A SPARQL string's
 * `schema:isPartOf <https://en.wikipedia.org/>` matches too, which is why a
 * file only counts as a Wikimedia caller when it also calls `fetch(` —
 * scripts/enrich/plan.mjs builds that query and never sends it.
 */
const WIKIMEDIA_HOST =
  /https:\/\/(?:[a-z0-9-]+\.)*(?:wikidata|wikipedia|wikimedia|wikivoyage|wiktionary|mediawiki)\.org\b/;
const CALLS_FETCH = /\bfetch\(/;

const FILES = collect();
const WIKIMEDIA_CALLERS = FILES.filter((file) => WIKIMEDIA_HOST.test(file.text) && CALLS_FETCH.test(file.text));

describe("every User-Agent sent to Wikimedia carries contact information", () => {
  it("is armed — it finds the Wikimedia callers", () => {
    // A path bug that walked nothing would make every check below vacuously
    // true. The five are the tree's Wikimedia callers as of 2026-09-23.
    expect(WIKIMEDIA_CALLERS.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "lib/server/cityEnrichment.ts",
        "scripts/country-facts/io.mjs",
        "scripts/enrich/io.mjs",
        "scripts/ingest-country-images.mjs",
        "scripts/ingest-destinations.mjs",
      ])
    );
  });

  it("every module that fetches from a Wikimedia host declares one in the contact form", () => {
    // Sending none is not a way out: Node's fetch then sends its own generic
    // default, which says nothing about who is calling or how to reach them.
    const offenders = WIKIMEDIA_CALLERS.flatMap((file) => {
      const declared = declarationsIn(file.text);
      if (declared.length === 0) return [`${file.path}: (none)`];
      return declared.filter((value) => !CONTACT_FORM.test(value)).map((value) => `${file.path}: ${value}`);
    });
    expect(offenders).toEqual([]);
  });

  it("still recognises a non-compliant User-Agent when it sees one", () => {
    // Without this, a broken extraction pattern would find no declarations,
    // report no offenders, and pass. Each shape the tree writes is read back
    // here, and the form refuses what it exists to refuse.
    const retired = "ChinaItineraryPlanner/1.0 (personal project)";
    expect(declarationsIn(`const USER_AGENT = '${retired}';`)).toEqual([retired]);
    expect(declarationsIn(`const USER_AGENT =\n  "${retired}";`)).toEqual([retired]);
    expect(declarationsIn(`headers: { 'user-agent': '${retired}' },`)).toEqual([retired]);
    expect(declarationsIn("headers: { 'User-Agent': USER_AGENT },")).toEqual([]);

    expect(retired).not.toMatch(CONTACT_FORM);
    expect(
      "china-itinerary-planner/enrich-cities (+https://github.com/darrenCWJ/china-itinerary-planner; ops@example.invalid)"
    ).not.toMatch(CONTACT_FORM);
    expect("china-itinerary-planner/build-provinces (+https://github.com/darrenCWJ/china-itinerary-planner)").toMatch(
      CONTACT_FORM
    );
  });
});
