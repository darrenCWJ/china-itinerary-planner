/**
 * The one step-up control, drawn at whichever rung the two machines are on.
 *
 * Extracted because there are now three of them — out of a region, out of a
 * country, and back down from the world level — and they are the same control
 * in three states rather than three controls that happen to look alike. A
 * literal repeated three times is a place `min-h-[var(--tap-min)]` can go
 * missing from one of them: C5's 44px minimum is asserted per control in
 * `MapExplorer.test.tsx` precisely because each is the only way out of the
 * state it appears in, and a shared constant is what keeps a fourth rung from
 * being added without it.
 *
 * Its own module because the three rungs no longer live in one file: two are
 * in `MapExplorer.tsx` and the third is in `WorldPane.tsx`.
 */
export const STEP_UP_BUTTON =
  "inline-flex min-h-[var(--tap-min)] items-center rounded-lg border border-[var(--line-1)] px-3 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]";
