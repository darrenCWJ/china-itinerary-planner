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
 * `/plan` opens on the trip-details step; the map is the step after it, and
 * it opens on the world level — so a country's map is one more pick away.
 * China is chosen from the A–Z list rather than the globe: the list is a
 * native select Playwright can drive without knowing where China is drawn.
 *
 * There is no URL for the map — the wizard holds its step in `useState` — so
 * reaching it is a click, and that is worth saying once here rather than in
 * every spec.
 */
async function openTheWorld(page: Page) {
  await page.goto("/plan");
  await page.getByRole("button", { name: /Next/ }).first().click();
  await expect(page.getByRole("group", { name: /^World globe/ })).toBeVisible({ timeout: 30_000 });
}

/**
 * Waits on the A–Z list rather than on the globe's group, so the flat
 * renderer — reduced motion, or the preference — reaches China's map too.
 * Only the two globe tests below need the globe itself.
 */
async function openTheMap(page: Page) {
  await page.goto("/plan");
  await page.getByRole("button", { name: /Next/ }).first().click();
  await page.getByRole("combobox", { name: "Or pick from the list" }).selectOption({ label: "China" });
  await expect(page.getByRole("group", { name: /^Map of / })).toBeVisible({ timeout: 30_000 });
}

test("the destinations step opens on the globe, not on a country", async ({ page }) => {
  await openTheWorld(page);

  // No country map yet — the globe is the picker, and the pick has not been
  // made. Before this the step opened on China's map with the globe a
  // "Change country" click away, which read as a China planner with a world
  // map bolted on.
  await expect(page.getByRole("group", { name: /^Map of / })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Where in the world?" })).toBeVisible();
  // And no way "back" to a country the planner has not opened.
  await expect(page.getByRole("button", { name: /^← Back to/ })).toHaveCount(0);
});

test("dragging the globe turns it the way the pointer moves", async ({ page }) => {
  await openTheWorld(page);
  const globe = page.getByRole("group", { name: /^World globe/ });
  const box = await globe.boundingBox();
  if (!box) throw new Error("the globe has no bounding box");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // China sits at the centre of the opening rotation. Its node is the ruler:
  // where it is drawn before and after a drag says which way the globe turned.
  const china = page.getByRole("button", { name: /^China/ });
  const before = await china.boundingBox();
  if (!before) throw new Error("China is not drawn");

  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 60, centre.y + 60, { steps: 10 });
  await page.mouse.up();

  // The surface follows the hand: down-and-right takes China down and right.
  // Measured in the browser before the fix: an 80px drag down moved China
  // 115px UP, while the horizontal axis was already right.
  await expect
    .poll(async () => {
      const after = await china.boundingBox();
      return after ? { dx: Math.sign(after.x - before.x), dy: Math.sign(after.y - before.y) } : null;
    })
    .toEqual({ dx: 1, dy: 1 });
});

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
