import { getByRole } from "@testing-library/dom";
import "@testing-library/jest-dom/vitest";


/**
 * jsdom implements no `window.matchMedia` at all. `PrefsProvider.tsx` calls it
 * unguarded (correctly — every real browser has it, so production code should
 * not carry a test-environment workaround), which throws from a layout effect
 * the moment any test mounts the provider without its own mock in place.
 *
 * Installed only when nothing already provided one, so a test with its own
 * mock — `PrefsProvider.test.tsx`'s `matchMediaMock`, installed via
 * `vi.stubGlobal` in `beforeEach` — keeps winning. This is just the baseline
 * "no dark mode, no listeners" answer for every other test that mounts
 * something depending on `matchMedia` without caring what it returns.
 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * React only emits its `act(...)` warnings when it believes it is under test,
 * and it decides that from this global — nothing else, not NODE_ENV and not the
 * jsdom environment. Left unset, every "update was not wrapped in act(...)" is
 * dropped in silence, and with it the only signal that a component was still
 * re-rendering after the test driving it had finished asserting.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom parses its 111-rule default stylesheet lazily — on the first
 * `getComputedStyle` against a window, memoised in a module-level
 * `parsedDefaultStyleSheet` (jsdom/living/css/helpers/computed-style.js). That
 * parse costs ~110ms, and every Testing Library *role* query pays it: role
 * queries filter on the accessibility tree, and `isInaccessible` reaches
 * `getComputedStyle` to decide what is in it. Text queries never touch it.
 *
 * The environment is built once per test *file*, so exactly one test per file
 * pays that parse — whichever runs a role query first, which is not always the
 * first test (`BalancesCard`'s first two use `getByText`; `CountryMap`'s is
 * pure logic). Add React's first render (~20ms) and the first element-role and
 * accessible-name computations (~30ms) and that one test measures ~160ms more
 * than its own siblings, which are otherwise identical to it.
 *
 * On an idle machine that is invisible. Under concurrent suites it is not: the
 * budget vitest enforces is wall clock, and `withTimeout` re-checks elapsed
 * time *after* the body returns, so a fully synchronous test fails with "Test
 * timed out in 5000ms" without any timer having fired. That is the whole of
 * why a scattering of first-role-query tests flaked under load while their
 * siblings never did.
 *
 * Warming it here moves that work into the setup phase — still once per file,
 * but carrying no per-test budget. A role query with a name is used rather than
 * a bare `getComputedStyle` because the same call also warms the element-role
 * match and the accessible-name computation. It does *not* warm React's first
 * render, which still costs its ~20ms in whichever test renders first: that is
 * why first tests land around 50-75ms rather than all the way down at their
 * siblings' ~20ms.
 *
 * Not free for everyone: the few jsdom files that never run a role query now
 * pay the parse in setup, having previously never triggered it at all. That is
 * already inside the measured result — the interleaved A/B that took the
 * concurrent-suite repro from 0/15 fully green runs to 8/15 was run with this
 * in place — and it buys every other file a first test that measures its own
 * work rather than the environment's.
 */
if (typeof document !== "undefined") {
  const warmup = document.createElement("button");
  warmup.textContent = "warmup";
  document.body.appendChild(warmup);
  getByRole(document.body, "button", { name: "warmup" });
  warmup.remove();
}
