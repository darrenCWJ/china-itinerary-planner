import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import PlanPage from "@/app/plan/page";
import { PrefsProvider } from "@/components/shell/PrefsProvider";

/**
 * Which country a finished trip is FOR, driven through the real wizard.
 *
 * The review's claim was that the country persisted with a trip is whichever
 * one the country picker was left on, so a trip whose only destination is in
 * Peru is built as a Japan trip if the picker moved afterwards — poisoning the
 * tips, the currency, the seasons and the glyphs the rest of this branch
 * derives from country. It was verified here rather than argued: the case
 * below marked THE DEFECT failed against the code as it stood, with the three
 * arming cases beside it green.
 *
 * `app/plan/page.tsx` can hold no test of its own (vitest.config.mts includes
 * only lib/, scripts/ and components/), so the page is imported and driven from
 * this side. That is the only way to see this at all: `TripInput.country` is
 * correct in isolation, `getCountry` is correct in isolation and each
 * destination's own country is correct in isolation — the defect was that the
 * wizard fed the plan the picker's value instead of the destinations'.
 *
 * Both pick kinds are exercised, and they fail differently. A hand-typed place
 * carries its own country (`addOffMap` stamps it), so it only needed the
 * wizard to read it. A catalog city carries none — a `CatalogHit` is a name, a
 * qid and a province — so it needed the wizard to record the scope the pick was
 * made in, which is a second mechanism and the more fragile one.
 */

/** `PlanStep` mounts `ShareTripCard`, which calls `useRouter`. */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * `MapExplorer` pulls both world-level renderers in through `next/dynamic`.
 * Resolved up front and handed back synchronously, for the reason
 * `components/map/MapExplorer.test.tsx` spells out at length: a loader that
 * defers puts the wall clock back into every assertion below.
 */
vi.mock("next/dynamic", async () => {
  const { WorldMap } = await import("@/components/map/WorldMap");
  const { GlobeLevel } = await import("@/components/map/GlobeLevel");
  const byName: Record<string, ComponentType<Record<string, unknown>>> = {
    WorldMap: WorldMap as unknown as ComponentType<Record<string, unknown>>,
    GlobeLevel: GlobeLevel as unknown as ComponentType<Record<string, unknown>>,
  };
  return {
    default: (loader: () => Promise<unknown>) => {
      const source = loader.toString();
      const matched = Object.keys(byName).filter((name) => source.includes(name));
      if (matched.length !== 1) {
        throw new Error(`next/dynamic mock matched ${matched.length} components: ${source}`);
      }
      return byName[matched[0]];
    },
  };
});

/**
 * Three countries, because the A–Z picker below is what switches between them
 * and it is built from this topology: China (the wizard's default), Peru (the
 * trip's real destination) and Japan (where the picker is left).
 */
const WORLD_FIXTURE = {
  topology: {
    type: "Topology",
    arcs: [
      [
        [116, 39],
        [120, 39],
        [120, 43],
        [116, 43],
        [116, 39],
      ],
      [
        [136, 34],
        [140, 34],
        [140, 38],
        [136, 38],
        [136, 34],
      ],
      [
        [-77, -12],
        [-71, -12],
        [-71, -8],
        [-77, -8],
        [-77, -12],
      ],
    ],
    objects: {
      countries: {
        type: "GeometryCollection",
        geometries: [
          { type: "Polygon", id: "CN", arcs: [[0]], properties: { name: "China" } },
          { type: "Polygon", id: "JP", arcs: [[1]], properties: { name: "Japan" } },
          { type: "Polygon", id: "PE", arcs: [[2]], properties: { name: "Peru" } },
        ],
      },
    },
  },
  smallCountries: [],
  points: [],
};

/** China's province topology — the default country's detail level draws it. */
const CHINA_FIXTURE = {
  type: "Topology",
  arcs: [
    [
      [116, 39.5],
      [117, 39.5],
      [117, 40.5],
      [116, 40.5],
      [116, 39.5],
    ],
  ],
  objects: {
    provinces: {
      type: "GeometryCollection",
      geometries: [{ type: "Polygon", arcs: [[0]], properties: { adcode: 110000, name: "Beijing" } }],
    },
  },
};

/**
 * Peru's Lima row, lifted from the committed `public/cities/PE.json`.
 *
 * The map pane draws it as a tappable place, which is the catalog pick path —
 * the pick kind that carries no country of its own.
 */
const PE_SHARD = {
  country: "PE",
  generatedAt: "2026-08-25T09:23:00.949Z",
  source: "GeoNames cities500 (CC BY 4.0)",
  cities: [
    {
      id: "G3936456",
      n: "Lima",
      lat: -12.04318,
      lon: -77.02824,
      a1: "Lima Province",
      p: 7_737_002,
      tz: "America/Lima",
    },
  ],
};

/**
 * What `/api/destinations/resolve` answers for Lima's GeoNames id.
 *
 * Its `country` is deliberately not what the assertions below turn on — the
 * wizard resolves the trip's country before this leg is ever called, from what
 * it recorded at pick time. A resolve that answered "JP" here would change
 * nothing, which is the point.
 */
