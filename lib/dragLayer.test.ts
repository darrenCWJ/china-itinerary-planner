import { describe, expect, test } from "vitest";
import { containsPoint, dropIndexFor, moveStepsFor, type Box } from "./dragLayer";

/**
 * The drag *feel* is verified by hand — the plan says so and a jsdom pointer
 * stream can only fake it. What is testable is the arithmetic underneath, which
 * is where an off-by-one silently reorders a shared plan.
 *
 * Rows are deliberately uneven here: a timed block carries three more controls
 * than an untimed one, so the real list has rows of very different heights.
 */

/** `space-y-2` in the day list, so rows are 8px apart with a real gap between. */
const rows = (heights: readonly number[], gap = 8): Box[] => {
  let top = 100;
  return heights.map((height) => {
    const box = { top, height };
    top += height + gap;
    return box;
  });
};

describe("dropIndexFor", () => {
  test("an empty list has one slot", () => {
    expect(dropIndexFor(240, [])).toBe(0);
  });

  test("above the first midpoint inserts before everything", () => {
    const boxes = rows([40, 40, 40]);
    expect(dropIndexFor(boxes[0].top + 1, boxes)).toBe(0);
  });

  test("below the last midpoint inserts after everything", () => {
    const boxes = rows([40, 40, 40]);
    const last = boxes[2];
    expect(dropIndexFor(last.top + last.height - 1, boxes)).toBe(3);
  });

  test("past the end of the list still inserts after everything", () => {
    const boxes = rows([40, 40]);
    expect(dropIndexFor(10_000, boxes)).toBe(2);
  });

  test("the gap between two rows resolves to the boundary between them", () => {
    const boxes = rows([40, 40]);
    // 148: past the first row's bottom (140), before the second's top (148).
    expect(dropIndexFor(147, boxes)).toBe(1);
  });

  test("uses each row's own midpoint, not a uniform stride", () => {
    // 100..200 tall, then 208..248 short. A stride-based guess derived from the
    // first row would put 230 in the first half of row two and answer 1.
    const boxes = rows([100, 40]);
    expect(dropIndexFor(230, boxes)).toBe(2);
    expect(dropIndexFor(120, boxes)).toBe(0);
    expect(dropIndexFor(160, boxes)).toBe(1);
  });

  test("a pointer exactly on a midpoint falls to the slot below it", () => {
    const boxes = rows([40]);
    expect(dropIndexFor(boxes[0].top + 20, boxes)).toBe(1);
  });
});

describe("moveStepsFor", () => {
  test("dropping a row where it already sits emits nothing", () => {
    // Both insertion points that touch the row itself: above it and below it.
    expect(moveStepsFor(2, 2)).toEqual([]);
    expect(moveStepsFor(2, 3)).toEqual([]);
  });

  test("one step down when the insertion point clears the next row", () => {
    // [a,b,c] with a dragged between b and c → [b,a,c].
    expect(moveStepsFor(0, 2)).toEqual(["down"]);
  });

  test("one step up when the insertion point is the slot above", () => {
    expect(moveStepsFor(1, 0)).toEqual(["up"]);
  });

  test("a long drag is one op per row crossed", () => {
    // No insert-at-index op exists, so this is genuinely N requests — the same
    // N the keyboard control emits for N presses.
    expect(moveStepsFor(0, 4)).toEqual(["down", "down", "down"]);
    expect(moveStepsFor(4, 1)).toEqual(["up", "up", "up"]);
  });

  test("dropping at the end of a five-row list moves the first row four times", () => {
    expect(moveStepsFor(0, 5)).toEqual(["down", "down", "down", "down"]);
  });
});

describe("containsPoint", () => {
  const rect = { left: 10, top: 20, width: 100, height: 50 };

  test("accepts a point inside and on the edges", () => {
    expect(containsPoint(rect, 60, 40)).toBe(true);
    expect(containsPoint(rect, 10, 20)).toBe(true);
    expect(containsPoint(rect, 110, 70)).toBe(true);
  });

  test("rejects a point outside on either axis", () => {
    expect(containsPoint(rect, 9, 40)).toBe(false);
    expect(containsPoint(rect, 111, 40)).toBe(false);
    expect(containsPoint(rect, 60, 19)).toBe(false);
    expect(containsPoint(rect, 60, 71)).toBe(false);
  });
});
