import type { RefObject } from "react";
import { describe, expect, test, vi } from "vitest";
import { createHoverReporter, type HoverPos } from "./mapShared";

/**
 * `createHoverReporter`'s only behavioural coverage used to be an incidental
 * assertion inside `WorldMap.test.tsx`'s hover test — and even that ran
 * against a jsdom container sitting at (0, 0), so the container-relative
 * subtraction was never actually exercised (subtracting zero is a no-op).
 * Task 38 deleted that test along with the dead `WorldMap.onHoverCountry`
 * prop it exercised, leaving the offset maths with no coverage at all.
 *
 * These tests unit-test the reporter directly against a non-origin container
 * rect, so the subtraction itself is what's asserted.
 */

/** A containerRef whose element reports the given rect, or no element at all. */
function refWithRect(rect: { left: number; top: number } | null): RefObject<HTMLElement | null> {
  if (!rect) return { current: null };
  return {
    current: {
      getBoundingClientRect: () => ({
        left: rect.left,
        top: rect.top,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: rect.left,
        y: rect.top,
        toJSON() {
          return this;
        },
      }),
    } as unknown as HTMLElement,
  };
}

describe("createHoverReporter", () => {
  test("reports the pointer position relative to the container's top-left", () => {
    const onHover = vi.fn<(item: string | null, pos: HoverPos | null) => void>();
    const report = createHoverReporter<string>(refWithRect({ left: 40, top: 20 }), onHover);

    report("FR", { clientX: 120, clientY: 90 });

    expect(onHover).toHaveBeenCalledWith("FR", { x: 80, y: 70 });
  });

  test("clears hover when called with no item", () => {
    const onHover = vi.fn<(item: string | null, pos: HoverPos | null) => void>();
    const report = createHoverReporter<string>(refWithRect({ left: 40, top: 20 }), onHover);

    report(null, { clientX: 120, clientY: 90 });

    expect(onHover).toHaveBeenCalledWith(null, null);
  });

  test("clears hover when called with no event", () => {
    const onHover = vi.fn<(item: string | null, pos: HoverPos | null) => void>();
    const report = createHoverReporter<string>(refWithRect({ left: 40, top: 20 }), onHover);

    report("FR");

    expect(onHover).toHaveBeenCalledWith(null, null);
  });

  test("reports nothing when the container has not mounted", () => {
    const onHover = vi.fn<(item: string | null, pos: HoverPos | null) => void>();
    const report = createHoverReporter<string>(refWithRect(null), onHover);

    report("FR", { clientX: 120, clientY: 90 });

    expect(onHover).not.toHaveBeenCalled();
  });
});