const LIMA_RESOLVED = {
  destinations: [
    {
      id: "G3936456",
      name: "Lima",
      localName: null,
      region: "Lima Province",
      country: "PE",
      lat: -12.04318,
      lon: -77.02824,
      emoji: "*",
      tagline: "",
      knownFor: [],
      bestSeasons: [],
      seasonNotes: {},
      foods: [],
      suggestedDays: [1, 3],
      activities: [],
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const href = String(url);
      // Everything but the world topology, China's provinces and Peru's shard
      // answers empty: these runs add one place and touch no other dataset.
      const body =
        href === "/china-provinces.json"
          ? CHINA_FIXTURE
          : href === "/cities/PE.json"
            ? PE_SHARD
            : href.startsWith("/api/destinations/resolve")
              ? LIMA_RESOLVED
              : href.startsWith("/api/map/cities")
                ? { available: true, cities: [] }
                : href.startsWith("/api/map/airports")
                  ? { airports: [] }
                  : href.startsWith("/api/destinations")
                    ? { available: false, results: [] }
                    : href.startsWith("/cities/")
                      ? null
                      : WORLD_FIXTURE;
      return Promise.resolve({
        ok: body !== null,
        status: body === null ? 404 : 200,
        json: async () => body ?? {},
      });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Drain mount effects and the renders they cause, without racing a clock.
 *
 * The same fixed-point drain `components/map/MapExplorer.test.tsx` uses, and
 * for the reason it documents: mounting this tree is real CPU work rather than
 * anything that waits, and a polling `findBy*` reports a busy machine as a
 * missing element (commit 84cd61e).
 */
async function settle(): Promise<void> {
  let previous = "";
  for (let i = 0; i < 12 && document.body.innerHTML !== previous; i += 1) {
    previous = document.body.innerHTML;
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Mount and advance past the details step, where the wizard opens. */
async function toDestinations(): Promise<void> {
  render(
    <PrefsProvider>
      <PlanPage />
    </PrefsProvider>
  );
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Next →" }));
  await settle();
}

/** Move the country picker — the world level's A–Z list, which reaches every country. */
async function pickCountry(code: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /Change country/ }));
  // The world level fetches its topology on mount, so the A–Z list does not
  // exist until that has landed.
  await settle();
  fireEvent.change(screen.getByLabelText("Or pick from the list"), { target: { value: code } });
  await settle();
}

/** Hand-type a place with no map pin. The option is committed on mousedown. */
async function typeOwnPlace(name: string): Promise<void> {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: name } });
  await settle();
  fireEvent.mouseDown(screen.getByRole("option", { name: /as its own place/ }));
  await settle();
}

/** Step 1 → step 2, then the plan's headline. */
async function buildPlan(): Promise<string> {
  fireEvent.click(screen.getByRole("button", { name: "Build my plan →" }));
  await settle();
  return screen.getByRole("heading", { level: 2, name: /itinerary/ }).textContent ?? "";
}

describe("the trip is built for the country its destinations are in", () => {
  test("the wizard runs at all, or every case below proves nothing", async () => {
    // Arming. Pick Peru, add a Peruvian place, touch the picker no further:
    // this is the path that always worked, and it establishes that the drive
    // really reaches step 2 with a plan on it.
    await toDestinations();
    await pickCountry("PE");
    await typeOwnPlace("Ollantaytambo");
    expect(await buildPlan()).toBe("Your Peru itinerary");
  });

  test("a picker left on another country does not move the trip", async () => {
    // THE DEFECT, and the case that failed before the fix. The trip's only
    // destination is Peruvian and the picker was afterwards left on Japan; the
    // wizard handed `buildItinerary` the picker's value, so the plan came out
    // headed "Your Japan itinerary" and every tip, packing line, currency and
    // glyph on it was Japan's — for a trip to Ollantaytambo.
    await toDestinations();
    await pickCountry("PE");
    await typeOwnPlace("Ollantaytambo");
    await pickCountry("JP");
    expect(await buildPlan()).toBe("Your Peru itinerary");
  });

  test("a city tapped on the map keeps its country when the picker moves on", async () => {
    // The review's own example, through the real catalog path: select Lima,
    // then browse the picker to Japan. A `CatalogHit` carries no country, so
    // this is the pick kind that needs the wizard to have recorded the scope
    // the pick was made in — `extras` is keyed by qid alone and survives the
    // switch, so nothing later in the session can recover it.
    await toDestinations();
    await pickCountry("PE");
    fireEvent.click(screen.getByRole("button", { name: /Lima/ }));
    await settle();
    await pickCountry("JP");
    expect(await buildPlan()).toBe("Your Peru itinerary");
  });

  test("the picker still decides while nothing is picked", async () => {
    // The other direction, and the reason the fix is not "ignore the picker":
    // with no destination to speak for the trip, the open country is the only
    // answer there is.
    await toDestinations();
    await pickCountry("JP");
    await typeOwnPlace("Nikko");
    expect(await buildPlan()).toBe("Your Japan itinerary");
  });

  test("China is unchanged — the default country, never touched", async () => {
    await toDestinations();
    await typeOwnPlace("Pingyao");
    expect(await buildPlan()).toBe("Your China itinerary");
  });
});
