import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every outbound User-Agent in the tree says who is calling and how to reach
 * them.
 *
 * Wikimedia's User-Agent policy
 * (https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy, moved there
 * from meta.wikimedia.org/wiki/User-Agent_policy) asks every client for
 * contact information — an email address, a website or a wiki user — and says
 * a missing, empty or generic one gets HTTP 403. On 2026-09-23, from the
 * owner's machine, query.wikidata.org and
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
 * address — the repo is public, and so is every header sent from it. Hosts
 * that are not Wikimedia's (GeoNames, OurAirports, jsDelivr, CHELSA, GitHub)
 * get the same form, so there is one shape to copy and no file left to copy
 * the old one from.
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
 * The two shapes a User-Agent has been written in here: a `USER_AGENT`
 * constant, possibly wrapped onto the next line, and — in the two topology
 * scripts until 2026-09-23 — an inline `'user-agent'` header literal.
 * `'User-Agent': USER_AGENT` is a reference, not a declaration, and does not
 * match, because its value is not quoted.
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
 * A Wikimedia project host in a URL, http or https, with any subdomain — a
 * built one such as `https://${lang}.wikipedia.org` included. A SPARQL
 * string's `schema:isPartOf <https://en.wikipedia.org/>` matches too, which is
 * why a file only counts as a Wikimedia caller when it also makes a request:
 * scripts/enrich/plan.mjs builds that query and never sends it.
 */
const WIKIMEDIA_HOST =
  /https?:\/\/[^\s'"`/]*\b(?:wikidata|wikipedia|wikimedia|wikivoyage|wiktionary|mediawiki)\.org\b/;

/**
 * A request is `fetch(` or any `fetch…(` helper, because a caller that goes
 * through one is still a caller: `fetchJsonWithTimeout` in lib/rates.ts sends
 * no headers at all, so a Wikimedia caller built on it would go out under
 * Node's generic default unless it hands in a `fetchImpl` that adds one. That
 * breadth can also catch a file whose only Wikimedia URL is in prose; the fix
 * there is to reword the prose, never to give a file that sends nothing a
 * User-Agent to satisfy this.
 */
const MAKES_REQUESTS = /\bfetch\w*\s*\(/;

/**
 * The argument text of every global `fetch(` call, found by matching the
 * call's own parentheses. Naive about a parenthesis inside a string argument,
 * which no caller here has.
 */
function fetchCallArguments(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/\bfetch\(/g)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "(") depth += 1;
      else if (text[i] === ")" && --depth === 0) {
        out.push(text.slice(open + 1, i));
        break;
      }
    }
  }
  return out;
}

const FILES = collect();
const WIKIMEDIA_CALLERS = FILES.filter((file) => WIKIMEDIA_HOST.test(file.text) && MAKES_REQUESTS.test(file.text));

describe("every outbound User-Agent carries contact information", () => {
  it("is armed — it finds the Wikimedia callers, and a real declaration of each constant shape", () => {
    // A path bug that walked nothing would make every check below vacuously
    // true. The five are the tree's Wikimedia callers as of 2026-09-23. The
    // last two prove both constant shapes are read out of a real file, not
    // only out of the synthetic strings further down: one line, and wrapped
    // onto the next. The inline `'user-agent'` literal the two topology
    // scripts used until then has no real example left, so the synthetic test
    // is what keeps that shape covered.
    expect(WIKIMEDIA_CALLERS.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "lib/server/cityEnrichment.ts",
        "scripts/country-facts/io.mjs",
        "scripts/enrich/io.mjs",
        "scripts/ingest-country-images.mjs",
        "scripts/ingest-destinations.mjs",
      ])
    );
    expect(FILES.filter((file) => declarationsIn(file.text).length > 0).map((file) => file.path)).toEqual(
      expect.arrayContaining(["scripts/build-provinces.mjs", "scripts/climate/acquire.mjs"])
    );
  });

  it("every declared User-Agent is in the contact form, whatever host it is sent to", () => {
    const offenders = FILES.flatMap((file) =>
      declarationsIn(file.text)
        .filter((value) => !CONTACT_FORM.test(value))
        .map((value) => `${file.path}: ${value}`)
    );
    expect(offenders).toEqual([]);
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

  it("every Wikimedia caller attaches it in each fetch it sends, not only in a declaration", () => {
    // A declaration proves nothing is SENT. ingest-country-images.mjs and
    // ingest-destinations.mjs run main() on import, so no test can watch their
    // requests go out; before this, either could have dropped the header from
    // one of its two call sites and stayed green here. So the rule is
    // structural, and checkable from source: the constant is named in the
    // arguments of every `fetch(` the file makes, which is where the header
    // either goes on the wire or does not.
    const offenders = WIKIMEDIA_CALLERS.flatMap((file) => {
      const calls = fetchCallArguments(file.text);
      if (calls.length === 0) return [`${file.path}: no fetch( of its own to attach one to`];
      return calls
        .filter((args) => !args.includes("USER_AGENT"))
        .map((args) => `${file.path}: fetch(${args.replace(/\s+/g, " ").slice(0, 80)}…)`);
    });
    expect(offenders).toEqual([]);
  });

  it("the retired User-Agent is gone from the code, in whatever syntax", () => {
    // docs/ keeps it on purpose — a plan is a record of what it prescribed —
    // and a plan is exactly where a new script would copy it from. The checks
    // above only see the declaration shapes; this sees any spelling, comments
    // included, which is why no source file quotes it even to explain it.
    const stale = FILES.filter((file) => file.text.includes("ChinaItineraryPlanner/")).map((file) => file.path);
    expect(stale).toEqual([]);
  });

  it("still recognises a non-compliant User-Agent when it sees one", () => {
    // Without this, a broken extraction pattern would find no declarations,
    // report no offenders, and pass. Every shape a User-Agent has been written
    // in is read back here, and the form refuses what it exists to refuse.
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

  it("still recognises a Wikimedia caller that builds its host or goes through a helper", () => {
    // The same reason as the test above: every pattern the checks lean on is
    // shown to fire on the shapes it claims to cover, and not on a lookalike.
    expect(WIKIMEDIA_HOST.test("const url = `https://${lang}.wikipedia.org/w/api.php`;")).toBe(true);
    expect(WIKIMEDIA_HOST.test("const API = 'http://commons.wikimedia.org/w/api.php';")).toBe(true);
    expect(WIKIMEDIA_HOST.test("const API = 'https://notwikipedia.org/';")).toBe(false);
    expect(MAKES_REQUESTS.test("const json = await fetchJsonWithTimeout(url, { timeoutMs });")).toBe(true);
    expect(
      fetchCallArguments("await fetch(url, { headers, signal: AbortSignal.timeout(ms) }); after(1);")
    ).toEqual(["url, { headers, signal: AbortSignal.timeout(ms) }"]);
  });
});
