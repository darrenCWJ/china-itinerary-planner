import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TripInput } from "@/lib/itinerary";
import type { Destination } from "@/lib/types";
import { PlanStep } from "./PlanStep";

/**
 * T28, surface 1 of 3: the wizard's plan preview.
 *
 * What is under test is the honesty surface reaching a user — that the gap note
 * is drawn, that it is drawn from the *country* rather than from the plan, and
 * that it is structurally a note rather than a sixth tip. The itinerary itself
 * has its own suites; nothing here asserts on the day list.
 *
 * `ShareTripCard` calls `useRouter`, which jsdom has no provider for.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * One destination per country, minimal but real: `buildItinerary` returns an
 * empty plan with no tips when it can resolve no destination, and an empty tips
 * list is exactly the case that would make "the note is not inside the tips
 * list" pass vacuously.
 */
function destination(overrides: Partial<Destination> & Pick<Destination, "id" | "name" | "country">): Destination {
  return {
    localName: null,
    region: "",
    lat: null,
    lon: null,
    emoji: "📍",
    tagline: "",
    knownFor: [],
    bestSeasons: [],
    seasonNotes: {},
    foods: ["ceviche"],
    suggestedDays: [2, 4],
    activities: [
      { name: "Walk the old town", interests: ["history"], slots: 1, timeOfDay: "any" },
    ],
    ...overrides,
  };
}

const LIMA = destination({ id: "G3936456", name: "Lima", country: "PE" });
const ST_HELENA = destination({ id: "G3370903", name: "Jamestown", country: "SH" });
const BEIJING = destination({ id: "beijing", name: "Beijing", country: "CN" });

function input(country: string, destinationId: string): TripInput {
  return {
    destinationIds: [destinationId],
    days: 3,
    season: "winter",
    adults: 2,
    kids: 0,
    interests: ["history"],
    country,
  };
}

/** The "Good to know" panel, found by its heading rather than by a class. */
function tipsPanel(): HTMLElement {
  const heading = screen.getByRole("heading", { name: "Good to know" });
  const panel = heading.nextElementSibling;
  expect(panel).not.toBeNull();
  return panel as HTMLElement;
}

const PERU_LINE_ONE =
  "These notes come from open reference data. We don't have Peru-specific guidance on payments, " +
  "connectivity, booking channels or public holidays yet — and we'd rather leave that blank than guess.";

afterEach(cleanup);

describe("PlanStep — the gap note", () => {
  test("a Peru trip is told where its notes came from, and what they do not cover", () => {
    render(<PlanStep input={input("PE", LIMA.id)} extraDestinations={[LIMA]} />);

    // The exact pinned copy, not a fuzzy match: the sentence is the deliverable.
    expect(screen.getByRole("note")).toHaveTextContent(PERU_LINE_ONE);
    // Peru carries all six nameable fields, so there is no second line.
    expect(screen.getByRole("note").querySelectorAll("p")).toHaveLength(1);
  });

  test("the note sits beside the tips list, never inside it", () => {
    render(<PlanStep input={input("PE", LIMA.id)} extraDestinations={[LIMA]} />);

    const panel = tipsPanel();
    const list = within(panel).getByRole("list");
    const note = screen.getByRole("note");

    // Armed: there really are tips to be mistaken for.
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(0);

    // A screen reader must not announce the disclaimer as one more tip.
    expect(list).not.toContainElement(note);
    expect(note.closest("ul")).toBeNull();
    expect(note.closest("li")).toBeNull();
    expect(within(list).queryByText(/open reference data/)).toBeNull();
    // Same panel, though — a disclaimer floating somewhere else on the page is
    // not a disclaimer about these tips.
    expect(panel).toContainElement(note);
  });

  test("a China trip is told nothing, because China is researched by hand", () => {
    render(<PlanStep input={input("CN", BEIJING.id)} extraDestinations={[BEIJING]} />);

    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText(/open reference data/)).toBeNull();
    // Armed: the panel it would have appeared in is on screen and populated.
    expect(within(tipsPanel()).getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  test("a sparse country gets a second line naming exactly the fields we lack", () => {
    render(<PlanStep input={input("SH", ST_HELENA.id)} extraDestinations={[ST_HELENA]} />);

    const paragraphs = [...screen.getByRole("note").querySelectorAll("p")].map((p) => p.textContent);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toContain("Saint Helena, Ascension and Tristan da Cunha-specific guidance");
    // Measured against the committed artifact on 2026-08-27: SH carries a
    // driving side, emergency numbers and an official language, and nothing
    // else. The four named here are exactly the four it is missing — a note
    // that named a field the country HAS would be a false claim of ignorance.
    expect(paragraphs[1]).toBe(
      "We also have no currency, plug types, mains voltage or dialling code for " +
        "Saint Helena, Ascension and Tristan da Cunha."
    );
  });
});
