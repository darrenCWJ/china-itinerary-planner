import { test, expect, type Page } from "@playwright/test";

/**
 * The country map, in a browser, against the real committed data.
 *
 * What this reaches that jsdom cannot: the actual `public/provinces/CN.json`
 * (31 units, `adcode` ids, Chinese names) parsed by the real loader, framed by
 * the real projection manifest, and drawn by a real SVG engine. Every unit
 * test on this surface renders a two-unit fixture whose geometry is a square.
 *
 * It is also the first check that China's map works at all after it stopped
 * having a renderer of its own.
 */

/**
 * `/plan` opens on the trip-details step; the map is the step after it.
 *
 * There is no URL for the map — the wizard holds its step in `useState` — so
 * reaching it is a click, and that is worth saying once here rather than in
 * every spec.
 */
async function openTheMap(page: Page) {
  await page.goto("/plan");
  await page.getByRole("button", { name: /Next/ }).first().click();
  await expect(page.getByRole("group", { name: /^Map of / })).toBeVisible({ timeout: 30_000 });
}

test("China renders the same country map as everywhere else", async ({ page }) => {
  await openTheMap(page);

  // `ChinaLevel` announced itself as "Map of China segmented by region" and
  // drew no units. This is `CountryLevel`'s group name and `CountryLevel`'s
  // markup, which is the whole of what standardising China means.
  await expect(page.getByRole("group", { name: "Map of China" })).toBeVisible();
  await expect(page.locator("[data-units] path").first()).toBeVisible();
});

test("China has the province picker it used to be the only country without", async ({ page }) => {
  await openTheMap(page);

  const picker = page.getByRole("combobox", { name: "Zoom to a province" });
  await expect(picker).toBeVisible();

  // The real file, so the real count: 31 selectable units plus the "All of
  // China" option. Asserted as a floor rather than an equality because the
  // number is Natural Earth's to change, and an assertion that breaks on a
  // data refresh teaches people to delete assertions.
  const options = await picker.locator("option").allTextContents();
  expect(options.length).toBeGreaterThan(20);
  expect(options[0]).toMatch(/All of China/);

  // In English, off `lib/provinces.ts` — every CN unit has `name_en: null`, so
  // a label that fell through to the endonym would put 北京市 in the control.
  expect(options.some((o) => o.includes("Beijing"))).toBe(true);
  expect(options.some((o) => /[一-鿿]/.test(o))).toBe(false);
});

test("picking a province frames it, and the way back out appears", async ({ page }) => {
  await openTheMap(page);

  const picker = page.getByRole("combobox", { name: "Zoom to a province" });
  await picker.selectOption({ label: "Beijing" });

  // The framing is a CSS transform on the zoom group, not the SVG `transform`
  // attribute — `CountryLevel` uses the CSS one because it is the one that
  // transitions. So this reads the COMPUTED style, which is also the only
  // form a browser can confirm actually applied: jsdom would hand back the
  // inline string whether or not any engine understood it.
  //
  // An identity matrix is what a group id that stopped resolving produces, and
  // it looks exactly like a country that simply has not zoomed.
  const zoom = page.locator("[data-zoom]");
  await expect
    .poll(async () => zoom.evaluate((el) => getComputedStyle(el).transform))
    .not.toMatch(/^(none|matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\))$/);

  await expect(page.getByRole("button", { name: "← All China" })).toBeVisible();
});

test("China has the airport layer it used to be the only country without", async ({ page }) => {
  await openTheMap(page);

  // `canDrawAirports` was `!hasCurated && …`, so this control could not exist
  // for China however many airports the country had.
  const toggle = page.getByRole("button", { name: "Airports" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-airports] [data-airport]").first()).toBeVisible();
});

test("the airport layer adds no interactive target", async ({ page }) => {
  // §10.1: an airport is never a trip stop. The unit suite pins this as a
  // compiler rule and as a DOM attribute; here it is the real accessibility
  // tree, which is the thing the rule is actually about.
  await openTheMap(page);

  const before = await page.getByRole("button").count();
  await page.getByRole("button", { name: "Airports" }).click();
  await expect(page.locator("[data-airports] [data-airport]").first()).toBeVisible();

  expect(await page.getByRole("button").count()).toBe(before);
});
