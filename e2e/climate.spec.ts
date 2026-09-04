// e2e/climate.spec.ts
import { test, expect, type Page } from "@playwright/test";

/**
 * Fit colours worldwide (spec §9.4), against the real committed data.
 *
 * What this reaches that jsdom cannot: the actual `public/climate/PE.json`
 * (750 rows) parsed by the real loader, joined to the actual city shard's
 * elevations, and drawn by a real SVG engine — the unit suite renders two
 * fixture rows. It is also the only test of the whole path from the world
 * level's country list to a coloured pin in another country.
 */

const UNKNOWN = "#8a939f";
/** `FIT_COLORS` less `unknown` — the four colours that are a verdict. */
const VERDICT_COLOURS = new Set(["#2f7d54", "#b98a2f", "#8f9bab", "#c93b2e"]);
const LEGEND = { name: "What the marker colours mean" };
const NOTE = { name: "About these notes" };

/** `/plan` opens on the details step; the map is the step after it. */
async function openTheMap(page: Page) {
  await page.goto("/plan");
  await page.getByRole("button", { name: /Next/ }).first().click();
  await expect(page.getByRole("group", { name: /^Map of / })).toBeVisible({ timeout: 30_000 });
}

/**
 * China → the world level → Peru, through the list rather than the globe:
 * the list is the one path that reaches every country whichever renderer the
 * world level chose, and it is a native select, which Playwright can drive
 * without knowing where Peru is drawn.
 */
async function openPeru(page: Page) {
  await openTheMap(page);
  await page.getByRole("button", { name: "← All countries" }).click();
  await page.getByRole("combobox", { name: "Or pick from the list" }).selectOption({ label: "Peru" });
  await expect(page.getByRole("group", { name: "Map of Peru" })).toBeVisible({ timeout: 30_000 });
}

test("a country outside China draws its cities in verdict colours, from the committed climate shard", async ({
  page,
}) => {
  await openPeru(page);

  const dots = page.locator("[data-markers] [data-place] circle[data-dot]");
  await expect(dots.first()).toBeVisible();
  // Not "every pin is coloured": the nightly catalog can hold a city the
  // climate artifact has not caught up with (lib/climateShard.test.ts bounds
  // that drift), and grey is the honest colour for it. What must be true is
  // that the artifact reached the map at all — before this plan, every one of
  // these was `#8a939f`.
  await expect
    .poll(async () => {
      const fills = await dots.evaluateAll((els) => els.map((el) => el.getAttribute("fill") ?? ""));
      return fills.filter((fill) => VERDICT_COLOURS.has(fill)).length;
    })
    .toBeGreaterThan(0);

  // The key to those colours, and the paragraph saying what they are.
  const legend = page.getByRole("list", LEGEND);
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("Great time");
  await expect(legend).toContainText("No data");
  await expect(page.getByRole("note", NOTE)).toContainText("grid normals");
});

test("hovering a city reads its own temperatures off the same index", async ({ page }) => {
  await openPeru(page);

  // `dispatchEvent` rather than `hover()`: 750 markers' hit circles overlap
  // near Lima, and Playwright's hover refuses an element another one
  // intercepts. React derives onMouseEnter from a bubbling `mouseover`, so a
  // synthetic one on Lima's own group opens Lima's card, whatever is painted
  // over its centre.
  await page.locator('[data-place="G3936456"]').dispatchEvent("mouseover");
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Lima");
  await expect(tooltip).toContainText("°C typical");
  await expect(tooltip).not.toContainText("No data");
});

test("China keeps its curated table, and gets no derived-climate note", async ({ page }) => {
  await openTheMap(page);
  await expect(page.getByRole("group", { name: "Map of China" })).toBeVisible();

  // The legend is for everyone; the note is for derived data only (§9.7:
  // "it renders nothing for China").
  await expect(page.getByRole("list", LEGEND)).toBeVisible();
  await expect(page.getByRole("note", NOTE)).toHaveCount(0);

  await page.locator('[data-place="beijing"]').dispatchEvent("mouseover");
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("North China");
  await expect(tooltip).toContainText("°C typical");

  // And a curated pin is still a curated colour, never the derived grey.
  const fill = await page.locator('[data-place="beijing"] circle[data-dot]').getAttribute("fill");
  expect(fill).not.toBe(UNKNOWN);
});
