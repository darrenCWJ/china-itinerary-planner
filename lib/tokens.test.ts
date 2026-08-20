import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Gates for the Task 33 re-tokenisation sweep — the PR3 enabler.
 *
 * PR3 deletes the `@theme` block in `app/globals.css`. Nothing in TypeScript or
 * React can notice that deletion: a Tailwind utility whose colour no longer
 * exists still compiles, still renders, and simply comes out unstyled. `tsc` is
 * blind to it and so is every component test. These scans are the only place a
 * missed consumer can fail loudly, so they are deliberately blunt and read
 * source as text.
 *
 * Three separate risks, three separate gates:
 *  1. a surviving consumer of the retiring palette (breaks on PR3's deletion);
 *  2. a *typo'd* token — `var(--ink-9)` is valid CSS, so it compiles happily and
 *     paints nothing;
 *  3. an arbitrary value Tailwind cannot parse, which silently emits no rule.
 */

const ROOTS = ["app", "components"] as const;

interface SourceFile {
  /** Repo-relative, forward-slashed, so assertions read the same on Windows. */
  path: string;
  /** Comment-free. Prose about a retired utility must not fail a gate — an
   *  earlier audit in this repo found a contract scan being decided by the
   *  explanatory comment in the very file it was scanning. */
  code: string;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function collect(): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      // Tests are excluded: they name the utilities the gates forbid.
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      out.push({
        path: relative(process.cwd(), full).split(sep).join("/"),
        code: stripComments(readFileSync(full, "utf8")),
      });
    }
  };
  for (const root of ROOTS) walk(join(process.cwd(), root));
  return out;
}

const FILES = collect();
const GLOBALS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** Every Tailwind prefix that resolves to a colour in this codebase, plus the
 *  non-colour ones the retiring names were never used with — a name appearing
 *  under an unexpected prefix should fail, not slip through. */
const PREFIXES =
  "bg|text|border|ring|outline|accent|fill|divide|stroke|shadow|caret|placeholder|from|to|via|decoration";

/**
 * The `@theme` colours PR3 removes. `seal` is deliberately absent: the brand
 * vermilion is the one entry with no token counterpart, so it survives the sweep
 * by design and gets its own pinned gate below.
 */
const RETIRED = ["rail-deep", "rail", "sky", "mist", "paper", "ink-soft", "ink"] as const;

const utilityRe = (name: string) =>
  new RegExp(`(^|[^A-Za-z0-9_\\-\\[])(${PREFIXES})-${name}(?![A-Za-z0-9_\\-])`, "g");

