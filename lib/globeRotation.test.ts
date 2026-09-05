import { geoOrthographic } from "d3-geo";
import { describe, expect, test } from "vitest";
import { MAP_VIEW_H, MAP_VIEW_PAD, MAP_VIEW_W } from "./mapView";
import {
  GLOBE_CX,
  GLOBE_CY,
  GLOBE_R,
  clampPhi,
  isFrontFacing,
  isOnDisc,
  normaliseLambda,
  rotateByDrag,
  rotationAt,
  rotationCentre,
  rotationFor,
  shortestDelta,
  type Rotation,
} from "./globeRotation";

const BUENOS_AIRES: [number, number] = [-58.38, -34.6];
const BEIJING: [number, number] = [116.4, 39.9];
/** Centred on China, where the picker opens for this app's default country. */
const CHINA: Rotation = [-105, -35];

function fitted(rot: Rotation) {
  return geoOrthographic()
    .rotate(rot)
    .fitExtent(
      [
        [MAP_VIEW_PAD, MAP_VIEW_PAD],
        [MAP_VIEW_W - MAP_VIEW_PAD, MAP_VIEW_H - MAP_VIEW_PAD],
      ],
      { type: "Sphere" }
    );
}

describe("the disc constants", () => {
  test("match what d3 actually fits, so nothing hand-copies a stale number", () => {
    // Fitting to {type:"Sphere"} rather than to the features is what stops the
    // disc resizing as countries rotate past the limb — so the fit is a
    // constant, and these three numbers can be. Asserted against d3 itself
    // rather than trusting the derivation.
    const projection = fitted(CHINA);
    const [tx, ty] = projection.translate();

    expect(projection.scale()).toBeCloseTo(GLOBE_R, 6);
    expect(tx).toBeCloseTo(GLOBE_CX, 6);
    expect(ty).toBeCloseTo(GLOBE_CY, 6);
  });

  test("do not move when the globe turns", () => {
    const [tx, ty] = fitted([40, 20]).translate();
    expect(fitted([40, 20]).scale()).toBeCloseTo(GLOBE_R, 6);
    expect(tx).toBeCloseTo(GLOBE_CX, 6);
    expect(ty).toBeCloseTo(GLOBE_CY, 6);
  });
});

describe("isFrontFacing", () => {
  test("rejects a point on the far side that still projects onto the disc", () => {
    // The trap: geoPath clips Argentina's polygon to null, but
    // projection([lon,lat]) happily returns [359.4, 313.8] — 70px from the
    // centre of a 300px disc, drawn over Asia, and fully clickable.
    const [x, y] = fitted(CHINA)(BUENOS_AIRES)!;

    expect(Math.hypot(x - GLOBE_CX, y - GLOBE_CY)).toBeLessThan(GLOBE_R);
    expect(isFrontFacing(BUENOS_AIRES[0], BUENOS_AIRES[1], CHINA)).toBe(false);
  });

  test("accepts a point on the near side", () => {
    expect(isFrontFacing(BEIJING[0], BEIJING[1], CHINA)).toBe(true);
  });

  test("puts the rotation centre itself at the front", () => {
    const [lon, lat] = rotationCentre(CHINA);
    expect(isFrontFacing(lon, lat, CHINA)).toBe(true);
  });

  test("rejects the exact antipode", () => {
    const [lon, lat] = rotationCentre(CHINA);
    expect(isFrontFacing(lon + 180, -lat, CHINA)).toBe(false);
  });
});

describe("isOnDisc", () => {
  test("rejects the viewBox corners, which invert to a real country", () => {
    // Pixel [5,5] inverts to [-7.37, 28.53] — inside Algeria. Without this
    // guard, clicking empty space in the corner of the map selects a country.
    for (const [x, y] of [
      [5, 5],
      [MAP_VIEW_W - 5, 5],
      [5, MAP_VIEW_H - 5],
      [MAP_VIEW_W - 5, MAP_VIEW_H - 5],
    ]) {
      expect(isOnDisc(x, y), `[${x},${y}] should be off-disc`).toBe(false);
    }
  });

  test("accepts the centre and just inside the rim, rejects just outside", () => {
    expect(isOnDisc(GLOBE_CX, GLOBE_CY)).toBe(true);
    expect(isOnDisc(GLOBE_CX + GLOBE_R - 1, GLOBE_CY)).toBe(true);
    expect(isOnDisc(GLOBE_CX + GLOBE_R + 1, GLOBE_CY)).toBe(false);
  });
});

