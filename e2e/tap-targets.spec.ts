import { test, expect, type Page } from "@playwright/test";

/**
 * WCAG 2.2 AA 2.5.8, measured instead of computed.
 *
 * This is the spec the project did not have and most needed. Every tap-target
 * assertion in the 2,368-test unit suite runs in jsdom, which computes NO
 * layout: `getBoundingClientRect` is all zeroes there and CSS variables are
 * strings nothing resolves. So the suite asserts either an `r` attribute
 * against a number the test derived itself, or — worse — that a CLASS NAME is
 * present. `expect(chip.className).toContain("min-h-[var(--tap-min)]")` passes
 * whether or not `--tap-min` exists, resolves, or applies to that display type.
 *
 * The first run of this file found a control that was 24px tall for exactly
 * that reason (the map/cards view toggle, which had no size class at all).
 *
 * Runs at a phone width (Pixel 5, 393 CSS px) because that is the claim: a
 * control that clears 44px at 1120px can be half that on a phone, and the
 * phone is where the standard applies.
 */

const TAP_MIN_PX = 44;

async function openTheMap(page: Page) {
  await page.goto("/plan");
  await page.getByRole("button", { name: /Next/ }).first().click();
  await expect(page.getByRole("group", { name: /^Map of / })).toBeVisible({ timeout: 30_000 });
}

test("map markers are widened targets, never smaller than their own dot", async ({ page }) => {
  // NOT "every marker is 44px". That is impossible and the app says so: China
  // draws over a thousand markers, and 44px targets on a 393px screen would
  // overlap so heavily that paint order would decide which city a tap added.
  // `CountryLevel` caps each hit circle at half the distance to its nearest
  // neighbour instead, and conforms through WCAG 2.5.8's "Equivalent"
  // exception — the place list, asserted below, is the conforming control.
  //
  // What that leaves worth measuring is the invariant the cap is FOR.
  await openTheMap(page);

  const boxes = await page
    .locator("[data-markers] [data-place] circle[data-hit]")
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        const dot = el.parentElement?.querySelector("circle[data-dot]")?.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, dot: dot?.width ?? 0 };
      })
    );

  expect(boxes.length).toBeGreaterThan(0);

  // A hit target smaller than the dot drawn inside it makes the dot's own edge
  // the target's edge, which is worse than either.
  const swallowed = boxes.filter((b) => b.w + 1e-6 < b.dot);
  expect(swallowed, `${swallowed.length} hit circles smaller than their dot`).toEqual([]);

  // And the widening mechanism is alive: a cap that returned the dot radius
  // unconditionally would satisfy the check above and give the map no targets
  // at all, so at least the most isolated marker has to be bigger than its dot.
  //
  // The MAX and not the median, and that is a measurement worth writing down:
  // at country level on China the median ratio is exactly 1.00. For more than
  // half of 1,081 markers the tap target IS the visible dot — about 5 CSS px —
  // because at 393px there is no room between them for anything larger. The
  // cap is not a safety margin here, it is fully binding, and §5.2's list is
  // not a fallback for the map's accessibility so much as the whole of it.
  const ratios = boxes.filter((b) => b.dot > 0).map((b) => b.w / b.dot).sort((a, b) => a - b);
  expect(ratios.length).toBeGreaterThan(0);
  expect(ratios[ratios.length - 1]).toBeGreaterThan(1);

  // NOT asserted here: that no two hit circles overlap anywhere on the map.
  // Measured, and they do — 96 overlapping pairs in the first 120 markers of
  // China at country level. `CountryLevel.test.tsx` proves the cap holds for a
  // PAIR, and it does; what does not follow, and is not implemented, is that
  // it holds across 1,081 markers, where a third marker can sit inside a gap
  // two others already sized themselves against. Left as a finding rather than
  // silently weakened into an assertion that passes.
});

test("the place list is a real 44px target, since it is what makes the map conform", async ({
  page,
}) => {
  // The load-bearing one. §5.2 makes `CountryPlaceList` the surface that
  // reaches every city the map cannot, and the marker cap above is only
  // defensible because of it — so if these chips are not real targets, the
  // map's conformance argument collapses with them.
  //
  // The unit suite checks this by looking for the class string. This measures.
  await openTheMap(page);

  const chips = page.locator("section[role='group'] button");
  const count = await chips.count();
  expect(count).toBeGreaterThan(0);

  const short: string[] = [];
  for (let i = 0; i < Math.min(count, 15); i += 1) {
    const box = await chips.nth(i).boundingBox();
    if (!box) continue;
    if (box.height < TAP_MIN_PX) {
      short.push(`${(await chips.nth(i).textContent())?.trim()} ${box.height}px`);
    }
  }
  expect(short, `list chips under ${TAP_MIN_PX}px: ${short.join(", ")}`).toEqual([]);
});

test("every button in the map's chrome is a real 44px target", async ({ page }) => {
  // Swept rather than named, because the one this found was a control no test
  // had thought to name: the map/cards toggle, 24px, with `aria-pressed` fully
  // asserted in jsdom and its height asserted nowhere.
  await openTheMap(page);

  const undersized = await page.evaluate((min) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("button")) {
      const box = el.getBoundingClientRect();
      // Skip what is not on screen, and the list chips (covered above).
      if (box.width === 0 || box.height === 0) continue;
      if (el.closest("section[role='group']")) continue;
      // Scoped to the map panel. The wizard's own chrome around it has
      // undersized controls of its own — measured at 393px: "← Back" 38px,
      // "Build my plan →" 36px, the step rail's "Destinations" 32px — and they
      // are a pre-existing failure of the same criterion on a different
      // surface, not something the map owns. Widening this sweep to the page
      // would mean fixing them here, silently, in a change about the map.
      if (!el.closest("[data-map-panel]")) continue;
      if (box.height < min) out.push(`${(el.textContent ?? "?").trim().slice(0, 30)} ${box.height}px`);
    }
    return out;
  }, TAP_MIN_PX);

  expect(undersized, `chrome buttons under ${TAP_MIN_PX}px: ${undersized.join(", ")}`).toEqual([]);
});
