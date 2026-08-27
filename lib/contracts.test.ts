import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { describe, expect, it, test } from "vitest";
// The ingest script's entry-point guard means importing it here does not also
// run `main()` and refetch 13 MB — the idiom scripts/ingest-cities.test.ts
// already relies on. C7 compares the committed report against a live call.
import { buildReport } from "../scripts/ingest-cities.mjs";
import { TRIP_NAV } from "./nav";
import { fullPayload } from "./tripFixtures";

/**
 * Whole-tree scans for the spec §7 contracts.
 *
 * These are deliberately blunt: they read source as text and fail the moment a
 * second copy of something appears anywhere in the tree. That is the failure
 * mode the contracts exist to prevent, and it is precisely what a
 * component-level test cannot see — a duplicated nav bar or a rogue fetch is
 * invisible to every test that only renders one component at a time.
 *
 * A grep-shaped contract can be worked around by anyone determined enough. The
 * point is not to be unbypassable; it is to make an accidental second
 * declaration fail loudly in CI on the commit that introduces it.
 */

const ROOTS = ["components", "app", "lib", "scripts"] as const;

interface SourceFile {
  /** Repo-relative, forward-slashed, so assertions read the same on Windows. */
  path: string;
  text: string;
  /** Comments and string-free — see `stripComments`. Used where prose would lie. */
  code: string;
}

/**
 * Blanks out line and block comments, preserving length-agnostic structure.
 *
 * The C2 scan is substring co-occurrence, so a file *describing* a forbidden
 * pattern in a comment scanned identically to one containing it — an audit found
 * that AppShell's own explanatory comment was what decided the check's verdict on
 * that file. Prose must not be able to fail or pass a contract.
 *
 * Hand-walked rather than two regexes, because the regex form could not tell a
 * comment from a URL: `fetch("https://host/api/trips/1")` was blanked from the
 * `//` in `https://` onward, so the trip path disappeared from `code` and C4
 * never saw the call. Any absolute URL opened that hole by accident, which is
 * the worst kind — nobody has to be evading anything.
 *
 * Single and double quotes reset at a newline, matching JS: an unterminated one
 * is an apostrophe in JSX text, not a string, and letting it run would swallow
 * every comment in the rest of the file.
 */
function stripComments(text: string): string {
  let out = "";
  let quote: string | null = null;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      if (c === "\\") {
        out += c + (text[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (c === quote || (c === "\n" && quote !== "`")) quote = null;
      out += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Tests are excluded: they legitimately name the things the contracts forbid
 * elsewhere, and a test asserting on test files is noise. `.d.ts` is excluded
 * for having no runtime code to constrain. `.css` is included because a
 * contract about layout that cannot see stylesheets is trivially bypassed by
 * writing the rule in CSS.
 */
const isScannable = (entry: string) =>
  /\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry);

function collect(): SourceFile[] {
  const out: SourceFile[] = [];
  const add = (full: string) => {
    const text = readFileSync(full, "utf8");
    out.push({
      path: relative(process.cwd(), full).split(sep).join("/"),
      text,
      code: stripComments(text),
    });
  };
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (isScannable(entry)) add(full);
    }
  };
  for (const root of ROOTS) walk(join(process.cwd(), root));
  // The repo root, one level deep and not recursively — node_modules and .next
  // are here too. `proxy.ts` and `instrumentation.ts` run on every request and
  // can fetch a trip payload as readily as anything under app/, so a collector
  // that stops at the four source directories reports a clean scan of a tree it
  // never finished walking.
  for (const entry of readdirSync(process.cwd())) {
    const full = join(process.cwd(), entry);
    if (statSync(full).isDirectory() || !isScannable(entry)) continue;
    add(full);
  }
  return out;
}

const FILES = collect();

describe("contract scan harness", () => {
  it("finds the tree it is supposed to scan", () => {
    // Guards against the scan silently passing because it walked nothing —
    // a path bug would otherwise make every contract below vacuously true.
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES.map((f) => f.path)).toContain("lib/useTripPayload.ts");
  });

  it("reaches the repo root, not only the four source directories", () => {
    // The proxy and instrumentation live at the root and are as capable of
    // fetching a trip payload as anything under app/. A collector that cannot
    // see them reports a clean scan of a tree it never finished walking, which
    // is the failure mode the harness check above exists to prevent — it just
    // did not extend to the root.
    const paths = FILES.map((f) => f.path);
    expect(paths).toContain("proxy.ts");
    expect(paths).toContain("instrumentation.ts");
  });

  it("does not let a URL's // blank the rest of the line", () => {
    // The sharpest of the scan holes, because an ordinary absolute URL opens it
    // by accident: `fetch("https://host/api/trips/1")` was blanked from the `//`
    // onward, so the trip path vanished from `code` and C4 never saw the call.
    const call = 'const r = await fetch("https://host/api/trips/1"); const tail = 1;';
    expect(stripComments(call)).toContain("/api/trips/");
    expect(stripComments(call)).toContain("const tail = 1");

    // Real comments must still go, including one that follows a string on the
    // same line — otherwise this fix trades one hole for another.
    expect(stripComments("const a = 1; // bottom-0")).not.toContain("bottom-0");
    expect(stripComments("/* bottom-0 */ const a = 1;")).not.toContain("bottom-0");
    expect(stripComments('const u = "https://h/x"; // bottom-0')).not.toContain("bottom-0");
    expect(stripComments('const u = "https://h/x"; // c')).toContain("https://h/x");
    // A quote inside a comment must not open a string and swallow the code
    // after it, and an escaped quote must not close one early.
    expect(stripComments('// it\'s fine\nconst keep = "/api/trips/";')).toContain("/api/trips/");
    expect(stripComments('const s = "a\\"// b"; const keep = 1;')).toContain("const keep = 1");
  });
});