describe("rotationFor", () => {
  test("brings a lon/lat to the centre of the disc", () => {
    const rot = rotationFor(BEIJING[0], BEIJING[1]);
    expect(rotationCentre(rot)[0]).toBeCloseTo(BEIJING[0], 6);
    expect(rotationCentre(rot)[1]).toBeCloseTo(BEIJING[1], 6);
    expect(isFrontFacing(BEIJING[0], BEIJING[1], rot)).toBe(true);
  });

  test("brings the far side round, which is the whole point of the A-Z list", () => {
    // Picking a back-face country from the list must show it, not highlight
    // something invisible on the other side of the planet.
    expect(isFrontFacing(BUENOS_AIRES[0], BUENOS_AIRES[1], CHINA)).toBe(false);
    expect(
      isFrontFacing(BUENOS_AIRES[0], BUENOS_AIRES[1], rotationFor(BUENOS_AIRES[0], BUENOS_AIRES[1]))
    ).toBe(true);
  });
});

describe("clampPhi", () => {
  test("stops the globe tipping past a pole and arriving upside down", () => {
    expect(clampPhi(0)).toBe(0);
    expect(clampPhi(120)).toBe(90);
    expect(clampPhi(-120)).toBe(-90);
  });
});

describe("normaliseLambda", () => {
  test("wraps into (-180, 180] so a spin has no seam", () => {
    expect(normaliseLambda(0)).toBe(0);
    expect(normaliseLambda(190)).toBe(-170);
    expect(normaliseLambda(-190)).toBe(170);
    expect(normaliseLambda(540)).toBe(180);
  });
});

describe("shortestDelta", () => {
  test("takes the short way round the seam", () => {
    expect(shortestDelta(170, -170)).toBe(20);
    expect(shortestDelta(-170, 170)).toBe(-20);
    expect(shortestDelta(0, 90)).toBe(90);
  });
});

describe("rotateByDrag", () => {
  test("dragging right spins the globe eastward", () => {
    expect(rotateByDrag([0, 0], 100, 0)[0]).toBeGreaterThan(0);
  });

  test("dragging down tips the north pole toward the viewer", () => {
    // The surface follows the pointer: pulling down brings the north into the
    // middle of the disc, so the centre's latitude RISES. d3's phi is the
    // negated latitude, so it falls. The previous expectation had the sign the
    // other way and pinned a globe that turned against the hand dragging it.
    const after = rotateByDrag([0, 0], 0, 100);
    expect(after[1]).toBeLessThan(0);
    expect(rotationCentre(after)[1]).toBeGreaterThan(0);
  });

  test("dragging up tips the south pole toward the viewer", () => {
    expect(rotationCentre(rotateByDrag([0, 0], 0, -100))[1]).toBeLessThan(0);
  });

  test("dragging right brings the west of the centre into the middle", () => {
    // The same rule on the other axis, stated in longitude so both share a
    // reading: the point under the pointer travels with it, so what was to
    // the left (west) of the centre arrives there.
    expect(rotationCentre(rotateByDrag([0, 0], 100, 0))[0]).toBeLessThan(0);
  });

  test("clamps the tilt rather than flipping over the pole", () => {
    // Up brings the south pole in and phi climbs; down does the opposite.
    // Either way a drag long enough to go over the pole stops at it.
    expect(rotateByDrag([0, 80], 0, -10_000)[1]).toBe(90);
    expect(rotateByDrag([0, -80], 0, 10_000)[1]).toBe(-90);
  });

  test("a full disc-width drag turns the globe half way round", () => {
    expect(Math.abs(rotateByDrag([0, 0], 2 * GLOBE_R, 0)[0])).toBeCloseTo(180, 6);
  });
});

describe("rotationAt", () => {
  test("starts at `from` and ends at `to`", () => {
    const from: Rotation = [0, 0];
    const to: Rotation = [-116, -40];
    expect(rotationAt(from, to, 0)).toEqual(from);
    const end = rotationAt(from, to, 1);
    expect(end[0]).toBeCloseTo(to[0], 6);
    expect(end[1]).toBeCloseTo(to[1], 6);
  });

  test("clamps t, so a late frame cannot overshoot the target", () => {
    // The driver reads a clock, and a delayed frame hands it t > 1.
    // Overshooting would spin past the country and swing back.
    expect(rotationAt([0, 0], [90, 0], 2)[0]).toBeCloseTo(90, 6);
    expect(rotationAt([0, 0], [90, 0], -1)[0]).toBeCloseTo(0, 6);
  });

  test("crosses the antimeridian the short way", () => {
    // 170E to 170W is 20 degrees, not 340. Without shortestDelta the globe
    // unwinds almost all the way round to reach its neighbour.
    expect(Math.abs(rotationAt([170, 0], [-170, 0], 0.5)[0])).toBeGreaterThan(172);
  });

  test("eases out, so the spin decelerates into place", () => {
    // More than half the distance covered in the first half of the time.
    expect(rotationAt([0, 0], [100, 0], 0.5)[0]).toBeGreaterThan(50);
  });
});
