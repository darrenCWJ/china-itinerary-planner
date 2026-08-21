import { configure } from "@testing-library/dom";
import "@testing-library/jest-dom/vitest";

/**
 * Testing Library's own `findBy*`/`waitFor` polling window defaults to 1000ms
 * — a separate, shorter timeout than vitest's own per-test `testTimeout`
 * (see vitest.config.ts). Under full-suite parallel load, a handful of tests
 * that do real async work on mount (MapExplorer.test.tsx's topology-fetch
 * tests, in particular — see Minor 9 in the PR4 final review) can take longer
 * than 1000ms to settle purely from CPU contention, not a real hang, and fail
 * with "Unable to find role=..." instead of the vitest-level "Test timed out"
 * message testTimeout alone guards against. Raised here so both timeout
 * layers give the same real headroom, rather than fixing one and leaving the
 * other at its much stricter default.
 */
configure({ asyncUtilTimeout: 5000 });

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
