import { expect, test } from "@playwright/test";

/**
 * The whole gateway path in one browser: the server stamps a new trip from
 * the real airports artifact, the strip shows it, a member changes one side,
 * the change survives a reload, and the plan it sits above is untouched.
 *
 * Peru rather than China because Peru's answer is unambiguous: Lima's main
 * airport is LIM and Cusco's is CUZ, both `large`, nothing else within reach.
 * The ids are GeoNames ids from public/cities/PE.json.
 */
test("a new trip is stamped with its gateways, and a member can change one without losing the plan", async ({
  page,
}) => {
  const created = await page.request.post("/api/trips", {
    data: {
      tripName: "Peru gateways",
      month: 7,
      input: {
        destinationIds: ["G3936456", "G3941584"],
        days: 5,
        season: "winter",
        adults: 2,
        kids: 0,
        interests: ["history"],
        country: "PE",
      },
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  await page.goto(`/trip/${id}?tab=plan`);
  const strip = page.getByTestId("gateways");
  await expect(strip).toContainText("Fly in via LIM");
  await expect(strip).toContainText("out via CUZ");
  // DayCard's heading is "Day " + a zero-padded number ("Day 01", "Day 02", …),
  // not "Day 1" — matched loosely here because the assertion's job is only
  // that the same number of day cards exist before and after the edit.
  const daysBefore = await page.getByText(/^Day \d+/).count();
  expect(daysBefore).toBeGreaterThan(0);

  await strip.getByRole("button", { name: "Edit gateways" }).click();
  await strip.getByLabel("Depart from").fill("AQP");
  await strip.getByRole("button", { name: "Save" }).click();
  await expect(strip).toContainText("out via AQP");

  await page.reload();
  await expect(page.getByTestId("gateways")).toContainText("out via AQP");
  await expect(page.getByTestId("gateways")).toContainText("Fly in via LIM");
  // The plan survived the edit: this route never rebuilds it.
  expect(await page.getByText(/^Day \d+/).count()).toBe(daysBefore);
});

test("an unknown code is refused, with the reason on screen", async ({ page }) => {
  const created = await page.request.post("/api/trips", {
    data: {
      tripName: "Peru typo",
      month: 7,
      input: {
        destinationIds: ["G3936456"],
        days: 2,
        season: "winter",
        adults: 1,
        kids: 0,
        interests: [],
        country: "PE",
      },
    },
  });
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/trip/${id}?tab=plan`);
  const strip = page.getByTestId("gateways");
  await strip.getByRole("button", { name: "Edit gateways" }).click();
  await strip.getByLabel("Arrive at").fill("ZZZ");
  await strip.getByRole("button", { name: "Save" }).click();
  await expect(strip).toContainText("Unknown airport code ZZZ");
});
