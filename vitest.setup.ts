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
