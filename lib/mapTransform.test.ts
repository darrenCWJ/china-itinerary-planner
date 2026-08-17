import { describe, expect, test } from "vitest";
import {
  IDENTITY_TRANSFORM,
  MAX_ZOOM_K,
  ZOOM_FILL,
  transformForBounds,
  type MapTransform,
  type PixelBounds,
} from "./mapTransform";

/** The map's real viewBox, so the fixtures below are the numbers that ship. */
const W = 860;
const H = 620;

/** Where a viewBox point lands after the transform is applied. */
function apply(t: MapTransform, [x, y]: [number, number]): [number, number] {
  return [t.k * x + t.tx, t.k * y + t.ty];
}

function centreOf([[x0, y0], [x1, y1]]: PixelBounds): [number, number] {
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

describe("transformForBounds — hand-computed fixtures", () => {
  test("height-constrained square: 620/200 · 0.88 = 2.728", () => {
    // dx = dy = 200. 860/200 = 4.3, 620/200 = 3.1 → height constrains.
    const t = transformForBounds(
      [
        [100, 100],
        [300, 300],
      ],
      W,
      H
    );
    expect(t.k).toBeCloseTo(2.728, 10);
    // 430 − 2.728·400/2 = 430 − 545.6
    expect(t.tx).toBeCloseTo(-115.6, 8);
    expect(t.ty).toBeCloseTo(-235.6, 8);
  });

  test("width-constrained letterbox: 860/860 · 0.88 = 0.88", () => {
    // dx = 860, dy = 100. 860/860 = 1, 620/100 = 6.2 → width constrains.
    const t = transformForBounds(
      [
        [0, 0],
        [860, 100],
      ],
      W,
      H
    );
    expect(t.k).toBeCloseTo(0.88, 10);
    expect(t.tx).toBeCloseTo(51.6, 8); // 430 − 0.88·860/2
    expect(t.ty).toBeCloseTo(266, 8); //  310 − 0.88·100/2
  });

  test("tiny region clamps to k = 5 instead of 136.4", () => {
    // dx = dy = 4 would fit at 0.88 · 155 = 136.4 without the ceiling.
    const t = transformForBounds(
      [
        [400, 300],
        [404, 304],
      ],
      W,
      H
    );
    expect(t.k).toBe(5);
    expect(t.tx).toBeCloseTo(-1580, 8); // 430 − 5·804/2
    expect(t.ty).toBeCloseTo(-1200, 8); // 310 − 5·604/2
  });
});

describe("transformForBounds — what the maths guarantees", () => {
  const cases: Array<{ name: string; bounds: PixelBounds }> = [
    { name: "square, off-centre", bounds: [[100, 100], [300, 300]] },
    { name: "wide and flat", bounds: [[0, 0], [860, 100]] },
    { name: "tall and narrow", bounds: [[300, 20], [360, 600]] },
    { name: "near-full extent", bounds: [[10, 10], [850, 610]] },
    { name: "negative origin (projection can go off-canvas)", bounds: [[-120, -40], [180, 260]] },
  ];

  test.each(cases)("$name: the region's centre lands on the view centre", ({ bounds }) => {
    const t = transformForBounds(bounds, W, H);
    const [cx, cy] = apply(t, centreOf(bounds));
    expect(cx).toBeCloseTo(W / 2, 8);
    expect(cy).toBeCloseTo(H / 2, 8);
  });

  test.each(cases)("$name: the scaled region fits inside the viewBox", ({ bounds }) => {
    const t = transformForBounds(bounds, W, H);
    const [x0, y0] = apply(t, bounds[0]);
    const [x1, y1] = apply(t, bounds[1]);
    // Fits with room to spare on both axes — this is what would break if the
    // constraining axis were picked with `max` instead of `min`.
    expect(x1 - x0).toBeLessThanOrEqual(W);
    expect(y1 - y0).toBeLessThanOrEqual(H);
    expect(x0).toBeGreaterThanOrEqual(0);
    expect(y0).toBeGreaterThanOrEqual(0);
  });

  test.each(cases)("$name: the constraining axis fills exactly 88%", ({ bounds }) => {
    const t = transformForBounds(bounds, W, H);
    const [x0, y0] = apply(t, bounds[0]);
    const [x1, y1] = apply(t, bounds[1]);
    // One axis is snug at ZOOM_FILL of the view; the other is looser. Pinning
    // the tighter axis catches a changed fill ratio, and pinning that the
    // *other* axis is not also snug catches a stretch (non-uniform k).
    const fillX = (x1 - x0) / W;
    const fillY = (y1 - y0) / H;
    expect(Math.max(fillX, fillY)).toBeCloseTo(ZOOM_FILL, 8);
    expect(Math.min(fillX, fillY)).toBeLessThanOrEqual(ZOOM_FILL + 1e-9);
  });

  test("scale ignores where the region sits — only how big it is", () => {
    const a = transformForBounds(
      [
        [100, 100],
        [300, 300],
      ],
      W,
      H
    );
    const b = transformForBounds(
      [
        [500, 240],
        [700, 440],
      ],
      W,
      H
    );
    expect(b.k).toBeCloseTo(a.k, 12);
    // Sliding the region right by 400 pulls the translate left by k·400.
    expect(b.tx).toBeCloseTo(a.tx - a.k * 400, 8);
    expect(b.ty).toBeCloseTo(a.ty - a.k * 140, 8);
  });

  test("the ceiling holds for every region small enough to hit it", () => {
    for (const extent of [0.5, 1, 4, 20, 80, 109]) {
      // 0.88 · 620/extent > 5 for any extent below ~109px.
      const t = transformForBounds(
        [
          [400, 300],
          [400 + extent, 300 + extent],
        ],
        W,
        H
      );
      expect(t.k).toBe(MAX_ZOOM_K);
    }
    // And just past the ceiling the maths takes over again, below 5.
    const justBelow = transformForBounds(
      [
        [400, 300],
        [520, 420],
      ],
      W,
      H
    );
    expect(justBelow.k).toBeLessThan(MAX_ZOOM_K);
    expect(justBelow.k).toBeCloseTo((0.88 * 620) / 120, 10);
  });

  test("a clamped region genuinely overflows, so the clamp is observable", () => {
    const bounds: PixelBounds = [
      [400, 300],
      [404, 304],
    ];
    const t = transformForBounds(bounds, W, H);
    // Clamping trades "the region fills 88%" for "the strokes stay legible":
    // the 4px region ends up 20px wide, nowhere near the fill ratio.
    expect(t.k * 4).toBe(20);
    expect((t.k * 4) / W).toBeLessThan(ZOOM_FILL);
    // The cost is that the surrounding map spills off-canvas — the map's own
    // left edge lands 1580px outside the viewBox.
    expect(apply(t, [0, 0])[0]).toBeCloseTo(-1580, 8);
  });
});

describe("IDENTITY_TRANSFORM", () => {
  test("leaves every point where it is", () => {
    expect(IDENTITY_TRANSFORM).toEqual({ k: 1, tx: 0, ty: 0 });
    expect(apply(IDENTITY_TRANSFORM, [123, 456])).toEqual([123, 456]);
  });
});