describe("retiring @theme palette", () => {
  it.each(RETIRED)("has no surviving `-%s` consumer", (name) => {
    const offenders = FILES.filter((f) => utilityRe(name).test(f.code)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  /**
   * The vermilion has nowhere to go: `--color-seal` (#c93b2e) lives only in the
   * retiring block and the token set has no brand slot. Inventing one here would
   * put a second definition of the brand colour in the tree, so the sweep left
   * these alone and pins them instead — PR3 gets an exact, non-growing list of
   * what its deletion must resolve rather than a grep it has to re-run blind.
   */
  it("leaves the seal utilities as the only survivors, in a pinned set of files", () => {
    const users = FILES.filter((f) => utilityRe("seal").test(f.code))
      .map((f) => f.path)
      .sort();
    expect(users).toEqual([
      "app/account/page.tsx",
      "app/plan/page.tsx",
      "components/CatalogSearch.tsx",
      "components/DestinationStep.tsx",
      "components/PlanStep.tsx",
      "components/TripView.tsx",
      "components/auth/AccountChip.tsx",
      "components/auth/AuthForm.tsx",
      "components/home/TripsDashboard.tsx",
      "components/map/MonthTimeline.tsx",
      "components/map/PlacePopup.tsx",
      "components/plan/DayBuilder.tsx",
      "components/plan/FeasibilityCounter.tsx",
      "components/plan/PlaceSearch.tsx",
      "components/shell/AppShell.tsx",
      "components/shell/CrewMenu.tsx",
      "components/shell/ShareMenu.tsx",
      "components/trip/BalancesCard.tsx",
      "components/trip/BriefingShare.tsx",
      "components/trip/BriefingView.tsx",
      "components/trip/DayCard.tsx",
      "components/trip/ExpenseForm.tsx",
      "components/trip/JoinClaimDialog.tsx",
      "components/trip/JournalSection.tsx",
      "components/trip/MoneyTab.tsx",
      "components/trip/PlanTab.tsx",
      "components/trip/PrivateGate.tsx",
      "components/trip/TicketsTab.tsx",
      "components/trip/TrackerTab.tsx",
    ]);
  });

  /** C5's 44px minimum has a token; two files had the literal instead (§5e). */
  it("has no hardcoded tap-target height left", () => {
    const offenders = FILES.filter((f) => /(^|[^A-Za-z0-9_-])min-h-11(?![A-Za-z0-9_-])/.test(f.code));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});

/** Every `var(--x)` the sweep wrote into a Tailwind arbitrary value. */
function referencedTokens(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of FILES) {
    for (const [, token] of file.code.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
      const seen = found.get(token) ?? [];
      if (!seen.includes(file.path)) seen.push(file.path);
      found.set(token, seen);
    }
  }
  return found;
}

describe("token references", () => {
  /**
   * The gate that catches a typo. `bg-[var(--ink-9)]` is syntactically perfect
   * CSS: Tailwind emits it, the browser resolves it to nothing, and the element
   * renders with no background. Only checking the name against the definitions
   * finds it.
   */
  it("names only custom properties globals.css defines", () => {
    // `:root`, `[data-theme="dark"]`, and the two `@theme` blocks are all
    // definition sites; a bare `--x:` at the start of a line is any of them.
    const defined = new Set(
      [...GLOBALS.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map(([, name]) => name)
    );
    const undefinedRefs = [...referencedTokens()]
      .filter(([token]) => !defined.has(token))
      .map(([token, files]) => `${token} (${files.join(", ")})`);
    expect(undefinedRefs).toEqual([]);
  });

  it("still reaches the PR1 token set the sweep migrated onto", () => {
    // A regression that deleted every consumer would otherwise pass the gates
    // above vacuously.
    const refs = referencedTokens();
    for (const token of ["--ink-0", "--ink-2", "--line-1", "--surf-1", "--paper", "--accent-ink"]) {
      expect(refs.get(token)?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

/**
 * Compile the real stylesheet and confirm every arbitrary colour utility in the
 * tree produced a rule.
 *
 * Tailwind silently drops an arbitrary value it cannot parse — an unescaped
 * space or a stray bracket costs the colour with no error anywhere. The sweep
 * introduced ~770 of them, including nested `color-mix()` calls, which is more
 * than is safe to take on trust.
 */
describe("Tailwind output", () => {
  it("emits a rule for every arbitrary colour utility the sweep introduced", async () => {
    const load = (p: string) =>
      import(pathToFileURL(join(process.cwd(), "node_modules", p)).href);
    const postcss = (await load("postcss/lib/postcss.mjs")).default;
    const tailwind = (await load("@tailwindcss/postcss/dist/index.mjs")).default;

    const from = join(process.cwd(), "app", "globals.css");
    const result = await postcss([tailwind({ base: process.cwd() })]).process(GLOBALS, { from });

    // Compare on unescaped selector text rather than reimplementing Tailwind's
    // CSS escaping, which would make this test a test of the escape table.
    const selectors: string[] = [];
    result.root.walkRules((rule: { selector: string }) =>
      selectors.push(rule.selector.replace(/\\/g, ""))
    );
    const emitted = selectors.join("\n");

    // Variants are part of the class Tailwind emits, so they have to be part of
    // the string looked up: `focus-visible:outline-[…]` and `hover:bg-[…]/70`
    // both compile to rules that a bare `outline-[…]` lookup would miss. The
    // first run of this test failed on exactly those two, which is the check
    // working — the utilities were fine, the extraction was not.
    //
    // It failed the same way a second time, on the first *bracketed* variant to
    // land in the tree: `has-[:focus-visible]:outline-[var(--accent-ink)]`. The
    // variant pattern admitted only bare words, so it captured the tail alone
    // and looked up a rule Tailwind never emits under that name. The optional
    // `-[…]` below is what lets a variant carry its own brackets — needed by
    // every `has-[…]:`, `data-[…]:`, `group-has-[…]:` and `@[…]:` utility.
    const wanted = new Set<string>();
    for (const file of FILES) {
      const re = new RegExp(
        `(?:[a-z][a-z0-9-]*(?:-\\[[^\\]"'\`\\s]*\\])?:)*(?:${PREFIXES})-\\[[^\\]"'\`\\s]+\\](?:\\/\\d+)?`,
        "g"
      );
      for (const match of file.code.matchAll(re)) wanted.add(match[0]);
    }

    expect(wanted.size).toBeGreaterThan(20);
    const missing = [...wanted].filter((cls) => !emitted.includes(`.${cls}`));
    expect(missing).toEqual([]);
  }, 60_000);
});