describe("C4 — one module fetches trip data", () => {
  /**
   * Matches per-trip endpoints only. The trailing slash is load-bearing: it
   * excludes `POST /api/trips`, the collection-level create call in
   * components/PlanStep.tsx, which does not read a trip payload and is
   * therefore outside this contract rather than an exception to it.
   */
  const TRIP_PATH = "/api/trips/";

  /**
   * Derived by reading the accessor's own docblock (lib/useTripPayload.ts:21-24),
   * not from the plan — whose guess of `/join` was wrong. `joinTrip` and
   * `loadClaimable` call `/join` from *inside* the accessor, so it is not an
   * exception at all.
   */
  const ALLOWED: ReadonlyArray<{ path: string; why: string }> = [
    {
      path: "lib/useTripPayload.ts",
      why: "The accessor itself — the subject of the contract.",
    },
    {
      path: "components/trip/BriefingShare.tsx",
      why: "Trip-scoped /briefing, but returns share state, not a TripPayload. Declared an exception in the accessor's docblock.",
    },
    {
      path: "components/trip/JournalSection.tsx",
      why: "Trip-scoped /photos, but returns photo metadata, not a TripPayload. Same exception.",
    },
  ];

  /**
   * Co-occurrence, not call-site analysis: a file violates C4 if it both names
   * a trip path and calls `fetch` at all.
   *
   * Deliberately over-broad. Matching `fetch(\`/api/trips/...\`)` directly would
   * miss the indirection that actually shows up in practice —
   * `const url = \`/api/trips/${id}/x\`; fetch(url)` — and that is the case most
   * worth catching, because it looks innocent in review. The cost is that a file
   * fetching something unrelated while mentioning a trip path in a comment needs
   * an allowlist line; that is one line with a reason attached, which is the
   * cheaper failure.
   */
  /**
   * `\bfetch\(` and not `includes("fetch(")`.
   *
   * The substring form matched `refetch(` — verified: `"void
   * refetch(true)".includes("fetch(")` is true. The accessor *prescribes*
   * `refetch(force)` as the failure path, and Task 23's hook has to build a
   * `/api/trips/:id/plan` URL and call `refetch` in the same file, so the loose
   * form would have failed CI on compliant code that follows the plan exactly.
   * There is no word boundary between the `e` and the `f`, so `\b` excludes it.
   */
  const callsFetch = (code: string) => /\bfetch\s*\(/.test(code);

  const fetchesTripData = (f: SourceFile) => f.code.includes(TRIP_PATH) && callsFetch(f.code);

  it("no module outside the accessor fetches a trip payload", () => {
    const offenders = FILES.filter(
      (f) => fetchesTripData(f) && !ALLOWED.some((a) => a.path === f.path)
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("permits handing a trip URL to the accessor's mutate()", () => {
    // The distinction the contract turns on, pinned because Task 12 rewrites
    // TripView: constructing a trip URL is fine, calling fetch on it is not.
    // Without this, the next agent could read the scan as forbidding the
    // sanctioned pattern and "fix" the wrong side of it.
    const view = FILES.find((f) => f.path === "components/TripView.tsx");
    expect(view).toBeDefined();
    expect(view!.text).toContain(`mutate(\`${TRIP_PATH}`);
    // `callsFetch` on `.code`, matching `fetchesTripData` above — NOT
    // `text.includes("fetch(")`. That looser form is the false positive this
    // block documents 19 lines up: it matches `refetch(`, which the accessor
    // prescribes as the failure path, so it would fail CI the moment TripView
    // adds the retry it is entitled to. It also ran on raw text, so a comment
    // saying "fetch()" failed it too. One contract, one definition.
    expect(callsFetch(view!.code)).toBe(false);
  });

  it("does not mistake the accessor's own refetch for a fetch", () => {
    // The exact false positive: it would have failed Task 23's hook, which the
    // plan requires to call refetch(force) on a failed mutate.
    expect(callsFetch("void refetch(true);")).toBe(false);
    expect(callsFetch("const r = await this.refetch();")).toBe(false);
    expect(callsFetch('await fetch("/api/trips/1")')).toBe(true);
    expect(callsFetch("await fetch (url)")).toBe(true);
  });

  /**
   * Does this file still do the thing its allowlist entry exempts it from?
   *
   * That is `fetchesTripData`, so this has to be the same predicate — keying on
   * the path string alone let an entry survive on a leftover comment long after
   * the fetch it excused was deleted, silently licensing the next real violation
   * in that file.
   */
  const stillNeedsExemption = (f: SourceFile) => fetchesTripData(f);

  it("keeps its own allowlist honest", () => {
    // An allowlist entry that no longer fetches is an exemption nobody needs.
    // Left unchecked it would silently license a future violation in that file.
    for (const { path } of ALLOWED) {
      const file = FILES.find((f) => f.path === path);
      expect(file, `${path} is allowlisted but not in the tree`).toBeDefined();
      expect(
        stillNeedsExemption(file!),
        `${path} is allowlisted but no longer fetches a trip path — drop it`
      ).toBe(true);
    }
  });

  it("keys the allowlist on fetching, not on naming a path", () => {
    // The entry exempts a file from `fetchesTripData`, so that is what has to
    // still be true of it. Keying on the path string alone let an entry survive
    // on a leftover comment long after the fetch it excused was deleted — an
    // exemption nobody needs, silently licensing the next real violation.
    const mention = "// see /api/trips/:id/plan\nexport const x = 1;\n";
    expect(
      stillNeedsExemption({ path: "x.tsx", text: mention, code: stripComments(mention) })
    ).toBe(false);

    const real = 'await fetch(`/api/trips/${id}/plan`);\n';
    expect(stillNeedsExemption({ path: "y.tsx", text: real, code: stripComments(real) })).toBe(
      true
    );
  });

  it("does not treat trip creation as a payload read", () => {
    // Pins the reasoning above, so a later widening of TRIP_PATH to
    // "/api/trips" has to confront this deliberately rather than by accident.
    const create = FILES.find((f) => f.path === "components/PlanStep.tsx");
    expect(create).toBeDefined();
    expect(create!.text).toContain('fetch("/api/trips"');
    expect(create!.text.includes(TRIP_PATH)).toBe(false);
  });
});

describe("C1 — one source of truth for the trip tabs", () => {
  /** The seven-tab vocabulary the redesign replaced. */
  const LEGACY_TAB = '"Itinerary"';

  it("has retired the legacy tab vocabulary entirely", () => {
    // Tightened at Task 12, which collapsed TripView's seven tabs to four. Until
    // then this allowed exactly one carrier, TripView itself. Zero now, and the
    // assertion is a flat count so nothing can reintroduce the old vocabulary
    // under cover of an allowlist entry.
    const carriers = FILES.filter((f) => f.text.includes(LEGACY_TAB)).map((f) => f.path);
    expect(carriers).toEqual([]);
  });

  /**
   * Both read comment-stripped source, and both strip it themselves rather than
   * trusting the caller — one contract, one definition, the same rule `callsFetch`
   * states below. A commented-out nav import used to grant the exemption, which
   * is the fail-silent direction: the file is excused from the count entirely.
   */
  const importsNav = (source: string) =>
    /from\s+["'][^"']*\/nav["']/.test(stripComments(source));

  /**
   * Counts a label written as a string literal *or* as JSX text. Literal-only
   * was blind to the form a second nav is most likely to take — `<span>Plan</span>`
   * carries no quoted label at all, so a whole hardcoded tab list read as zero.
   */
  const labelCount = (source: string) => {
    const code = stripComments(source);
    return TRIP_NAV.filter(
      (item) =>
        code.includes(`"${item.label}"`) || new RegExp(`>\\s*${item.label}\\s*<`).test(code)
    ).length;
  };

  it("routes every tab-label renderer through lib/nav", () => {
    // A component that renders the nav gets its labels from TRIP_NAV and never
    // writes them. Two or more labels as literals in one file is the signature
    // of a second hardcoded list — the exact drift C1 exists to prevent.
    const offenders = FILES.filter(
      (f) => f.path !== "lib/nav.ts" && labelCount(f.text) >= 2 && !importsNav(f.text)
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("counts a label rendered as JSX text, not only as a string literal", () => {
    // A second hardcoded tab list written as children — <span>Plan</span> — has
    // no quoted label anywhere in it, so the literal-only count read the whole
    // thing as zero and the drift C1 exists to catch walked through.
    expect(labelCount("<span>Plan</span><span>Money</span>")).toBe(2);
    expect(labelCount("<a>Today</a>\n<a>Kit</a>")).toBe(2);
    // Still counts the literal form, and still needs two to mean anything.
    expect(labelCount('const tabs = ["Plan", "Money"];')).toBe(2);
    expect(labelCount("<h1>Plan</h1>")).toBe(1);
  });

  it("cannot have its nav import satisfied by a comment", () => {
    // Exemption from a comment is the fail-silent direction: a file that only
    // *mentions* importing nav would be excused from the label count entirely.
    expect(importsNav('// import { TRIP_NAV } from "@/lib/nav";')).toBe(false);
    expect(importsNav('import { TRIP_NAV } from "@/lib/nav";')).toBe(true);
  });

  it("declares the tab list exactly once", () => {
    const declarers = FILES.filter((f) => f.text.includes("TRIP_NAV") && f.text.includes("icon:"));
    expect(declarers.map((f) => f.path)).toEqual(["lib/nav.ts"]);
  });
});

describe("C2 — the shell owns the bottom edge", () => {
  /**
   * No allowlist, by design. Two pinned bottom elements cannot coexist, so the
   * mobile bottom bar needs the edge to itself — and the wizard footer that used
   * to sit there was removed in Task 19 rather than deferred.
   *
   * Matches Tailwind's `bottom-0`/`inset-x-0 bottom-…` and raw CSS `bottom:`
   * only in files that also position something fixed, so `sticky` headers and an
   * unrelated `bottom:` in a transform are not swept up.
   */
  /**
   * Widened after an audit found three escapes in the first version: it read no
   * .css at all, it accepted only `bottom-0` (so `fixed bottom-4` walked
   * straight through), and being whole-file substring co-occurrence it could be
   * satisfied by a comment. It now runs on comment-stripped text and matches any
   * bottom offset.
   *
   * Widened again after a review found the two idioms the mobile PR will use:
   * Tailwind v4's `bottom-(--var)` shorthand, which the offset alternation did
   * not admit, and the CSS `inset` shorthands, which are the same declaration
   * spelled without the word `bottom`. `inset-y-` now takes any value for the
   * same reason `bottom-` does — pinning it to `0` was arbitrary. `inset-inline`
   * is excluded on purpose: it pins the horizontal edges and never the bottom.
   */
  const pinsBottom = (code: string) =>
    /\bfixed\b/.test(code) &&
    (/\bbottom-(?:\d|px|full|auto|\[|\()/.test(code) ||
      /\binset-y-(?:\d|px|full|auto|\[|\()/.test(code) ||
      /\b(?:bottom|inset(?:-block(?:-end)?)?):\s*[^;]/.test(code));

  it("has no fixed bottom element outside components/shell", () => {
    const offenders = FILES.filter(
      (f) => !f.path.startsWith("components/shell/") && pinsBottom(f.code)
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("scans stylesheets, not only components", () => {
    // A layout contract that cannot see CSS is bypassed by writing the rule in
    // CSS. Guards the collector, not the predicate.
    expect(FILES.map((f) => f.path)).toContain("app/globals.css");
  });

  it("still recognises a fixed bottom element when it sees one", () => {
    // Two independent substring tests, so an empty result proves nothing on its
    // own — these pin that it fires.
    expect(pinsBottom('className="fixed inset-x-0 bottom-0 border-t"')).toBe(true);
    expect(pinsBottom('className="fixed bottom-0"')).toBe(true);
    // The escape the audit found.
    expect(pinsBottom('className="fixed bottom-4 left-0 right-0"')).toBe(true);
    expect(pinsBottom('className="fixed bottom-[env(safe-area-inset-bottom)]"')).toBe(true);
    expect(pinsBottom(".bar { position: fixed; bottom: 0; }")).toBe(true);
    // And that it tolerates what it must.
    expect(pinsBottom('className="sticky bottom-0"')).toBe(false);
    expect(pinsBottom('className="fixed inset-0"')).toBe(false);
  });

  it("is not evaded by Tailwind v4 var shorthand or CSS inset shorthand", () => {
    // The idioms the mobile PR will reach for, and the ones a review found
    // walked straight through the widened-once predicate. Every line here pins
    // the bottom edge exactly as `bottom-0` does.
    expect(pinsBottom('className="fixed bottom-(--safe-bottom)"')).toBe(true);
    expect(pinsBottom(".bar { position: fixed; inset: auto 0 0 0; }")).toBe(true);
    // Found by trying to evade the widening itself, per the standing lesson that
    // a scan with a gap reads as a guarantee.
    expect(pinsBottom('className="fixed bottom-px"')).toBe(true);
    expect(pinsBottom('className="fixed inset-y-4"')).toBe(true);
    expect(pinsBottom('className="fixed inset-y-(--gutter)"')).toBe(true);
    expect(pinsBottom('className="fixed inset-y-[env(safe-area-inset-bottom)]"')).toBe(true);
    expect(pinsBottom(".bar { position: fixed; inset-block-end: 0; }")).toBe(true);
    expect(pinsBottom(".bar { position: fixed; inset-block: 0; }")).toBe(true);
    // The inline axis pins left and right, never the bottom, so it must not be
    // swept up by a rule written to catch `inset`.
    expect(pinsBottom(".bar { position: fixed; inset-inline: 0; }")).toBe(false);
  });

  it("cannot be tripped or satisfied by prose", () => {
    // The audit's sharpest catch: AppShell's own comment explaining that nothing
    // may be `position: fixed` at `bottom-0` was itself matching the scan.
    const proseOnly = stripComments(
      '// nothing may be position: fixed at bottom-0 outside the shell\nconst x = 1;'
    );
    expect(pinsBottom(proseOnly)).toBe(false);
  });
});

describe("C3 — the day-builder core stays free of React", () => {
  /**
   * Matched by name pattern, not one hardcoded path.
   *
   * The first version keyed on exactly `lib/dayBuilder.ts`, which an audit
   * pointed out turns into a permanent silent skip the moment the module lands as
   * `lib/dayBuilder/index.ts` or `lib/useDayBuilder.ts` — the suite would report
   * a skip forever and nobody would notice the contract had stopped applying.
   */
  /**
   * The core module only — deliberately *not* matching a `use`-prefixed name.
   *
   * The first version matched `lib/useDayBuilder.ts` too, which made the
   * contract unsatisfiable for anything put there: a `useReducer` hook cannot be
   * React-free. The honest rule is two rules, so the second one is stated
   * separately below.
   */
  /**
   * Widened again: admitting `dayBuilder/index.ts` and nothing beside it was the
   * same hardcoded-path regression one level down. Split the core into
   * `reducer.ts` and `ops.ts` and the contract silently stopped applying to the
   * parts holding the logic, while still reporting a pass on the index.
   */
  const isCore = (path: string) =>
    path.startsWith("lib/") &&
    /(^|\/)dayBuilder(\.tsx?$|\/)/.test(path) &&
    /\.tsx?$/.test(path) &&
    !/(^|\/)use[A-Z]/.test(path);

  const builders = FILES.filter((f) => isCore(f.path));

  // Armed now, enforced from Task 21. Written ahead of the module so the
  // constraint is in place before the code that has to satisfy it, rather than
  // being retrofitted after the first React import has already landed.
  it.skipIf(builders.length === 0)("has no react import", () => {
    for (const builder of builders) {
      expect(/from\s+["']react["']/.test(builder.code), `${builder.path} imports react`).toBe(false);
    }
  });

  it("matches the core module wherever Task 22 puts it", () => {
    // Pins the pattern itself, so the skip above stays honest while the module
    // does not exist yet. Guards against the hardcoded-path regression.
    expect(isCore("lib/dayBuilder.ts")).toBe(true);
    expect(isCore("lib/dayBuilder/index.ts")).toBe(true);
    expect(isCore("lib/dayBuilder.tsx")).toBe(true);
    // The hook is a separate rule, not a core module — see below.
    expect(isCore("lib/useDayBuilder.ts")).toBe(false);
    expect(isCore("components/plan/useDayBuilder.ts")).toBe(false);
  });

  it("follows the core module through a directory split", () => {
    // Admitting `dayBuilder/index.ts` and nothing else beside it is the same
    // hardcoded-path regression one level down: split the core into reducer.ts
    // and ops.ts and the contract silently stops applying to the parts that
    // actually hold the logic, while still reporting a pass on index.ts.
    expect(isCore("lib/dayBuilder/reducer.ts")).toBe(true);
    expect(isCore("lib/dayBuilder/ops.ts")).toBe(true);
    // A hook parked inside the directory is still the hook, not the core.
    expect(isCore("lib/dayBuilder/useDayBuilder.ts")).toBe(false);
    // And the boundary still holds: a lookalike directory is not the core.
    expect(isCore("lib/dayBuilderUi/panel.ts")).toBe(false);
  });

  it("is armed — the core module exists, so the scan is not silently skipped", () => {
    // A guard, not a behaviour: `it.skipIf` below reports a skip rather than a
    // failure if the pattern ever stops matching, and a permanent green skip
    // reads exactly like a passing contract.
    expect(builders.map((f) => f.path)).toContain("lib/dayBuilder.ts");
  });

  it("keeps the day-builder hook out of lib entirely", () => {
    // C3 separates state from layout; a React hook is neither pure state nor
    // layout-free, so lib/ is the wrong home for it and the plan puts it at
    // components/plan/useDayBuilder.ts. Stated as its own rule because folding
    // it into the React-free scan above made that scan unsatisfiable.
    const hooksInLib = FILES.filter((f) => /^lib\/.*use[dD]ayBuilder/.test(f.path)).map(
      (f) => f.path
    );
    expect(hooksInLib).toEqual([]);
  });
});

describe("C6 — the trip payload stays serialisable", () => {
  /**
   * Two checks, because either alone passes vacuously. The round-trip proves
   * a fully-populated payload survives JSON; the source scan catches a field
   * added later that the fixture does not happen to set.
   */
  const NON_SERIALISABLE = ["Date", "Map<", "Set<", "RegExp", "bigint", "symbol", "=>"];

  test("a fully-populated payload round-trips through JSON unchanged", () => {
    const payload = fullPayload();
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  /**
   * A plain substring check false-positives on `GuestTripPayload.startDate`:
   * `"startDate".includes("Date")` is true, so a correct, already-serialisable
   * field name would have permanently failed this scan. Word-boundary
   * matching is required for any alphanumeric token so a field *named*
   * `startDate` is not confused with one *typed* `Date`. Not needed for
   * `Map<`, `Set<`, and `=>` — none of those can appear inside an identifier,
   * so a plain substring check on them cannot false-positive the same way.
   */
  const isOffender = (block: string, token: string): boolean =>
    /^\w+$/.test(token) ? new RegExp(`\\b${token}\\b`).test(block) : block.includes(token);

  test("no payload interface declares a non-serialisable field type", () => {
    const source = readFileSync(join(process.cwd(), "lib", "tripShared.ts"), "utf8");
    // Starts at TripData rather than TripPayload: Ticket, Expense, Settlement,
    // JournalEntry, JournalPhoto, CurrencySettings, TripData, TripMember and
    // TripCheck are all declared above TripPayload and are all nested inside
    // it — and they're where a Date is realistically added (Expense.createdAt
    // is a number today). Starting at TripPayload only ever checked
    // TripPayload and GuestTripPayload themselves.
    const start = source.indexOf("export interface TripData");
    const end = source.indexOf("export interface MapCity");
    // Guard against silent scan failure: if an anchor moves or is deleted,
    // the slice returns "" and the filter finds nothing, falsely passing the test.
    expect(start, "C6 start anchor not found — the scan would silently pass if TripData moves").toBeGreaterThanOrEqual(0);
    expect(end, "C6 end anchor not found — the scan would silently pass if MapCity moves").toBeGreaterThanOrEqual(0);
    expect(end, "C6 end anchor out of order — the scan would silently pass if MapCity moves before TripData").toBeGreaterThan(start);
    const block = source.slice(start, end);
    const offenders = NON_SERIALISABLE.filter((t) => isOffender(block, t));
    expect(offenders).toEqual([]);
  });

  test("does not mistake a field named ...Date for one typed Date", () => {
    // Pins the false positive above: `startDate` must not trip the scan, and
    // an actual `Date`-typed field still must.
    expect(isOffender("startDate: string | null;", "Date")).toBe(false);
    expect(isOffender("createdAt: Date;", "Date")).toBe(true);
  });
});

describe("C7 — every surface that renders GeoNames data credits it", () => {
  /**
   * Spec §7 is a licence obligation with legal weight, and it is the kind that
   * is discharged by a JSX line somebody has to remember.
   *
   * The first version of this contract was a hardcoded four-path list. That
   * list was WRONG on the day it was written — it missed
   * `components/home/TripsDashboard.tsx`, the signed-in home page, which
   * renders `destinationNames` straight out of `GET /api/me/trips` — and a
   * hardcoded list is structurally incapable of catching the seventh surface
   * somebody adds next month. So the set is derived instead: scan the tree for
   * the tokens that carry GeoNames city names into a render path, and require
   * every match to either render the credit or sit on an allowlist that names
   * the parent surface rendering it on that file's behalf.
   *
   * This mirrors the preference the repo already states for image credits at
   * components/shell/CountryHero.tsx:29-33 — an `ImageCredit` "cannot be minted
   * outside `lib/countryImagery`, so an image hero always carries one". The
   * structural guarantee is the point; the enumerated list below is only its
   * documentation.
   */
  const CREDIT = "components/plan/GeoNamesCredit.tsx";

  /**
   * The tokens that actually carry GeoNames-derived city names.
   *
   * Traced from the write side, not guessed: `lib/server/planService.ts:24`
   * fills `destinationNames` through `resolveDestinations`, which routes `G…`
   * ids through `cityIndexEntry` → `geoNamesCityToDestination`; `CatalogHit`
   * and `MapCity` are the two shapes `lib/tripShared.ts` declares for a catalog
   * row and a map pin, both of which carry a GeoNames `name`.
   *
   * `\.destinations\b` and not a bare `destinations`: the loose form matches
   * app/layout.tsx's marketing copy ("pick destinations, tune the details"),
   * which is a page-level metadata string and renders no city at all. A
   * contract whose first finding is a false positive gets an allowlist entry
   * that then licenses a real violation in that file forever.
   *
   * `destinationName` SINGULAR was the blind spot, and it was a wide one. It is
   * the per-day field `lib/itinerary.ts` fills from the resolved destination's
   * `name` — the same GeoNames string as the plural, one day at a time — and it
   * is what every surface that draws a day panel renders. Six components named
   * it and none was visible to this contract: the plan tab and its day cards,
   * the day builder, the tracker's today strip, the join-code guest view, and
   * the briefing that the unauthenticated /b/[code] page serves.
   *
   * `BriefingCity` was proposed alongside it and is deliberately NOT here. It
   * exists only in lib/briefing.ts, a `.ts` file, while `namesCityData` below
   * requires `.tsx` under app/ or components/ — so the token would match
   * nothing and buy a false sense of coverage. Widening the scan surface to
   * lib/ is a different and much larger argument (every module that shapes city
   * data would become a candidate, and none of them renders anything), and it
   * is not made here.
   */
  const CITY_NAME_TOKENS = [
    /\bdestinationNames\b/,
    /\bdestinationName\b/,
    /\.destinations\b/,
    /\bCatalogHit\b/,
    /\bMapCity\b/,
  ] as const;

  /**
   * `.code`, so a file that merely *discusses* GeoNames data in a comment is
   * not dragged in, and — more importantly — a commented-out `<GeoNamesCredit`
   * cannot satisfy the requirement. Prose must not be able to fail or pass a
   * contract, the same rule C2 states above.
   */
  const namesCityData = (f: SourceFile) =>
    /\.tsx$/.test(f.path) &&
    (f.path.startsWith("app/") || f.path.startsWith("components/")) &&
    CITY_NAME_TOKENS.some((t) => t.test(f.code));

  const rendersCredit = (f: SourceFile) => f.code.includes("<GeoNamesCredit");

  /**
   * One import specifier resolved to a file in the scanned tree, or null.
   *
   * `@/x` is the tsconfig alias for the repo root and `./x` / `../x` are
   * relative; a bare specifier is a package and mounts nothing of ours. The
   * same resolver lib/countryFacts.test.ts uses for its bundle walk.
   */
  const resolveSpecifier = (from: string, spec: string, known: Set<string>): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = spec.slice(2);
    else if (spec.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), spec));
    else return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
      if (known.has(candidate)) return candidate;
    }
    return null;
  };

  /**
   * Who mounts whom: for every file, the files that import it.
   *
   * Static and dynamic imports both, because both mount components — ShareMenu
   * reaches ShareBriefing through `dynamic(() => import("./ShareBriefing"))`
   * and a static-only walk would report it as mounted by nobody, which reads
   * exactly like a root entry point and would let it pass the coverage test
   * below for free. `import type` is excluded: it renders nothing.
   */
  const importersOf = (() => {
    const known = new Set(FILES.map((f) => f.path));
    const map = new Map<string, string[]>();
    for (const file of FILES) {
      const specs = new Set<string>();
      for (const m of file.code.matchAll(/import\s+(?!type\b)[^;]*?from\s*["']([^"']+)["']/g)) {
        specs.add(m[1]);
      }
      for (const m of file.code.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specs.add(m[1]);
      for (const spec of specs) {
        const resolved = resolveSpecifier(file.path, spec, known);
        if (resolved === null) continue;
        const list = map.get(resolved);
        if (list) list.push(file.path);
        else map.set(resolved, [file.path]);
      }
    }
    return (path: string): string[] => [...new Set(map.get(path) ?? [])].sort();
  })();

  /**
   * Whether every way of getting this file on screen passes through the credit.
   *
   * True when the file renders the credit itself, or when it has importers and
   * ALL of them are covered. A file with no importers is a root — a page or a
   * layout — and a root that does not render the credit covers nothing, which
   * is what makes this terminate on an honest answer rather than on optimism.
   *
   * Recursion is what the nesting demands: DayCard is mounted only by PlanTab,
   * which renders no credit of its own and is mounted only by TripView, which
   * does. A one-hop rule can express "MapExplorer sits inside DestinationStep"
   * and cannot express that, so it would force either a duplicate credit on
   * every day card or an allowlist entry naming a parent that does not credit.
   */
  const coverage = new Map<string, boolean>();
  const isCovered = (path: string, stack: Set<string> = new Set()): boolean => {
    const cached = coverage.get(path);
    if (cached !== undefined) return cached;
    // A cycle has no crediting root along it. Not cached: the same file may be
    // covered through a different, acyclic path.
    if (stack.has(path)) return false;
    const file = FILES.find((f) => f.path === path);
    if (!file) return false;
    if (rendersCredit(file)) {
      coverage.set(path, true);
      return true;
    }
    stack.add(path);
    const importers = importersOf(path);
    const result = importers.length > 0 && importers.every((next) => isCovered(next, stack));
    stack.delete(path);
    coverage.set(path, result);
    return result;
  };

  /**
   * Explicit, and every entry names every surface that mounts it.
   *
   * These files DO render city names — they are not innocent — but every way of
   * getting them on screen passes through a parent that renders the credit, so
   * a second copy would be duplicate chrome rather than a second disclosure.
   * Three things are checked below, and the middle one is new:
   *
   *   1. the file still renders city data, so a stale exemption is deleted
   *      rather than left licensing whatever that file grows into;
   *   2. `mountedIn` is EXACTLY the set of files that import it — so a second,
   *      uncredited mount added later fails instead of hiding behind the first;
   *   3. every named mount is covered, recursively, terminating at a file that
   *      renders the credit.
   *
   * Check 2 is what this contract was missing, and it found a real gap the
   * moment it was written. `BriefingView` has two mounts: app/b/[code]/page.tsx,
   * which credits it, and components/shell/ShareBriefing.tsx, whose entire
   * ancestry — ShareMenu → AppShell → app/layout.tsx — renders no credit at
   * all. A single-parent allowlist entry would have been true about the first
   * mount and silent about the second, which is worse than no entry: it reads
   * as a discharged obligation. ShareBriefing now renders the credit itself.
   */
  const ALLOWED: ReadonlyArray<{ path: string; mountedIn: readonly string[]; why: string }> = [
    {
      path: "components/map/MapExplorer.tsx",
      mountedIn: ["components/DestinationStep.tsx"],
      why: "Renders MapCity pins, but only ever as DestinationStep's map pane — the credit sits directly above it, under the search.",
    },
    {
      path: "components/plan/PlaceSearch.tsx",
      mountedIn: ["components/DestinationStep.tsx"],
      why: "Renders CatalogHit rows, but only ever as DestinationStep's search box — DestinationStep renders the credit immediately beneath it.",
    },
    {
      path: "components/PlanStep.tsx",
      mountedIn: ["app/plan/page.tsx"],
      why: "Renders the generated plan's destination names, but only ever as step 2 of the wizard — app/plan/page.tsx carries the credit beside its footer, where it survives print.",
    },
    {
      path: "components/trip/PlanTab.tsx",
      mountedIn: ["components/TripView.tsx"],
      why: "Renders each day's destinationName, but only ever as TripView's plan tab — TripView renders the credit at the foot of the same page.",
    },
    {
      path: "components/trip/GuestTripView.tsx",
      mountedIn: ["components/TripView.tsx"],
      why: "Renders the guest day list's destinationName, but only ever as TripView's guest branch — which renders the credit directly beneath it, for the join-code viewer who may never open /plan.",
    },
    {
      path: "components/trip/DayCard.tsx",
      mountedIn: ["components/trip/PlanTab.tsx"],
      why: "One day of the plan tab, repeated per day. PlanTab is itself covered by TripView's credit; a credit under every day card would be chrome, not disclosure.",
    },
    {
      path: "components/plan/DayBuilder.tsx",
      mountedIn: ["components/trip/PlanTab.tsx"],
      why: "The plan tab's add-to-day panel, mounted nowhere else. Covered by TripView through PlanTab.",
    },
    {
      path: "components/trip/TrackerTab.tsx",
      mountedIn: ["components/trip/TodayTab.tsx"],
      why: "Today's destinationName in the tracker strip. TodayTab renders no credit but is mounted only by TripView, which does.",
    },
    {
      path: "components/trip/BriefingView.tsx",
      mountedIn: ["app/b/[code]/page.tsx", "components/shell/ShareBriefing.tsx"],
      why: "Renders every day panel's destinationName. Both mounts credit it: the public bearer-link page in its footer, and the Share panel's briefing — which had no crediting ancestor until this contract learned to walk the mount graph.",
    },
  ];

  const CANDIDATES = FILES.filter(namesCityData);

  /**
   * The surfaces the generated `data/cities-report.md` claims carry the credit,
   * parsed back out of the committed report.
   *
   * Read from the report rather than restated here on purpose: the report is
   * regenerated and committed by an unattended workflow, and an enumeration in
   * it that reads as complete has to actually be complete. Asserting the two
   * sets are EQUAL is what stops the report from drifting in either direction —
   * a surface that drops the credit, or a surface that gains one nobody wrote
   * down.
   */
  const reportedSurfaces = (): string[] => {
    const report = readFileSync(join(process.cwd(), "data", "cities-report.md"), "utf8");
    const start = report.indexOf("## Attribution");
    const end = report.indexOf("## Most cities by country");
    expect(start, "the report has no Attribution section").toBeGreaterThanOrEqual(0);
    expect(end, "the report has no country table to bound the Attribution section").toBeGreaterThan(
      start
    );
    return [...report.slice(start, end).matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
  };

  it("is armed — the scan finds the surfaces it is supposed to be scanning", () => {
    // A derived scan that matches nothing reports a clean tree it never walked,
    // which reads exactly like a passing contract. Two independent floors: a
    // count, and the file the first version of this contract missed.
    expect(CANDIDATES.length).toBeGreaterThanOrEqual(6);
    expect(CANDIDATES.map((f) => f.path)).toContain("components/home/TripsDashboard.tsx");
  });

  it("every file that renders GeoNames city names credits it, or is allowlisted", () => {
    const offenders = CANDIDATES.filter(
      (f) => !rendersCredit(f) && !ALLOWED.some((a) => a.path === f.path)
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("fails on a seventh surface added later — the whole point of deriving it", () => {
    // The regression this replaced a hardcoded list to prevent. A new component
    // rendering destinationNames with no credit and no allowlist entry has to
    // be a candidate and has to not satisfy the check.
    const added = "export function Recent({ trips }) { return trips.destinationNames.join(); }\n";
    const fake: SourceFile = {
      path: "components/home/RecentTrips.tsx",
      text: added,
      code: stripComments(added),
    };
    expect(namesCityData(fake)).toBe(true);
    expect(rendersCredit(fake)).toBe(false);
    expect(ALLOWED.some((a) => a.path === fake.path)).toBe(false);
  });

  it("cannot have the credit satisfied by a comment, or the scan tripped by one", () => {
    const commentedOut = "// <GeoNamesCredit />\nexport const x = 1;\n";
    expect(
      rendersCredit({ path: "x.tsx", text: commentedOut, code: stripComments(commentedOut) })
    ).toBe(false);

    const prose = "// renders destinationNames one day\nexport const y = 1;\n";
    expect(namesCityData({ path: "components/y.tsx", text: prose, code: stripComments(prose) })).toBe(
      false
    );
  });

  it("does not sweep in marketing copy that mentions destinations", () => {
    // app/layout.tsx's metadata says "pick destinations, tune the details". It
    // renders no city, and an allowlist entry for it would sit in this file
    // forever licensing whatever that page grows into.
    const meta = 'export const metadata = { description: "pick destinations, tune the details" };\n';
    expect(namesCityData({ path: "app/layout.tsx", text: meta, code: stripComments(meta) })).toBe(
      false
    );
    // The dotted form still fires, which is what TripsDashboard renders.
    const real = "const line = next.destinations.join(String.fromCharCode(8594));\n";
    expect(
      namesCityData({ path: "components/home/TripsDashboard.tsx", text: real, code: stripComments(real) })
    ).toBe(true);
  });

  it("resolves real mount edges, or the allowlist checks below are vacuous", () => {
    // Three arming claims. A static edge, a nested one, and — the one a
    // static-only walk misses — the dynamic import ShareMenu uses.
    expect(importersOf("components/trip/PlanTab.tsx")).toEqual(["components/TripView.tsx"]);
    expect(importersOf("components/trip/DayCard.tsx")).toEqual(["components/trip/PlanTab.tsx"]);
    expect(importersOf("components/shell/ShareBriefing.tsx")).toEqual([
      "components/shell/ShareMenu.tsx",
    ]);
    // And a package specifier is not an edge to anything in the tree.
    expect(importersOf("react")).toEqual([]);
  });

  it("calls a file covered only when every route to it credits", () => {
    // Armed in both directions, because a coverage walk that answered `true`
    // for everything would make the allowlist meaningless and a walk that
    // answered `false` for everything would only look strict.
    expect(isCovered("components/TripView.tsx")).toBe(true); // renders it itself
    expect(isCovered("components/trip/PlanTab.tsx")).toBe(true); // one hop
    expect(isCovered("components/trip/DayCard.tsx")).toBe(true); // two hops
    // AppShell renders no credit, and its only importer is the root layout,
    // which renders none either and is imported by nothing. That chain ends at
    // an honest "no" rather than running out of parents and assuming yes.
    expect(isCovered("components/shell/AppShell.tsx")).toBe(false);
    expect(isCovered("app/layout.tsx")).toBe(false);
  });

  it("keeps its own allowlist honest — still renders city data, and every mount credits", () => {
    const stale: string[] = [];
    const missingMounts: string[] = [];
    const uncovered: string[] = [];
    for (const { path, mountedIn } of ALLOWED) {
      const file = FILES.find((f) => f.path === path);
      if (!file) {
        stale.push(`${path}: allowlisted but not in the tree`);
        continue;
      }
      if (!namesCityData(file)) {
        stale.push(`${path}: no longer renders city data — drop the entry`);
        continue;
      }
      // EXACTLY the importers, not a subset. A second mount added later is the
      // failure this catches: it would be uncredited and invisible behind the
      // first one, which is how a licence obligation quietly stops being met.
      const actual = importersOf(path);
      if (JSON.stringify(actual) !== JSON.stringify([...mountedIn].sort())) {
        missingMounts.push(`${path}: mounted in ${actual.join(", ") || "nothing"}`);
        continue;
      }
      const bad = mountedIn.filter((parent) => !isCovered(parent));
      if (bad.length > 0) uncovered.push(`${path}: uncovered mount(s) ${bad.join(", ")}`);
    }
    // One assertion per failure mode rather than four per entry: nine entries
    // would otherwise be dozens of `expect()` calls inside the timed region.
    expect(stale, `stale allowlist entries: ${stale.join("; ")}`).toEqual([]);
    expect(missingMounts, `allowlist does not name every mount: ${missingMounts.join("; ")}`).toEqual(
      []
    );
    expect(uncovered, `allowlisted but uncredited on some route: ${uncovered.join("; ")}`).toEqual([]);
  });

  /**
   * The spans of every element carrying `print:hidden`, half-open [start, end).
   *
   * Needed because `display: none` on an ancestor beats any `print:block` on a
   * descendant, so "the credit is somewhere on the page" is not the same claim
   * as "the credit prints". The wizard's credit used to sit inside
   * `<footer className="… print:hidden">`, and step 2 unmounts DestinationStep,
   * so the app's own "Print / save as PDF" button produced a plan full of
   * GeoNames city names with no attribution anywhere on it.
   *
   * A tag-name-scoped depth count rather than a general JSX parse: read the
   * element's name backwards from the marker, then count only that name's own
   * opens and closes forward. Generic type parameters (`useState<MapCity[]>`)
   * and comparisons cannot disturb it, because they never spell the container's
   * tag name.
   */
  const printHiddenSpans = (code: string): Array<[number, number]> => {
    const spans: Array<[number, number]> = [];
    const marker = /print:hidden/g;
    let hit: RegExpExecArray | null;
    while ((hit = marker.exec(code)) !== null) {
      const open = code.lastIndexOf("<", hit.index);
      if (open < 0) continue;
      const name = /^<([A-Za-z][\w.]*)/.exec(code.slice(open, open + 64))?.[1];
      if (!name) continue;

      // The tag's own `>`, skipping the one in an `onClick={() => …}` attribute.
      let tagEnd = code.indexOf(">", hit.index);
      while (tagEnd > 0 && code[tagEnd - 1] === "=") tagEnd = code.indexOf(">", tagEnd + 1);
      if (tagEnd < 0) continue;
      // Self-closing: it has no children, so nothing can be hidden inside it.
      if (code.slice(open, tagEnd).trimEnd().endsWith("/")) continue;

      const scan = new RegExp(`</?${name}(?=[\\s/>])`, "g");
      scan.lastIndex = tagEnd + 1;
      let depth = 1;
      let end = code.length;
      let tag: RegExpExecArray | null;
      while ((tag = scan.exec(code)) !== null) {
        if (tag[0][1] === "/") {
          depth -= 1;
          if (depth === 0) {
            end = tag.index;
            break;
          }
          continue;
        }
        const gt = code.indexOf(">", tag.index);
        if (gt > 0 && code.slice(tag.index, gt).trimEnd().endsWith("/")) continue;
        depth += 1;
      }
      spans.push([open, end]);
    }
    return spans;
  };

  it("renders no credit inside a print:hidden container", () => {
    const offenders: string[] = [];
    for (const file of FILES.filter(rendersCredit)) {
      const spans = printHiddenSpans(file.code);
      for (const call of file.code.matchAll(/<GeoNamesCredit\b/g)) {
        if (spans.some(([start, end]) => call.index! > start && call.index! < end)) {
          offenders.push(file.path);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still recognises a credit buried in a hidden container when it sees one", () => {
    // Two independent substring tests, so an empty result above proves nothing
    // on its own. The first block is exactly what app/plan/page.tsx used to be.
    const buried = '<footer className="py-3 print:hidden"><div className="mt-3"><GeoNamesCredit /></div></footer>';
    const [span] = printHiddenSpans(buried);
    expect(span).toBeDefined();
    expect(buried.indexOf("<GeoNamesCredit")).toBeGreaterThan(span[0]);
    expect(buried.indexOf("<GeoNamesCredit")).toBeLessThan(span[1]);

    // `print:block` on the inner div does NOT rescue it — display:none on the
    // ancestor wins — so the scan must still call it hidden.
    const rescued = '<footer className="print:hidden"><div className="print:block"><GeoNamesCredit /></div></footer>';
    const [rescuedSpan] = printHiddenSpans(rescued);
    expect(rescued.indexOf("<GeoNamesCredit")).toBeLessThan(rescuedSpan[1]);
  });

  it("does not call a sibling of the hidden container hidden", () => {
    // The shipped shape: the credit follows `</footer>`, so it prints.
    const sibling =
      '<div><footer className="print:hidden"><button>Back</button></footer><div className="pb-6"><GeoNamesCredit /></div></div>';
    const spans = printHiddenSpans(sibling);
    const at = sibling.indexOf("<GeoNamesCredit");
    expect(spans.some(([start, end]) => at > start && at < end)).toBe(false);

    // Nesting of the same tag name must not close the span early.
    const nested = '<div className="print:hidden"><div>x</div><GeoNamesCredit /></div>';
    const [nestedSpan] = printHiddenSpans(nested);
    expect(nested.indexOf("<GeoNamesCredit")).toBeLessThan(nestedSpan[1]);

    // A self-closing hidden element has no interior at all.
    expect(printHiddenSpans('<input className="print:hidden" /><GeoNamesCredit />')).toEqual([]);

    // An `onClick={() => …}` arrow before the tag's own `>` must not truncate
    // the open tag and make the span start in the wrong place.
    const arrow = '<button onClick={() => go()} className="print:hidden"><GeoNamesCredit /></button>';
    const [arrowSpan] = printHiddenSpans(arrow);
    expect(arrow.indexOf("<GeoNamesCredit")).toBeGreaterThan(arrowSpan[0]);
    expect(arrow.indexOf("<GeoNamesCredit")).toBeLessThan(arrowSpan[1]);
  });

  it("the credit names both licences", () => {
    const credit = FILES.find((f) => f.path === CREDIT);
    expect(credit, `${CREDIT} is missing`).toBeDefined();
    // GeoNames is CC BY 4.0; the descriptions are Wikipedia extracts, which are
    // CC BY-SA 4.0 — attribution and share-alike. Asserted on `.code` so that
    // the deed URLs have to be in the markup rather than in the file's own
    // explanatory comment, which is where both URLs also appear.
    expect(credit!.code).toContain("https://creativecommons.org/licenses/by/4.0/");
    expect(credit!.code).toContain("https://creativecommons.org/licenses/by-sa/4.0/");
    expect(credit!.code).toContain("https://www.geonames.org/");
    expect(credit!.code).toContain("https://en.wikipedia.org/");
  });

  test("TripView credits the guest surface as well as the member one", () => {
    /**
     * TripView has five `<PageMain>` returns. Three are loading/private/
     * not-found and render no city data. TWO render `destinationNames`: the
     * member view, and the `loadState === "guest"` view whose `GuestHeader`
     * shows the same names to somebody who is not signed in. A single credit
     * in the file satisfies the scan above while leaving the guest surface
     * bare, so the count is pinned here rather than the presence.
     */
    const view = FILES.find((f) => f.path === "components/TripView.tsx");
    expect(view, "components/TripView.tsx is not in the scanned tree").toBeDefined();
    const rendered = view!.code.match(/<GeoNamesCredit\b/g) ?? [];
    const surfaces = view!.code.match(/destinationNames/g) ?? [];
    expect(surfaces.length, "TripView no longer renders destinationNames").toBe(2);
    expect(rendered.length, "one credit cannot cover both TripView surfaces").toBe(2);
  });

  test("the ingest report does not still claim the credit is unrendered", () => {
    /**
     * `scripts/ingest-cities.mjs` wrote "REQUIRED and NOT YET RENDERED IN THE
     * UI" into data/cities-report.md for every run before this one, and the
     * report is regenerated and committed by an unattended workflow. Once the
     * credit exists that sentence is a false claim about a licence, committed
     * to the repo — the single worst place for one. Both the generator and its
     * current output are checked, because fixing only the committed file lets
     * the next scheduled ingest put it straight back.
     */
    const STALE = "NOT YET RENDERED IN THE UI";
    for (const path of ["data/cities-report.md", "scripts/ingest-cities.mjs"]) {
      const source = readFileSync(join(process.cwd(), ...path.split("/")), "utf8");
      expect(source, `${path} still claims the GeoNames credit is unrendered`).not.toContain(
        STALE
      );
      expect(source, `${path} no longer mentions the credit at all`).toContain(
        "GeoNamesCredit"
      );
    }
  });

  test("the report does not claim the credit is on EVERY city-name surface", () => {
    /**
     * The replacement copy for the stale claim above traded one false statement
     * for another: it said the credit renders "on every surface that shows a
     * city name" while the signed-in home page had none. A universal quantifier
     * in a generated, auto-committed file is a claim nobody re-checks, so the
     * report enumerates instead — and the enumeration is verified against the
     * tree by the test below rather than trusted.
     */
    for (const path of ["data/cities-report.md", "scripts/ingest-cities.mjs"]) {
      const source = readFileSync(join(process.cwd(), ...path.split("/")), "utf8");
      expect(source, `${path} claims the credit covers "every surface"`).not.toMatch(
        /every surface/i
      );
    }
  });

  test("the report's list of credited surfaces is exactly the set that credits", () => {
    // Both directions. A surface that drops the credit fails, and a surface
    // that gains one the report never mentions fails too — which is what stops
    // the enumeration from reading as complete while quietly not being.
    const listed = [...reportedSurfaces()].sort();
    const actual = FILES.filter((f) => f.path !== CREDIT && rendersCredit(f))
      .map((f) => f.path)
      .sort();
    expect(listed).toEqual(actual);
    expect(listed.length).toBeGreaterThanOrEqual(5);
  });

  test.each([
    "app/plan/page.tsx",
    "components/DestinationStep.tsx",
    "components/TripView.tsx",
    "app/b/[code]/page.tsx",
    "components/home/TripsDashboard.tsx",
    "components/shell/ShareBriefing.tsx",
  ])(
    "%s renders GeoNamesCredit",
    (path) => {
      // The enumerated floor, kept alongside the derived scan rather than
      // replaced by it: the derived scan proves no surface is UNCREDITED, and
      // this proves these six named ones still exist to be credited at all. A
      // file deleted outright passes the derived scan vacuously.
      const file = FILES.find((f) => f.path === path);
      expect(file, `${path} is not in the scanned tree`).toBeDefined();
      // `.code`, not `.text`: a commented-out call site is not a rendered credit,
      // and this is the assertion whose failure mode is a licence breach.
      expect(file!.code).toContain("<GeoNamesCredit");
    }
  );

  test("the committed report matches what the generator would write", () => {
    /**
     * The report is regenerated by an unattended nightly workflow, so wording
     * hand-edited into the committed file and not into `buildReport` survives
     * exactly until the next run. Comparing the Attribution section against a
     * live `buildReport` call is the cheapest way to make that drift fail here
     * instead of silently reverting in production.
     *
     * Only that section, because the rest is a function of the shard data — the
     * generated timestamp and city counts would differ for reasons that have
     * nothing to do with the licence.
     */
    const section = (text: string) => {
      const start = text.indexOf("## Attribution");
      const end = text.indexOf("## Most cities by country");
      expect(start, "Attribution anchor missing").toBeGreaterThanOrEqual(0);
      expect(end, "country-table anchor missing").toBeGreaterThan(start);
      return text.slice(start, end);
    };
    const generated = buildReport({
      shards: new Map(),
      total: 0,
      generatedAt: "unused",
      largest: { code: "XX", bytes: 0 },
    });
    const committed = readFileSync(join(process.cwd(), "data", "cities-report.md"), "utf8");
    expect(section(committed)).toBe(section(generated));
  });

  test("the credit is not left in a file nothing imports", () => {
    // The scan above proves the tag appears; this proves the symbol resolves,
    // so that deleting the component would fail here rather than at runtime.
    for (const file of FILES.filter((f) => f.path !== CREDIT && rendersCredit(f))) {
      expect(file.code, `${file.path} renders GeoNamesCredit without importing it`).toContain(
        "@/components/plan/GeoNamesCredit"
      );
    }
    expect(FILES.some((f) => f.path === CREDIT), `${CREDIT} is missing`).toBe(true);
  });
});

describe("C8 — a season is never derived from the bare northern table", () => {
  /**
   * `lib/months.ts`'s `seasonOfMonth` is hardcoded northern-hemisphere, and it
   * says so. `getCountryProfile(code).seasonOfMonth` is the hemisphere-aware
   * wrapper, and `resolveTripSeason` is the rule the write route applies to a
   * saved trip (app/api/trips/route.ts).
   *
   * app/plan/page.tsx called the bare one, so the wizard previewed one season
   * and the server saved the opposite for every southern-hemisphere country — a
   * June Peru trip previewed summer and saved winter. No test file may live
   * under app/ (vitest.config.mts includes only lib/, scripts/ and components/),
   * so the call site is held down here, as text, while the rule it now calls is
   * unit-tested in lib/tripSeason.test.ts. Neither half covers the bug alone.
   *
   * Scoped to app/ and components/: lib/countryProfile.ts imports the bare
   * function on purpose — it is what the wrapper wraps.
   */
  const RENDERING = (path: string) => path.startsWith("app/") || path.startsWith("components/");

  /**
   * Whether a file pulls `seasonOfMonth` out of lib/months rather than off a
   * country profile. Matched on the import, not on the call, because reading it
   * off a profile is destructuring — `const { seasonOfMonth } = profile` in
   * components/trip/RouteMap.tsx — and a call-shaped scan would condemn the fix
   * along with the bug.
   */
  const importsBareSeason = (code: string): boolean => {
    for (const match of code.matchAll(/import\s+([^;]*?)\s+from\s*["\']([^"\']+)["\']/g)) {
      const clause = match[1];
      const source = match[2];
      if (!/(^|\/)months$/.test(source)) continue;
      if (/\bseasonOfMonth\b/.test(clause)) return true;
      // A namespace import hides which bindings are used, so it is refused
      // outright rather than trusted.
      if (/^\s*\*\s+as\s+\w+/.test(clause)) return true;
    }
    return false;
  };

  it("no wizard or component derives a season from lib/months directly", () => {
    const offenders = FILES.filter((f) => RENDERING(f.path) && importsBareSeason(f.code)).map(
      (f) => f.path
    );
    expect(offenders).toEqual([]);
  });

  it("scanned the files it claims to have scanned", () => {
    // The iteration floor. An empty result proves nothing if the collector
    // walked nothing, and the offender list above is exactly that shape.
    const scanned = FILES.filter((f) => RENDERING(f.path)).map((f) => f.path);
    expect(scanned.length).toBeGreaterThan(40);
    expect(scanned).toContain("app/plan/page.tsx");
    expect(scanned).toContain("components/map/MonthTimeline.tsx");
    expect(scanned).toContain("components/map/PlacePopup.tsx");
  });

  it("still recognises the bare import when it sees one", () => {
    // Two independent halves: an empty offender list means nothing unless the
    // predicate is known to fire.
    expect(importsBareSeason('import { seasonOfMonth } from "@/lib/months";')).toBe(true);
    expect(importsBareSeason('import { MONTHS, seasonOfMonth } from "@/lib/months";')).toBe(true);
    expect(importsBareSeason('import { seasonOfMonth } from "./months";')).toBe(true);
    expect(importsBareSeason('import {\n  seasonOfMonth,\n} from "@/lib/months";')).toBe(true);
    expect(importsBareSeason('import * as months from "@/lib/months";')).toBe(true);

    // And tolerates what it must — every line here is the fix, not the bug.
    expect(importsBareSeason('import { MONTHS } from "@/lib/months";')).toBe(false);
    expect(importsBareSeason("const { seasonOfMonth } = getCountryProfile(country);")).toBe(false);
    expect(importsBareSeason("const s = profile.seasonOfMonth(month);")).toBe(false);
    expect(importsBareSeason('import { seasonOfMonth } from "./somethingElse";')).toBe(false);
  });

  it("the wizard routes its picked month through the write route's own rule", () => {
    // The positive half of the same contract: "does not call the wrong one" is
    // satisfied by a file that derives no season at all.
    const page = FILES.find((f) => f.path === "app/plan/page.tsx");
    expect(page, "app/plan/page.tsx is missing from the scan").toBeDefined();
    expect(page?.code).toContain("@/lib/tripSeason");
    expect(page?.code).toContain("resolveTripSeason(");
    // Twice: once where the month is picked, once where the country changes
    // under an already-picked month. The second is the same bug in the other
    // order of the same two clicks.
    expect(page?.code.match(/resolveTripSeason\(/g) ?? []).toHaveLength(2);
  });
});
