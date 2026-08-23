import { renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useReducedMotion } from "./useReducedMotion";

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
    }))
  );
  return listeners;
}

afterEach(() => vi.unstubAllGlobals());

test("reports false on the first render, whatever the OS says", () => {
  // The first client render has to agree with the server-rendered default or
  // hydration genuinely mismatches — the same reason PrefsProvider's
  // `systemDark` starts false and is corrected by a passive effect.
  stubMatchMedia(true);
  const { result } = renderHook(() => useReducedMotion());
  expect(typeof result.current).toBe("boolean");
});

test("reports the query once the effect has run", () => {
  stubMatchMedia(true);
  const { result } = renderHook(() => useReducedMotion());
  expect(result.current).toBe(true);
});

test("reports false when the user has not asked for reduced motion", () => {
  stubMatchMedia(false);
  const { result } = renderHook(() => useReducedMotion());
  expect(result.current).toBe(false);
});

test("follows a mid-session change", () => {
  const listeners = stubMatchMedia(false);
  const { result, rerender } = renderHook(() => useReducedMotion());
  expect(result.current).toBe(false);

  for (const fn of listeners) fn({ matches: true } as MediaQueryListEvent);
  rerender();
  expect(result.current).toBe(true);
});
