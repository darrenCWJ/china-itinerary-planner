import { expect, test } from "@playwright/test";

/**
 * The ticket form's placeholders, end to end: the server stamps a Peru trip
 * with its gateways from the real airports artifact, and the form's hints
 * read them back — the stops by name, the gateways by code, the price in
 * soles. Peru for the reason gateways.spec.ts gives: LIM and CUZ are
 * unambiguous, and PEN has no symbol in lib/money.ts, so the price hint is
 * the code-first fallback that most of the world's currencies take.
 */
test("the ticket form's examples are the trip's own stops, gateways and currency", async ({
  page,
}) => {
  const created = await page.request.post("/api/trips", {
    data: {
      tripName: "Peru tickets",
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

  await page.goto(`/trip/${id}?tab=kit`);
  await page.getByRole("button", { name: "+ Add ticket" }).click();

  // Train is the form's opening kind: names, no codes.
  await expect(page.getByPlaceholder("Lima")).toBeVisible();
  await expect(page.getByPlaceholder("Cusco")).toBeVisible();
  await expect(page.getByPlaceholder("PEN 553.00")).toBeVisible();

  await page.getByRole("button", { name: /Flight/ }).click();
  await expect(page.getByPlaceholder("Lima or LIM")).toBeVisible();
  await expect(page.getByPlaceholder("Cusco or CUZ")).toBeVisible();
  await expect(page.getByPlaceholder("Flight number")).toBeVisible();

  // Nothing Chinese survives on a Peruvian form.
  await expect(page.getByPlaceholder(/Beijing|Shanghai|¥/)).toHaveCount(0);
});
