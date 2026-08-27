import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DetailsStep } from "@/components/DetailsStep";
import type { Interest, Season } from "@/lib/types";

/**
 * The season chips, scanned as RENDERED TEXT.
 *
 * `lib/meta.test.ts` proves `seasonMonths` agrees with the season a country's
 * profile resolves. It cannot prove that this control calls it, and the defect
 * was invisible to every data-layer test for exactly that reason: the months
 * were a literal string in `SEASONS`, so nothing that asked the country layer a
 * question could ever have seen them. What a Peruvian traveller reads under the
 * word Spring is only observable here.
 */
const NOOP = () => {};

function renderStep(country: string) {
  return render(
    <DetailsStep
      season={"autumn" as Season}
      onSeason={NOOP}
      country={country}
      days={5}
      onDays={NOOP}
      maxDays={21}
      adults={2}
      onAdults={NOOP}
      kids={0}
      onKids={NOOP}
      interests={[] as Interest[]}
      onToggleInterest={NOOP}
    />
  );
}

/** The chip whose label is `name`, as one string — emoji, name and months. */
function chip(name: string): string {
  const heading = screen.getByText(name);
  const button = heading.closest("button");
  expect(button, `no season chip is rendered for ${name}`).not.toBeNull();
  return button!.textContent ?? "";
}

afterEach(cleanup);

describe("the season chips caption themselves with the trip country's months", () => {
  test("a northern country reads the northern calendar", () => {
    renderStep("JP");
    expect(chip("Spring")).toContain("Mar – May");
    expect(chip("Summer")).toContain("Jun – Aug");
    expect(chip("Autumn")).toContain("Sep – Nov");
    expect(chip("Winter")).toContain("Dec – Feb");
  });

  test("China is unchanged", () => {
    renderStep("CN");
    expect(chip("Spring")).toContain("Mar – May");
    expect(chip("Winter")).toContain("Dec – Feb");
  });

  test("a southern country reads its own calendar, not the northern one", () => {
    renderStep("PE");
    // The defect: this chip said "Mar – May" to a Peruvian traveller, whose
    // spring is Sep–Nov. Asserted positively AND negatively, because the
    // negative alone would pass on a chip that rendered nothing at all.
    expect(chip("Spring")).toContain("Sep – Nov");
    expect(chip("Spring")).not.toContain("Mar – May");
    expect(chip("Summer")).toContain("Dec – Feb");
    expect(chip("Autumn")).toContain("Mar – May");
    expect(chip("Winter")).toContain("Jun – Aug");
  });

  test("the 25 countries the previous commit moved south are captioned south too", () => {
    // `SOUTHERN` grew from 34 codes to 59 in the commit before this one, which
    // is what made the contradiction worse rather than better: Gabon's June
    // already resolved to winter while this control still captioned Summer
    // "Jun – Aug". One of the 25, rendered.
    renderStep("GA");
    expect(chip("Summer")).toContain("Dec – Feb");
    expect(chip("Winter")).toContain("Jun – Aug");
  });

  test("a code that is not a country still gets a caption", () => {
    renderStep("ZZ");
    expect(chip("Spring")).toContain("Mar – May");
  });

  test("the chips are the control the wizard actually drives", () => {
    // Arming: the queries above find real buttons, and pressing one reports the
    // season id rather than a label. A scan of dead markup would pass every
    // assertion in this file.
    const onSeason = vi.fn();
    render(
      <DetailsStep
        season={"autumn" as Season}
        onSeason={onSeason}
        country="PE"
        days={5}
        onDays={NOOP}
        maxDays={21}
        adults={2}
        onAdults={NOOP}
        kids={0}
        onKids={NOOP}
        interests={[] as Interest[]}
        onToggleInterest={NOOP}
      />
    );
    const spring = screen.getByText("Spring").closest("button")!;
    spring.click();
    expect(onSeason).toHaveBeenCalledWith("spring");
  });
});
