import { act } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CHINA_BASELINE_MARKUP,
  CHINA_FIXTURE,
  CHINA_MONTH,
  CHINA_PLACES,
  CHINA_ROUTE_IDS,
} from "./chinaBaseline";
import { CountryMap } from "./CountryMap";
import { PlacePopup } from "./PlacePopup";
import { ZOOM_MS } from "./mapShared";

/**
 * §9.5's success test: **China's rendered output is byte-identical before and
 * after Phase 4.** "Any change to a China pin colour or popup line is a
 * regression, and this is the only thing that would catch it."
 *
 * Every other Phase 4 test asserts a property — that a control exists, that a
 * fetch was aimed at the right file, that a scale follows from its bounds. None
 * of them can catch China getting *slightly different*, because nobody wrote
 * down what China looked like. `chinaBaseline.ts` did: its markup strings came
 * out of the pre-Phase-4 components at commit `3030f29`, not out of this tree,
 * so this file is a comparison against the past rather than a snapshot of the
 * present.
 *
 * That is what makes it worth the 12 KB of frozen markup. Phase 4 moved the
 * dispatcher around `ChinaLevel`, lifted `originLine` out of `PlacePopup` into
 * `mapTypes.originLineFor`, and added a second consumer of it — three edits
 * that each *could* have moved a China surface by a character and that no
 * behavioural assertion in the suite would have noticed.
 *
 * The two China renders are driven through `CountryMap`, not through
 * `ChinaLevel` directly, because the dispatcher in front of it is the thing
 * Phase 4 actually rewrote: a routing mistake that sent China through
 * `CountryLevel` would draw a real map, pass every list assertion, and fail
 * only here.
 *
 * The other half of §9.5 lives in `MapExplorer.test.tsx`'s "China still fetches
 * the curated asset and renders identically", which pins the INPUT — that China
 * still reaches for `/china-provinces.json` and never for `/provinces/CN.json`
 * or the manifest. That test proves China is drawn from the same bytes; this one
 * proves the same bytes still draw the same map.
 */

afterEach(cleanup);

/**
 * The markup after the zoom transition has run.
 *
 * `useMarkersVisible` hides the marker group on mount and restores it
 * `ZOOM_MS` later, so a render read at mount pins `opacity: 0` and says nothing
 * about the state a user actually looks at. Fake timers rather than
 * `waitFor`, because the value being captured is a string: it has to be read at
 * one definite point, not at whichever point a poll happened to settle.
 */
function settledMarkup(node: React.ReactElement): string {
  vi.useFakeTimers();
  try {
    const { container } = render(node);
    act(() => {
      vi.advanceTimersByTime(ZOOM_MS);
    });
    return container.innerHTML;
  } finally {
    vi.useRealTimers();
  }
}

const level = {
  places: CHINA_PLACES,
  selected: ["beijing", "shanghai"],
  month: CHINA_MONTH,
  routeIds: CHINA_ROUTE_IDS,
  onZoomRegion: () => {},
  onTogglePlace: () => {},
  onHoverPlace: () => {},
};

/**
 * The two props the dispatcher gained in Phase 4, both null.
 *
 * Null is the honest value: `MapExplorer` fetches the curated asset for China
 * and neither the province file nor a manifest entry, so this is the shape
 * China is really rendered with. It also pins the routing — a dispatcher that
 * preferred `provinces` when it happened to be present would be caught by
 * `CountryLevel.test.tsx`, but a dispatcher that started *requiring* them for
 * China would draw nothing and be caught here.
 */
const phase4 = { provinces: null, projection: null };

describe("China's rendered output — §9.5", () => {
  test("the country level is byte-identical to pre-Phase-4", () => {
    const markup = settledMarkup(
      <CountryMap country="CN" topology={CHINA_FIXTURE} zoomRegion={null} {...phase4} {...level} />
    );

    expect(markup).toBe(CHINA_BASELINE_MARKUP.country);
  });

  test("an opened region is byte-identical to pre-Phase-4", () => {
    // The zoomed branch is a separate baseline because `k` is no longer 1
    // there: every stroke width, radius, dash length and font size is divided
    // by it, the dimmed provinces take a different stroke token, and the
    // region labels and the nine-dash line drop out. A regression that touched
    // only the scale-invariance discipline would leave the country render
    // above untouched.
    const markup = settledMarkup(
      <CountryMap country="CN" topology={CHINA_FIXTURE} zoomRegion="East" {...phase4} {...level} />
    );

    expect(markup).toBe(CHINA_BASELINE_MARKUP.region);
  });

  test("a curated place's popup is byte-identical to pre-Phase-4", () => {
    // Phase 4 lifted this component's `originLine` into `mapTypes` so §5.3.3's
    // card could make the same claim. The extraction is meant to be behaviour
    // preserving and reads as though it is; "North China" here is the proof,
    // along with the climate row, the season note, the highlight, the crowd
    // dots and the holiday glyph that come with it.
    const { container } = render(
      <PlacePopup
        place={CHINA_PLACES[0]}
        month={CHINA_MONTH}
        position={{ x: 400, y: 220 }}
        containerWidth={860}
        country="CN"
      />
    );

    expect(container.innerHTML).toBe(CHINA_BASELINE_MARKUP.popupCurated);
  });

  test("a catalog city's popup is byte-identical to pre-Phase-4", () => {
    // The other half of `originLineFor`: a catalog place has a province, so the
    // origin line is "Sichuan · municipality" and never reaches the
    // `isChinaRegion` fallback the curated case above depends on. One baseline
    // could not have covered both.
    const { container } = render(
      <PlacePopup
        place={CHINA_PLACES[2]}
        month={CHINA_MONTH}
        position={{ x: 120, y: 40 }}
        containerWidth={860}
        country="CN"
      />
    );

    expect(container.innerHTML).toBe(CHINA_BASELINE_MARKUP.popupCatalog);
  });

  test("the baseline is a record of the past, not of this render", () => {
    // The failure mode this whole file exists to avoid: a baseline captured
    // from HEAD passes forever and proves nothing. These are the values a
    // re-capture would have to reproduce, spelled out — the curated pin's
    // `great` green and unscaled radius 7, the North tint at October's fill
    // opacity, and the popup's origin line — so a refresh that quietly
    // absorbed a real change is visible as a diff on this test too.
    expect(CHINA_BASELINE_MARKUP.country).toContain('fill="#2f7d54"');
    expect(CHINA_BASELINE_MARKUP.country).toContain('r="7"');
    expect(CHINA_BASELINE_MARKUP.country).toContain('fill="#8a6d3b"');
    expect(CHINA_BASELINE_MARKUP.country).toContain('fill-opacity="0.5"');
    expect(CHINA_BASELINE_MARKUP.popupCurated).toContain(">North China<");
    expect(CHINA_BASELINE_MARKUP.popupCatalog).toContain(">Sichuan · municipality<");
  });
});
