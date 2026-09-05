import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { MapLevel } from "@/components/map/MapExplorer";
import { DestinationStep } from "./DestinationStep";

/**
 * Which level the destinations step opens on.
 *
 * The world level (the globe) is the country picker, and since Phase 3 the
 * planner is worldwide — so the first thing a planner sees is the globe, not
 * the map of whichever country the browsing scope happens to default to. The
 * default country still exists (it scopes search, the map pane and the
 * curated cards, and until something is picked the trip's country and so
 * step 0's season chips), it just no longer gets to be the opening screen.
 *
 * `MapExplorer` is stubbed to a readout of the one prop under test. Its real
 * rendering owns four fetches and a topology parse and has its own suite.
 */
vi.mock("@/components/map/MapExplorer", () => ({
  MapExplorer: ({
    level,
    onLevelChange,
  }: {
    level: MapLevel;
    onLevelChange: (level: MapLevel) => void;
  }) => (
    <div>
      <output data-testid="map-level">{level}</output>
      <button type="button" onClick={() => onLevelChange("country")}>
        step down into the country
      </button>
    </div>
  ),
}));

function renderStep() {
  render(
    <DestinationStep
      selected={[]}
      visited={[]}
      extras={{}}
      days={5}
      onToggleSelect={() => {}}
      onToggleVisited={() => {}}
      onAddCatalog={() => {}}
      onRemoveCatalog={() => {}}
      onReorder={() => {}}
      onMonthPicked={() => {}}
      country="CN"
      onCountryChange={() => {}}
      onAddOffMap={() => {}}
      offMap={[]}
    />
  );
}

const level = () => screen.getByTestId("map-level").textContent;

beforeEach(() => {
  // PlaceSearch loads the open country's shard on mount; a 404 is a case it
  // already swallows quietly.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("opens on the world level, so the globe is the first thing a planner sees", () => {
  renderStep();
  expect(level()).toBe("world");
  // And the line under the heading describes the globe, not a timeline the
  // globe does not have.
  expect(screen.getByText(/Pick a country on the globe/)).toBeInTheDocument();
});

test("a country picked from the globe opens, and Change country returns to the globe", () => {
  renderStep();
  fireEvent.click(screen.getByRole("button", { name: "step down into the country" }));
  expect(level()).toBe("country");
  expect(screen.getByText(/Zoom the map, drag the timeline/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Change country/ }));
  expect(level()).toBe("world");
  expect(screen.getByText(/Pick a country on the globe/)).toBeInTheDocument();
});
