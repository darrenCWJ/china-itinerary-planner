import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { TRIP_NAV } from "./nav";

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

const ROOTS = ["components", "app", "lib"] as const;

interface SourceFile {
  /** Repo-relative, forward-slashed, so assertions read the same on Windows. */
  path: string;
  text: string;
}

function collect(): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      // Tests are excluded: they legitimately name the things the contracts
      // forbid elsewhere, and a test asserting on test files is noise.
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      out.push({
        path: relative(process.cwd(), full).split(sep).join("/"),
        text: readFileSync(full, "utf8"),
      });
    }
  };
  for (const root of ROOTS) walk(join(process.cwd(), root));
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
  const fetchesTripData = (f: SourceFile) =>
    f.text.includes(TRIP_PATH) && f.text.includes("fetch(");

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
    expect(view!.text.includes("fetch(")).toBe(false);
  });

  it("keeps its own allowlist honest", () => {
    // An allowlist entry that no longer fetches is an exemption nobody needs.
    // Left unchecked it would silently license a future violation in that file.
    for (const { path } of ALLOWED) {
      const file = FILES.find((f) => f.path === path);
      expect(file, `${path} is allowlisted but not in the tree`).toBeDefined();
      expect(file!.text.includes(TRIP_PATH), `${path} is allowlisted but no longer fetches a trip path — drop it`).toBe(
        true
      );
    }
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

  it("routes every tab-label renderer through lib/nav", () => {
    // A component that renders the nav gets its labels from TRIP_NAV and never
    // writes them. Two or more labels as literals in one file is the signature
    // of a second hardcoded list — the exact drift C1 exists to prevent.
    const importsNav = (text: string) => /from\s+["'][^"']*\/nav["']/.test(text);
    const labelCount = (text: string) =>
      TRIP_NAV.filter((item) => text.includes(`"${item.label}"`)).length;

    const offenders = FILES.filter(
      (f) => f.path !== "lib/nav.ts" && labelCount(f.text) >= 2 && !importsNav(f.text)
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
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
  const pinsBottom = (text: string) =>
    /\bfixed\b/.test(text) && /\bbottom-0\b|\binset-x-0 bottom|bottom:\s*0/.test(text);

  it("has no fixed bottom element outside components/shell", () => {
    const offenders = FILES.filter(
      (f) => !f.path.startsWith("components/shell/") && pinsBottom(f.text)
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("still recognises a fixed bottom element when it sees one", () => {
    // The scan is two independent substring tests, so it is worth proving it
    // fires at all rather than trusting an empty result.
    expect(pinsBottom('className="fixed inset-x-0 bottom-0 border-t"')).toBe(true);
    expect(pinsBottom('className="fixed bottom-0"')).toBe(true);
    expect(pinsBottom('style={{ position: "fixed", bottom: 0 }}')).toBe(true);
    // And that it does not fire on the things it must tolerate.
    expect(pinsBottom('className="sticky bottom-0"')).toBe(false);
    expect(pinsBottom('className="fixed inset-0"')).toBe(false);
  });
});

describe("C3 — the day-builder core stays free of React", () => {
  const DAY_BUILDER = join(process.cwd(), "lib", "dayBuilder.ts");

  // Armed now, enforced from Task 21. Written ahead of the module so the
  // constraint is in place before the code that has to satisfy it, rather than
  // being retrofitted after the first React import has already landed.
  it.skipIf(!existsSync(DAY_BUILDER))("has no react import", () => {
    const text = readFileSync(DAY_BUILDER, "utf8");
    expect(/from\s+["']react["']/.test(text)).toBe(false);
  });
});
