import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PrefsProvider } from "@/components/shell/PrefsProvider";
import { COUNTRY_DETAIL, hasDetailLevel } from "@/lib/countryDetail";
import { PROJECTION_PATH } from "@/lib/countryProjection";
import { GLOBE_TOPOLOGY_PATH } from "@/lib/globeTopology";
import { WORLD_TOPOLOGY_PATH } from "@/lib/isoTopology";
import { DEFAULT_PREFS, PREFS_COOKIE, serializePrefsCookie, type UserPrefs } from "@/lib/prefs";
import { PE_TOPOLOGY } from "./countryFixture";
import { MapExplorer, type MapLevel } from "./MapExplorer";
import { fitForPlace, fitForRegion, type MapPlace } from "./mapTypes";

/**
 * What is asserted here is the coordination the component exists for: which
 * level is showing, that picking a country at the world level hands the code up
 * and drops back to the country level, and that a country with no detail level
 * costs no China assets. Layout, tint and the legend are visual.
 */

/**
 * Two countries is enough to prove a pick is carried; see WorldMap.test.tsx.
 *
 * Carries both `smallCountries` (WorldTopology's shape) and `points`
 * (GlobeTopology's shape, `lib/globeTopology.ts`) so the same fixture body —
 * this file's `fetchMock` returns it for any URL that isn't a China or
 * catalog endpoint — parses under whichever world-level renderer a test
 * exercises. `GlobeLevel.test.tsx` keeps its own richer, two-hemisphere
 * fixture for what it actually tests (rotation, clipping); this one only
 * needs to stay parseable.
 *
 * Wound south-west, north-west, north-east, south-east, the order
 * `worldFixture.ts` documents and for the reason it gives: reversed, d3 reads
 * each ring as the whole sphere minus the rectangle (`geoArea` 4π), which
 * renders without error and fits the projection to the entire globe.
 */
const WORLD_FIXTURE = {
  topology: {
    type: "Topology",
    arcs: [
      [
        [116, 39],
        [116, 43],
        [120, 43],
        [120, 39],
        [116, 39],
      ],
      [
        [136, 34],
        [136, 38],
        [140, 38],
        [140, 34],
        [136, 34],
      ],
    ],
    objects: {
      countries: {
        type: "GeometryCollection",
        geometries: [
          { type: "Polygon", id: "CN", arcs: [[0]], properties: { name: "China" } },
          { type: "Polygon", id: "JP", arcs: [[1]], properties: { name: "Japan" } },
        ],
      },
    },
  },
  smallCountries: [],
  points: [],
};

/**
 * Two provinces, one per region the tests zoom into: Beijing for North and
 * Hubei for Central. `ChinaLevel` only offers a region's zoom control when a
 * province of that region is in the topology, and only shows catalog markers
 * once a region is open — at country level it draws curated picks alone — so
 * the region a city test zooms into has to be drawable.
 *
 * Wound south-west, north-west, north-east, south-east, for the reason
 * `worldFixture.ts` gives — see the note on `WORLD_FIXTURE` above.
 */
const CHINA_FIXTURE = {
  type: "Topology",
  arcs: [
    [
      [116, 39.5],
      [116, 40.5],
      [117, 40.5],
      [117, 39.5],
      [116, 39.5],
    ],
    [
      [109, 29.5],
      [109, 33],
      [115, 33],
      [115, 29.5],
      [109, 29.5],
    ],
  ],
  objects: {
    provinces: {
      type: "GeometryCollection",
      geometries: [
        {
          type: "Polygon",
          arcs: [[0]],
          properties: { adcode: 110000, name: "北京市" },
        },
        {
          type: "Polygon",
          arcs: [[1]],
          properties: { adcode: 420000, name: "湖北省" },
        },
      ],
    },
  },
};

const CHINA_TOPOLOGY_PATH = "/china-provinces.json";

/** A generic catalog place — the shape MapExplorer builds for a catalog city. */
const A_CATALOG_PLACE: MapPlace = {
  id: "some-catalog-qid",
  kind: "catalog",
  name: "Some City",
  localName: null,
  province: "Some Province",
  region: "East",
  lat: 30,
  lon: 120,
  population: 100_000,
  level: "prefecture",
  attractionCount: 2,
  blurb: null,
};
/**
 * MapExplorer pulls WorldMap in through `next/dynamic`: real code-splitting in
 * production, and a wall-clock dependency in tests. The module load plus
 * React.lazy's unwrap costs ~90ms cold on an idle machine, and it is the only
 * reason these tests ever needed a timeout budget at all. Under full-suite
 * parallel load it stretched past Testing Library's polling window and failed
 * as "Unable to find role=…" — which reads like a missing element rather than
 * a slow one, and sent two rounds of fixes at the timeout instead.
 *
 * Raising a budget only moves the threshold; the test still races the machine,
 * and the next busy CI box moves it back. Resolving the components up front
 * removes the race outright: both are imported once, here, and `dynamic()`
 * hands the right one straight back, so nothing in this file suspends and no
 * assertion depends on how loaded the CPU is.
 *
 * A previous version of this mock said exactly that and then did the opposite.
 * Extended to tell the two renderers apart, it began returning a wrapper that
 * started at `useState(null)`, ran the loader in an effect and rendered
 * nothing until the promise landed — which is precisely the deferral the mock
 * exists to delete, reintroduced under a docblock claiming it was gone. That
 * is how the wall clock got back in, and the symptom was then treated as a
 * budget problem twice over. Anything added here must hand a component back
 * *synchronously*.
 *
 * Dispatch reads the loader's own source, which survives Vite's transform as
 * `__vite_ssr_dynamic_import__("/components/map/GlobeLevel.tsx").then((m) =>
 * m.GlobeLevel)` — the component's name appears whether or not the specifier
 * is rewritten. It throws rather than guessing when a loader matches neither
 * name or both: with two dynamic imports, a mock that quietly fell back to one
 * of them would render the flat map in the globe's place and every globe
 * assertion here would pass against the wrong component.
 *
 * What is given up is coverage of the `loading` fallback, which no test here
 * asserts on.
 */
vi.mock("next/dynamic", async () => {
  const { WorldMap } = await import("./WorldMap");
  const { GlobeLevel } = await import("./GlobeLevel");
  const byName: Record<string, ComponentType<Record<string, unknown>>> = {
    WorldMap: WorldMap as unknown as ComponentType<Record<string, unknown>>,
    GlobeLevel: GlobeLevel as unknown as ComponentType<Record<string, unknown>>,
  };
  return {
    default: (loader: () => Promise<unknown>) => {
      const source = loader.toString();
      const matched = Object.keys(byName).filter((name) => source.includes(name));
      if (matched.length !== 1) {
        throw new Error(
          `next/dynamic mock matched ${matched.length} components for this loader, expected 1: ${source}`
        );
      }
      return byName[matched[0]];
    },
  };
});

/**
 * Peru's first row and its Cusco row, lifted byte-for-byte from the committed
 * `public/cities/PE.json` (Lima is index 0 of 750, Cusco index 7). Every field
 * differs between the two, so a cross-wire — the wrong row under a name, or
 * one row's admin-1 pasted onto the other — is visible rather than absorbed.
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
    {
      id: "G3941584",
      n: "Cusco",
      lat: -13.53188,
      lon: -71.96701,
      a1: "Cuzco Department",
      p: 428_450,
      tz: "America/Lima",
    },
  ],
};

/**
 * Only Cusco is enriched. A fixture that gave every row a description would
 * pass even if the index were ignored and one blurb pasted onto everything, so
 * Lima's `null` is what makes the merge's key observable.
 *
 * The description is abridged; the committed file's is four lines long.
 */
const PE_ENRICHMENT = {
  country: "PE",
  generatedAt: "2026-08-25T10:03:02.391Z",
  source: "Wikidata (CC0) + Wikipedia (CC BY-SA) summaries",
  cities: {
    G3941584: {
      description: "Cusco is a city in southeastern Peru, near the Sacred Valley.",
      image: null,
    },
  },
};

/**
 * A second foreign country with a shard of its own — the one thing the
 * foreign-to-foreign switch test needs that Japan cannot give it.
 *
 * Japan is this file's shard-less country: `/cities/JP.json` 404s below, which
 * is what `keeps working for a country whose shard 404s` reads and what keeps
 * `No map for Japan yet` true for the two tests that assert it. A PE→JP switch
 * could therefore only ever show that Peru's cities left, never that the new
 * country's arrived — half a country-scoping proof, and the half that passes
 * just as well if the shard leg died outright.
 */
const DE_SHARD = {
  country: "DE",
  generatedAt: "2026-08-25T09:23:00.949Z",
  source: "GeoNames cities500 (CC BY 4.0)",
  cities: [
    {
      id: "G2950159",
      n: "Berlin",
      lat: 52.52437,
      lon: 13.41053,
      a1: "State of Berlin",
      p: 3_426_354,
      tz: "Europe/Berlin",
    },
  ],
};

/**
 * China's shard, and the only fixture in this file where the catalog leg is not
 * empty — so it is the only one that exercises the merge as a merge.
 *
 * Every row but Zhangjiajie's is lifted byte-for-byte from the committed
 * `public/cities/CN.json`, and every catalog city below from `data/catalog.json`
 * with `mapCities`' shaping applied. All of them resolve to Central China, the
 * region `CHINA_FIXTURE` draws Hubei for, because `ChinaLevel` only renders
 * catalog markers inside an open region.
 *
 *  - `Jingzhou` is a duplicate: 5.3 km from catalog Q71247 of the same name.
 *    It is in the shard precisely because it cleared the ingest's 5 km dedup
 *    radius (`scripts/ingest-cities.mjs`), which is why the client has to catch
 *    it too.
 *  - `Heshan` is not: Hunan's Heshan is 631.3 km from the catalog's Heshan in
 *    Laibin, Guangxi. Two different cities that share a romanisation, and both
 *    have to survive.
 *  - `Enshi` has no catalog namesake at all — the plain shard row, present to
 *    keep "deleted the whole shard leg" from passing the suppression test.
 *  - `Zhangjiajie` is the one invented row. The committed shard has none, and
 *    `lib/curatedNames.ts` says why it holds the name open anyway: the nightly
 *    re-ingest can promote a name that misses today's cut, and the curated
 *    "Zhangjiajie" card is already on the map.
 */
const CN_SHARD = {
  country: "CN",
  generatedAt: "2026-08-25T09:23:00.949Z",
  source: "GeoNames cities500 (CC BY 4.0)",
  cities: [
    {
      id: "G1805540",
      n: "Jingzhou",
      lat: 30.35028,
      lon: 112.19028,
      a1: "Hubei",
      p: 1_052_282,
      tz: "Asia/Shanghai",
    },
    {
      id: "G1808316",
      n: "Heshan",
      lat: 28.56938,
      lon: 112.34733,
      a1: "Hunan",
      p: 1_249_807,
      tz: "Asia/Shanghai",
    },
    {
      id: "G1811720",
      n: "Enshi",
      lat: 30.3,
      lon: 109.48333,
      a1: "Hubei",
      p: 279_185,
      tz: "Asia/Shanghai",
    },
    {
      // Capitalised, which is what pins the fold: `curatedPlaceNames` answers
      // folded names, so a suppression that compared `row.n` raw would let
      // "Zhangjiajie" straight through.
      id: "G1815456",
      n: "Zhangjiajie",
      lat: 29.12548,
      lon: 110.48442,
      a1: "Hunan",
      p: 1_517_027,
      tz: "Asia/Shanghai",
    },
  ],
};

/**
 * What `/api/map/cities?country=CN` answers: `mapCities` shaping over three
 * rows of `data/catalog.json`. Wuhan has no shard row of any name, so it is the
 * one city that can only have come from this leg.
 */
const CN_CATALOG = [
  {
    qid: "Q71247",
    name: "Jingzhou",
    localName: "荆州市",
    province: "Hubei",
    lat: 30.324444444,
    lon: 112.236111111,
    population: 5_231_180,
    level: "prefecture",
    attractionCount: 3,
    blurb: "Jingzhou is a prefecture-level city in southern Hubei province, China.",
  },
  {
    qid: "Q1359423",
    name: "Heshan",
    localName: "合山市",
    province: "Laibin",
    lat: 23.81635,
    lon: 108.88475,
    population: 98_938,
    level: "county",
    attractionCount: 0,
    blurb: "Heshan is a county-level city of central Guangxi, China.",
  },
  {
    qid: "Q11746",
    name: "Wuhan",
    localName: "武汉市",
    province: "Hubei",
    lat: 30.595,
    lon: 114.2975,
    population: 12_326_518,
    level: "prefecture",
    attractionCount: 7,
    blurb: "Wuhan is the capital of Hubei, China.",
  },
];

/**
 * One country's admin-1 file, in the envelope `parseProvinceTopology` accepts.
 *
 * Built per code rather than written out twice, because the only thing any
 * assertion here turns on is WHICH code was asked for: `CountryLevel` draws
 * the same one square whichever country it is handed, and a hand-written PE
 * and DE pair would be two more fixtures to keep in step with the parser for
 * no extra coverage. The envelope's `country` is the requested code, so
 * `parseProvinceTopology`'s URL-versus-envelope check passes; a test that
 * needs it to fail can stub a mismatch of its own.
 */
function provinceFixture(code: string) {
  return {
    country: code,
    generatedAt: "2026-08-30T00:00:00.000Z",
    idKey: "adm1_code",
    topology: {
      type: "Topology",
      // Clockwise in (lon, lat). d3-geo reads rings spherically, so the
      // anticlockwise version of this square is the globe MINUS the square:
      // `geoBounds` answers +/-180 and the fallback fit collapses. It did not
      // matter while nothing drew this fixture; `CountryLevel` draws it now.
      arcs: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ],
      objects: {
        provinces: {
          type: "GeometryCollection",
          geometries: [
            {
              type: "Polygon",
              id: `${code}+00`,
              arcs: [[0]],
              properties: {
                name: `${code} unit`,
                name_en: `${code} unit`,
                iso_3166_2: `${code}-1`,
                gn_a1_code: `${code}.01`,
                sel: 1,
              },
            },
          ],
        },
      },
    },
    cityProvince: {},
  };
}

/** `/provinces/PE.json` and nothing else — not the index, not a traversal. */
const PROVINCE_FILE = /^\/provinces\/([A-Z]{2})\.json$/;

/**
 * The §5.4 manifest, framing the one square every province fixture draws.
 *
 * Real entries rather than an empty object, so the country level takes its
 * committed frame here exactly as it does in production. A country the
 * manifest has no entry for is still drawn — it falls back to a fit over its
 * own units — and `CountryLevel.test.tsx` is where that fallback is pinned.
 */
const PROJECTION_FIXTURE = Object.fromEntries(
  ["PE", "DE", "JP", "GA"].map((code) => [
    code,
    {
      rotate: 0,
      bounds: [
        [0, 0],
        [1, 1],
      ],
      scale: 34_377.468,
    },
  ])
);

/**
 * The shared answer table, as a named function rather than an inline lambda.
 *
 * A test that only wants to change ONE route delegates the rest to this, and a
 * plain function is what makes that possible: `fetchMock` is typed
 * `ReturnType<typeof vi.fn>`, which TypeScript does not consider callable, so
 * `fetchMock(href)` from inside an override is a compile error rather than a
 * delegation. Calls routed here are not recorded on `fetchMock`, so an
 * override that needs `requested()` builds its own answers instead.
 */
function defaultFetch(url: string) {
  const href = String(url);
  // Answered ahead of the chain below rather than inside it, so the shape of
  // that chain — one country's assets, in the order the effect asks for them —
  // stays readable. The manifest is not one country's asset: it is the same
  // file for all 246.
  if (href === PROJECTION_PATH) {
    return Promise.resolve({ ok: true, status: 200, json: async () => PROJECTION_FIXTURE });
  }
  const province = PROVINCE_FILE.exec(href);
  const body = province
    ? provinceFixture(province[1])
    : href === CHINA_TOPOLOGY_PATH
      ? CHINA_FIXTURE
      // China is the only country whose catalog leg answers with anything,
      // which is exactly why it is the only country whose merge can be
      // observed. Every other country keeps the empty answer it had.
      : href === "/api/map/cities?country=CN"
        ? { available: true, cities: CN_CATALOG }
        : href.startsWith("/api/map/cities")
          ? { available: true, cities: [] }
          : href.startsWith("/api/map/airports")
            ? { airports: [] }
            : href === "/cities/PE.json"
              ? PE_SHARD
              : href === "/cities/enrich/PE.json"
                ? PE_ENRICHMENT
                : href === "/cities/DE.json"
                  ? DE_SHARD
                  : href === "/cities/CN.json"
                    ? CN_SHARD
                    // Every other country's shard and enrichment file —
                    // Japan's and China's enrichment included — 404s. That is
                    // the honest answer for the four codes with no shard at
                    // all, and the map has to keep working through it.
                    : href.startsWith("/cities/")
                      ? null
                      : WORLD_FIXTURE;
  return Promise.resolve({
    ok: body !== null,
    status: body === null ? 404 : 200,
    json: async () => body ?? {},
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(defaultFetch);
  vi.stubGlobal("fetch", fetchMock);
});

/**
 * A request that never answers and rejects when it is aborted — what a real
 * in-flight fetch does when the country changes under it.
 *
 * Neither the shared mock (which resolves immediately and ignores the signal)
 * nor a bare `new Promise(() => {})` (which never settles at all) reproduces
 * that, and the abort path is the one where a *previous* country's answer can
 * still reach `setState`.
 */
function pendingUntilAbort(init?: { signal?: AbortSignal }): Promise<never> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError"))
    );
  });
}

/** A catalog that reports itself down, for a country with no shard to fall back on. */
function deadCatalog(url: string) {
  const href = String(url);
  if (href.startsWith("/api/map/cities")) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ available: false, cities: [] }),
    });
  }
  if (href.startsWith("/cities/")) {
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  }
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ airports: [] }) });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // Written by `Harness`'s `prefs` prop, via the same cookie `PrefsProvider`
  // reads on mount — cleared so one test's prefs never leak into the next.
  document.cookie = `${PREFS_COOKIE}=; Path=/; Max-Age=0`;
});

function requested(path: string): boolean {
  return fetchMock.mock.calls.some(([url]) => String(url) === path);
}

/**
 * Flush mount effects, the promises they start, and the renders those cause —
 * then let the test query synchronously.
 *
 * Used instead of `findBy*` throughout this file. Those poll against a
 * wall-clock budget, and mounting this component is real CPU work (jsdom plus
 * d3-geo projection) rather than anything that waits. That is comfortably
 * inside the budget on an idle machine and can fall outside it when the full
 * suite has every core busy, which is exactly the shape of the flake: it never
 * reproduced on this file alone, only in a full run. Nothing here was ever slow
 * to *settle* — it was slow to *compute*, and a poll timeout cannot tell those
 * apart, so it reported "Unable to find role=…" as though the element were
 * missing.
 *
 * The "~165ms" this note used to quote for that mount was measured off the
 * first test in the file, and was mostly not the mount: the bulk of it was the
 * one-time jsdom environment warmup that every file's first role query used to
 * pay, which now happens in vitest.setup.ts instead. Removing it from this file
 * takes the first test from ~347ms to ~164ms. The sibling tests that mount and
 * settle the same world level land at ~35-45ms; the first test stays longer
 * than they do because it also pays React's first render and the world
 * renderer's first module evaluation, neither of which the setup warmup covers.
 *
 * Draining to a fixed point removes the clock from the assertion entirely. The
 * work still takes however long it takes; the test simply waits for it rather
 * than racing it. vitest's own testTimeout stays as the backstop for a genuine
 * hang, which is the only thing a timeout should be catching.
 */
async function settle(): Promise<void> {
  let previous = "";
  for (let i = 0; i < 10 && document.body.innerHTML !== previous; i++) {
    previous = document.body.innerHTML;
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * A place's chip in the list, told apart from its marker on the map.
 *
 * Since §5.3.1 gave the markers a roving tabindex every place a drawn country
 * level renders is TWO controls — a `<g role="button">` on the map and a real
 * `<button>` in the list — so a bare `getByRole("button", { name })` is
 * ambiguous for any country whose geometry loaded. The list is the
 * accessibility spine (§5.2) and it is the one these assertions are about, so
 * they name it rather than taking whichever the query happened to return.
 *
 * The count is checked rather than `find`-ed past: a level that stopped
 * rendering the list would otherwise still satisfy every caller through the
 * marker, which is the exact regression §12.2 exists to catch.
 */
function chip(name: string | RegExp): HTMLElement {
  const matches = screen
    .getAllByRole("button", { name })
    .filter((el): el is HTMLElement => el.tagName === "BUTTON");
  expect(matches, `expected one list chip named ${name}`).toHaveLength(1);
  return matches[0];
}

function Harness({
  country = "CN",
  level = "country",
  prefs,
  onAddCatalog = () => {},
  onToggleSelect = () => {},
}: {
  country?: string;
  level?: MapLevel;
  /**
   * Seeds `PrefsProvider` with a specific `UserPrefs`, via the same cookie it
   * reads on mount — written here, synchronously, before the provider below
   * renders and its lazy `useState` initialiser reads it back. Omitted, the
   * provider reads no cookie and falls back to `DEFAULT_PREFS` itself, which
   * is the "no explicit choice" case these tests need too.
   */
  prefs?: UserPrefs;
  onAddCatalog?: (hit: unknown) => void;
  /** Curated markers report through this one; catalog markers never do. */
  onToggleSelect?: (id: string) => void;
}) {
  const [activeCountry, setCountry] = useState(country);
  const [activeLevel, setLevel] = useState<MapLevel>(level);
  if (prefs) {
    document.cookie = `${PREFS_COOKIE}=${serializePrefsCookie(prefs)}; Path=/`;
  }
  // Re-rendering with a new `country` prop must actually move the map, or the
  // foreign-to-foreign refetch tests would be asserting against frozen state.
  useEffect(() => setCountry(country), [country]);
  return (
    <PrefsProvider>
      <MapExplorer
        selected={[]}
        visited={[]}
        country={activeCountry}
        level={activeLevel}
        onCountryChange={setCountry}
        onLevelChange={setLevel}
        onToggleSelect={onToggleSelect}
        onAddCatalog={onAddCatalog}
        onRemoveCatalog={() => {}}
        onReorder={() => {}}
      />
    </PrefsProvider>
  );
}

describe("MapExplorer", () => {
  test("carries a world-level pick down into that country's level", async () => {
    render(<Harness level="world" />);

    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Japan/ }));

    // Japan's own admin-1 file draws in the same shell China's does, with the
    // place list beneath it — and with no cities in this harness, the list says
    // so rather than repeating the "no map yet" line it carried for 245
    // countries before PR4.
    await settle();
    expect(screen.getByRole("group", { name: "Map of Japan" })).toBeInTheDocument();
    expect(screen.getByText(/No places in Japan yet/)).toBeInTheDocument();
    // And the world level is gone: the two levels never render at once.
    // Either renderer's group is named "… — pick a country", so this covers
    // both the flat map and the globe regardless of which one was active.
    expect(screen.queryByRole("group", { name: /pick a country/ })).not.toBeInTheDocument();
  });

  test("goes back to the country level without changing the country", async () => {
    render(<Harness level="world" />);

    await settle();
    fireEvent.click(screen.getByRole("button", { name: "← Back to China" }));

    await settle();
    expect(
      screen.getByRole("group", { name: "Map of China segmented by region" })
    ).toBeInTheDocument();
  });

  test("buys no China assets for a country that cannot use them", async () => {
    render(<Harness country="JP" />);

    await settle();
    expect(screen.getByRole("group", { name: "Map of Japan" })).toBeInTheDocument();
    expect(requested(CHINA_TOPOLOGY_PATH)).toBe(false);
    // The city catalog is still asked about — every country has one now — but
    // it is asked about for Japan, not for China.
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(
      "/api/map/cities?country=JP"
    );
    expect(screen.queryByText(/city list is unavailable/)).not.toBeInTheDocument();
  });

  /**
   * C5's 44px minimum. Roughly thirty components across the tree apply
   * `min-h-[var(--tap-min)]`; MapExplorer's own controls were written with
   * `py-1`/`py-1.5` instead, which lands them near 24px. Every one of them is
   * the only way out of the state it appears in — the back-out, the zoom-out
   * and the retry — so they are the worst ones to make hard to hit.
   *
   * WorldMap's country dots are deliberately exempt and stay so: its docblock
   * records that the A–Z list, not the circle, is the target that meets the
   * token.
   */
  test("gives its back-out control the C5 tap target its siblings apply", async () => {
    render(<Harness level="world" />);

    await settle();
    expect(screen.getByRole("button", { name: "← Back to China" })).toHaveClass(
      "min-h-[var(--tap-min)]"
    );
  });

  test("gives its zoom-out control the C5 tap target", async () => {
    render(<Harness />);

    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Zoom into North China/ }));

    await settle();
    expect(screen.getByRole("button", { name: "← All China" })).toHaveClass(
      "min-h-[var(--tap-min)]"
    );
  });

  test("gives its retry control the C5 tap target", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url === CHINA_TOPOLOGY_PATH
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({ ok: true, status: 200, json: async () => WORLD_FIXTURE })
      )
    );
    render(<Harness />);

    await settle();
    expect(screen.getByRole("button", { name: "Try again" })).toHaveClass(
      "min-h-[var(--tap-min)]"
    );
  });

  test("fetches the world topology only once the world level is open", async () => {
    // Pinned to the flat map: the globe is the default renderer since Task
    // 12, and this test is specifically about WorldMap's own lazy-fetch
    // behaviour, not about which renderer a bare `Harness` resolves to today
    // — that is `renders the globe by default`, below.
    const flatPrefs = { ...DEFAULT_PREFS, worldView: "flat" as const };
    const { unmount } = render(<Harness prefs={flatPrefs} />);

    await settle();
    screen.getByRole("group", { name: "Map of China segmented by region" });
    expect(requested("/world-countries.json")).toBe(false);
    unmount();

    render(<Harness level="world" prefs={flatPrefs} />);
    // The mock hands the renderer back synchronously, so mounting it — and
    // the fetch it starts — is all inside settle()'s reach.
    await settle();
    screen.getByRole("group", { name: /World map/ });
    expect(requested("/world-countries.json")).toBe(true);
  });

  test("renders the globe by default", async () => {
    render(<Harness level="world" />);
    await settle();
    screen.getByRole("group", { name: /World globe/ });
    // The globe fetches its own asset; the flat map fetches world-countries.json.
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(GLOBE_TOPOLOGY_PATH);
  });

  test("renders the flat map when the user has chosen it", async () => {
    render(<Harness level="world" prefs={{ ...DEFAULT_PREFS, worldView: "flat" }} />);
    await settle();
    screen.getByRole("group", { name: /World map/ });
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(WORLD_TOPOLOGY_PATH);
  });

  test("shows the toggle to switch renderers when reduced motion is not active (globe is default)", async () => {
    // Diagnostic test: verifies the toggle exists with the correct label
    // for the default globe state. Hard-coding the toggle to never render
    // must fail this test.
    render(<Harness level="world" />);
    await settle();
    screen.getByRole("group", { name: /World globe/ });

    // Toggle should be present and offer to switch to flat map
    expect(screen.getByRole("button", { name: "Show a flat map" })).toBeInTheDocument();
  });

  test("shows the toggle with correct label when the user has chosen the flat map", async () => {
    // Verifies the toggle label changes based on the current renderer state
    render(
      <Harness level="world" prefs={{ ...DEFAULT_PREFS, worldView: "flat" }} />
    );
    await settle();
    screen.getByRole("group", { name: /World map/ });

    // Toggle should be present and offer to switch to globe
    expect(screen.getByRole("button", { name: "Show the globe" })).toBeInTheDocument();
  });

  test("falls back to the flat map under prefers-reduced-motion", async () => {
    // An explicit globe preference loses to the system request, and the toggle
    // that would re-offer it is withdrawn rather than left lying.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    );
    render(<Harness level="world" prefs={{ ...DEFAULT_PREFS, worldView: "globe" }} />);
    await settle();
    screen.getByRole("group", { name: /World map/ });

    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(WORLD_TOPOLOGY_PATH);
    expect(screen.queryByRole("button", { name: /flat map|globe/i })).not.toBeInTheDocument();
  });

  test("loads the open country's shard, not China's", async () => {
    render(<Harness country="PE" />);

    await settle();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/cities/PE.json");
    expect(urls).toContain("/api/map/cities?country=PE");
    expect(urls).not.toContain(CHINA_TOPOLOGY_PATH);
  });

  test("draws Peruvian cities in the country level's place list", async () => {
    // The list beside Peru's map, which is the accessibility spine (§5.2)
    // and which was empty outside China before this phase.
    render(<Harness country="PE" />);

    await settle();
    expect(chip(/Lima/)).toBeInTheDocument();
    expect(chip(/Cusco/)).toBeInTheDocument();
  });

  test("names the open country instead of printing its ISO code", async () => {
    // The defect, and it was invisible to every data-layer test: `getCountry`
    // fell back to the bare code for 222 of the 246 countries this map opens,
    // so the pane's heading read "GA". Gabon has no curated row, no catalog and
    // no shard here — the emptiest country there is — and it still has a name.
    render(<Harness country="GA" />);
    await settle();

    // Two headings carry it: the pane's own (h3) and the place list's (h4).
    expect(screen.getByRole("heading", { level: 3, name: "Gabon" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Gabon" })).toBeInTheDocument();
    // The negative is armed by the positives above: a pane that rendered
    // nothing at all would satisfy this line on its own.
    expect(screen.queryByRole("heading", { name: "GA" })).not.toBeInTheDocument();
    // And the country's name reaches the copy beside the heading, not just the
    // heading — this sentence read "No map for GA yet".
    expect(screen.getByText(/No places in Gabon yet/)).toBeInTheDocument();
  });

  test("the world level's way back names the country too", async () => {
    render(<Harness country="GA" level="world" />);
    await settle();
    expect(screen.getByRole("button", { name: "← Back to Gabon" })).toBeInTheDocument();
  });

  test("a curated country keeps its editorial name, not the artifact's", async () => {
    // The arming case for the whole change: the ingested table must not be
    // allowed to rename the 24 countries a human wrote down. Wikidata calls
    // this one "People's Republic of China".
    render(<Harness country="CN" />);
    await settle();
    expect(document.body.textContent).toContain("China");
    expect(document.body.textContent).not.toContain("People's Republic of China");
  });

  test("a tap on a shard city resolves and is added under its GeoNames id", async () => {
    // The half of the acceptance test the client owns. `togglePlace` re-looks
    // the tapped place up in the `cities` state array and silently drops the
    // add on a miss, so this fails the moment shard cities stop being merged
    // into that array.
    const onAddCatalog = vi.fn();
    render(<Harness country="PE" onAddCatalog={onAddCatalog} />);

    await settle();
    fireEvent.click(chip(/Cusco/));

    expect(onAddCatalog).toHaveBeenCalledTimes(1);
    expect(onAddCatalog.mock.calls[0][0]).toEqual({
      qid: "G3941584",
      name: "Cusco",
      localName: null,
      province: "Cuzco Department",
      description: "Cusco is a city in southeastern Peru, near the Sacred Valley.",
      population: 428_450,
      attractionCount: 0,
    });

    // Lima has no entry in the enrichment fixture, so its blurb stays null:
    // the merge is keyed by id rather than applied to whatever the file held.
    // Its admin-1 and population are its own too, not Cusco's.
    fireEvent.click(chip(/Lima/));
    expect(onAddCatalog.mock.calls[1][0]).toEqual({
      qid: "G3936456",
      name: "Lima",
      localName: null,
      province: "Lima Province",
      description: null,
      population: 7_737_002,
      attractionCount: 0,
    });
  });

  test("refetches when the country changes between two foreign countries", async () => {
    // The trap: the cities effect was keyed on `hasDetail`, a boolean, so
    // PE → DE would not have refired it and Peru's cities would have stayed on
    // a German map. Both directions are asserted — Germany's city arrives AND
    // Peru's are gone — because either alone passes for the wrong reason: an
    // empty map passes "Cusco is gone" even if the shard leg died outright.
    const { rerender } = render(<Harness country="PE" />);
    await settle();
    expect(chip(/Cusco/)).toBeInTheDocument();

    rerender(<Harness country="DE" />);
    await settle();

    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain("/cities/DE.json");
    expect(chip(/Berlin/)).toBeInTheDocument();
    // Neither control, not merely neither chip: a marker left over from the
    // country the user just closed is exactly the bug this guards.
    expect(screen.queryAllByRole("button", { name: /Cusco/ })).toHaveLength(0);
  });

  test("drops the previous country's cities on the switch, not when the new ones land", async () => {
    const { rerender } = render(<Harness country="PE" />);
    await settle();
    expect(chip(/Cusco/)).toBeInTheDocument();

    // Germany's legs never answer, so everything on screen from here is what
    // the switch itself did — the only way to observe the window between a
    // country change and the new data landing. A marker from the country you
    // just left is a wrong answer, not a stale one.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    rerender(<Harness country="DE" />);
    await settle();

    expect(screen.queryAllByRole("button", { name: /Cusco/ })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: /Lima/ })).toHaveLength(0);
    expect(screen.getByText(/No map for Germany yet/)).toBeInTheDocument();
  });

  test("earns the unavailable notice, then drops it the moment the country changes", async () => {
    // The one combination that earns the notice: the Wikidata catalog reports
    // itself down AND the country has no shard to fall back on. A country the
    // catalog simply has nothing for — the normal case for 245 of them — is
    // covered by `buys no China assets`, which asserts the notice stays away.
    vi.stubGlobal("fetch", vi.fn(deadCatalog));
    const { rerender } = render(<Harness country="AQ" />);
    await settle();
    expect(screen.getByText(/city list is unavailable/)).toBeInTheDocument();

    // The next country's legs never answer, so the notice can only go because
    // the switch itself cleared it. A stale "unavailable" is a claim about the
    // country you just left, made about the one you just opened.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    rerender(<Harness country="DE" />);
    await settle();

    expect(screen.queryByText(/city list is unavailable/)).not.toBeInTheDocument();
  });

  test("never lets an aborted country's answer land on the country that replaced it", async () => {
    // Five of the six legs swallow their own rejection, so an abort resolves
    // the combined promise instead of rejecting it. Without a check on the
    // signal before the write, Peru's effect lands Peru's answer — cities
    // emptied, "unavailable" set — on top of Germany's freshly cleared state,
    // one microtask after the switch.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { signal?: AbortSignal }) =>
        String(url).startsWith("/api/map/airports")
          ? Promise.resolve({ ok: true, status: 200, json: async () => ({ airports: [] }) })
          : pendingUntilAbort(init)
      )
    );
    const { rerender } = render(<Harness country="PE" />);
    await settle();

    rerender(<Harness country="DE" />);
    // Two settles: the abort's rejection travels through three `catch`es and a
    // `Promise.all` before the stale write would land, which is a longer
    // microtask chain than one settle's fixed-point loop is guaranteed to
    // drain — and a test that must observe a write *not* happening has to
    // out-wait it rather than beat it.
    await settle();
    await settle();

    expect(screen.queryByText(/city list is unavailable/)).not.toBeInTheDocument();
  });

  /**
   * China is the only country where both legs of the merge answer, so it is the
   * only country where any of this is observable. Every other test in this file
   * runs against an empty `/api/map/cities`, which is why the catalog spread,
   * the curated-name suppression and the duplicate filter all needed a CN
   * fixture before a mutation to any of them could fail anything.
   *
   * `ChinaLevel` shows curated picks alone until a region is open, so each of
   * these zooms into Central China first — where `CHINA_FIXTURE` draws Hubei
   * and where every fixture city resolves.
   */
  async function openCentralChina() {
    render(<Harness country="CN" />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Zoom into Central China/ }));
    await settle();
  }

  test("draws one marker for a city both legs answer with", async () => {
    // Jingzhou is in the shard at 30.35028,112.19028 and in the catalog at
    // 30.324444444,112.236111111 — 5.3 km apart, the same city twice. Drawn
    // twice it is two `role="button"`s a screen reader reads as two cities, two
    // ids `togglePlace` resolves separately, and a plan that spends days in
    // Jingzhou twice with a 5 km leg between the copies.
    await openCentralChina();

    expect(screen.getAllByRole("button", { name: "Jingzhou" })).toHaveLength(1);
  });

  test("keeps the surviving Jingzhou's QID, not the GeoNames row's id", async () => {
    // Which of the two is dropped matters: the catalog row carries the QID that
    // `resolveDestinations` sends down the Wikidata branch, plus the attraction
    // count and blurb the GeoNames row has none of.
    const onAddCatalog = vi.fn();
    render(<Harness country="CN" onAddCatalog={onAddCatalog} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Zoom into Central China/ }));
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Jingzhou" }));

    expect(onAddCatalog).toHaveBeenCalledTimes(1);
    expect(onAddCatalog.mock.calls[0][0]).toEqual({
      qid: "Q71247",
      name: "Jingzhou",
      localName: "荆州市",
      province: "Hubei",
      description: "Jingzhou is a prefecture-level city in southern Hubei province, China.",
      population: 5_231_180,
      attractionCount: 3,
    });
  });

  test("keeps both of two distant cities that share a name", async () => {
    // The overcorrection guard. Hunan's Heshan and the catalog's Heshan in
    // Laibin, Guangxi are 631.3 km apart — a shared romanisation, not a
    // duplicate — so a filter keyed on the name alone would delete a real city
    // from the map. In the committed data 32 of the 51 shard rows that share a
    // folded name with a catalog city are distinct places like these, the
    // widest being the two Yushus at 2,852 km.
    await openCentralChina();

    expect(screen.getAllByRole("button", { name: "Heshan" })).toHaveLength(2);
  });

  test("draws a catalog city the shard has no row for", async () => {
    // The other half of the merge. Wuhan comes only from /api/map/cities, so
    // dropping the catalog spread loses it — and every other test in this file
    // answers that endpoint with an empty list, which is what made the spread
    // deletable without failing anything.
    await openCentralChina();

    expect(screen.getByRole("button", { name: "Wuhan" })).toBeInTheDocument();
  });

  test("offers a place the curated set already covers once, as the curated card", async () => {
    // `curatedPlaceNames` folds, so the shard's capitalised "Zhangjiajie" only
    // matches through `foldPlaceName` — and the curated "Zhangjiajie" marker is
    // already on this map, so an unsuppressed shard row draws a second one
    // under the same aria-label. Enshi is asserted in the same test because a
    // shard leg deleted outright would otherwise pass this on its own.
    const onToggleSelect = vi.fn();
    render(<Harness country="CN" onToggleSelect={onToggleSelect} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Zoom into Central China/ }));
    await settle();

    expect(screen.getAllByRole("button", { name: "Zhangjiajie" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Enshi" })).toBeInTheDocument();

    // And the one that survived is the curated card, which reports through
    // `onToggleSelect`; a catalog marker would have gone to `onAddCatalog`.
    fireEvent.click(screen.getByRole("button", { name: "Zhangjiajie" }));
    expect(onToggleSelect).toHaveBeenCalledWith("zhangjiajie");
  });

  test("hands the file it fetched to the level that draws it", async () => {
    // The state was written and read by nobody for one commit, which is a
    // shape no other test here can see: every assertion above passes just as
    // well against a component that fetches Peru's geometry and drops it.
    render(<Harness country="PE" />);
    await settle();

    expect(screen.getByRole("group", { name: "Map of Peru" })).toBeInTheDocument();
    // The unit the fixture ships, drawn and marked selectable.
    expect(document.querySelector('[data-unit="PE+00"]')).not.toBeNull();
  });

  test("frames the map with the manifest it fetched, not with a fit", async () => {
    // Fetched in the SAME `Promise.all` as the geometry, not in an effect of
    // its own: the level falls back to a fit when it has no entry, so a
    // manifest landing one render later would frame every country twice — and
    // for the nine trimmed countries the first of those two frames shows the
    // island the trim exists to leave out.
    //
    // The entry here deliberately frames a box 10° away from the country, so
    // geometry drawn through it lands outside the viewBox. Nothing else can
    // tell an entry that reached the projection from one that was fetched and
    // dropped: a lookup that missed — the wrong case, the wrong key — falls
    // back to a fit, which draws this same square filling the frame.
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const href = String(url);
        urls.push(href);
        return href === PROJECTION_PATH
          ? Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                PE: {
                  rotate: 0,
                  bounds: [
                    [10, 10],
                    [11, 11],
                  ],
                  scale: 34_377.468,
                },
              }),
            })
          : defaultFetch(href);
      })
    );

    render(<Harness country="PE" />);
    await settle();

    expect(urls).toContain(PROJECTION_PATH);
    const d = document.querySelector('[data-unit="PE+00"]')?.getAttribute("d") ?? "";
    const coordinates = (d.match(/-?[\d.]+/g) ?? []).map(Number);
    expect(coordinates.length).toBeGreaterThan(0);
    expect(Math.min(...coordinates)).toBeLessThan(0);
  });

  test("keeps working for a country whose shard 404s", async () => {
    render(<Harness country="JP" />);

    await settle();
    // The level names the country and points at search, exactly as before.
    expect(screen.getByText(/No places in Japan yet/)).toBeInTheDocument();
    // A country with no shard is a country with no cities to offer, not an
    // outage: the catalog answered, so nothing is broken.
    expect(screen.queryByText(/city list is unavailable/)).not.toBeInTheDocument();
  });
});

/**
 * The open country's own admin-1 geometry (spec §5.1).
 *
 * `/china-provinces.json` was the only topology any country could open, so 245
 * of them opened none — the registry says every country has a file, and this is
 * the fetch that goes and gets it. What these cases pin is the loading half —
 * which URL is asked for, how often, what happens to the one already in flight,
 * and that a country whose file never arrives still reaches every one of its
 * cities. How the result is drawn is `CountryLevel.test.tsx`'s; that the result
 * reaches a renderer at all is pinned here, because nothing else would notice
 * a component holding geometry it never passes on.
 */
describe("the open country's province file", () => {
  test("fetches the opened country's province file, not China's", async () => {
    render(<Harness country="PE" />);
    await settle();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/provinces/PE.json");
    // Both negatives matter and they are different assets: the curated
    // topology is China's hand-built one, and `/provinces/CN.json` is the
    // build's re-envelope of it. Peru has no use for either.
    expect(urls).not.toContain(CHINA_TOPOLOGY_PATH);
    expect(urls).not.toContain("/provinces/CN.json");
  });

  test("asks for no file for a country the build wrote none for", async () => {
    // AQ, BV, HM and XD have no admin-1 geometry at all. `hasDetailLevel` is
    // what keeps a guaranteed 404 off the wire, and it is the only thing that
    // does — `provincePath("AQ")` is a perfectly well-formed URL.
    render(<Harness country="AQ" />);
    await settle();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith("/provinces/"))).toBe(false);
    // Armed: the country was genuinely opened, so the absence above is a
    // decision rather than a component that never mounted.
    expect(urls).toContain("/api/map/cities?country=AQ");
  });

  test("still emits the file for those countries, so the loader needs no special case", async () => {
    // §6.6 D10 suppresses the region CONTROL, never the map. All 34 countries
    // with one selectable unit are in the registry — `lib/countryDetail.test.ts`
    // pins that every entry has a file and every file has an entry — so this
    // loader asks for their geometry exactly as it asks for Peru's, and the
    // gate lives where the affordance is drawn instead.
    //
    // A gate placed HERE would read as the tidier fix and would cost the
    // Faroes their coastline to spare them a control they were never offered.
    // §5.2 makes the map an enhancement over the list; it does not make it
    // optional for 34 countries.
    const single = [...COUNTRY_DETAIL].filter(([, detail]) => detail.count <= 1);
    expect(single).toHaveLength(34);
    for (const [code] of single) expect(hasDetailLevel(code), code).toBe(true);

    render(<Harness country="FO" />);
    await settle();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/provinces/FO.json");
    // And it reached a renderer: the country level draws the file it fetched,
    // which is the half a fetch assertion on its own cannot see.
    expect(screen.getByRole("group", { name: "Map of Faroe Islands" })).toBeInTheDocument();
  });

  test("does not refetch when the country has not changed", async () => {
    // The largest file in the artifact is Canada's at 139 KB gzipped, and one
    // is fetched on every map open — so an effect that refires on an unrelated
    // re-render is not a wasted microtask, it is a wasted download.
    const { rerender } = render(<Harness country="PE" />);
    await settle();
    rerender(<Harness country="PE" />);
    await settle();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u === "/provinces/PE.json")).toHaveLength(1);
  });

  test("aborts an in-flight fetch when the user opens another country", async () => {
    // The effect's existing AbortController has to reach the new leg too. It
    // is observed through the signal the fetch was handed rather than through
    // the DOM, because the failure this guards is a *silent* one: Peru's
    // geometry landing under Germany looks like a map, not like an error.
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { signal?: AbortSignal }) => {
        const href = String(url);
        if (href.startsWith("/provinces/")) {
          if (init?.signal) signals.push(init.signal);
          return pendingUntilAbort(init);
        }
        if (href.startsWith("/api/map/cities")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ available: true, cities: [] }),
          });
        }
        if (href.startsWith("/api/map/airports")) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ airports: [] }) });
        }
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      })
    );

    const { rerender } = render(<Harness country="PE" />);
    await settle();
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    rerender(<Harness country="DE" />);
    await settle();

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    // The replacement is live, not aborted with it — a cleanup that tore down
    // the new controller would pass the line above and break the map.
    expect(signals[1].aborted).toBe(false);
  });

  test("renders the list alone when the province fetch fails", async () => {
    // §5.2: the map is the enhancement, the list is the spine. A 500 on the
    // geometry must not reach `loadError`, which replaces the whole pane with
    // a retry button and takes every city with it.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const href = String(url);
        return href.startsWith("/provinces/")
          ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
          : defaultFetch(href);
      })
    );

    render(<Harness country="PE" />);
    await settle();

    expect(screen.getByRole("button", { name: /Lima/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cusco/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    // Nor is a missing map an outage of the city catalog, which answered.
    expect(screen.queryByText(/city list is unavailable/)).not.toBeInTheDocument();
  });

  test("China still fetches the curated asset and renders identically", async () => {
    render(<Harness country="CN" />);
    await settle();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain(CHINA_TOPOLOGY_PATH);
    // §9.5: China's geometry comes from the curated asset and only from it.
    // `/provinces/CN.json` re-envelopes the same shapes, so fetching it too
    // would be 68 KB for a map that never draws it — and would be the first
    // step towards drawing China from geometry that is not byte-identical.
    expect(urls).not.toContain("/provinces/CN.json");
    // Nor the manifest: `ChinaLevel` fits itself to the curated provinces, and
    // §5.4 frames the merged 10m outlines China does not draw.
    expect(urls).not.toContain(PROJECTION_PATH);
    expect(
      screen.getByRole("group", { name: "Map of China segmented by region" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Zoom into North China/ })).toBeInTheDocument();
  });
});

/**
 * §6.1's chrome, taken off China.
 *
 * Every region affordance this component draws was gated on `hasCurated`, so
 * the other 245 countries got a bare header with no way in and no way out of a
 * province: the zoom existed inside `CountryLevel` from Task 4 and nothing on
 * screen could reach it. What is asserted here is the coordination — which
 * control is offered in which of the two machines' states, what it moves, and
 * that China's own chrome came through the generalisation untouched.
 *
 * How the zoom is DRAWN is `CountryLevel.test.tsx`'s; that a control here
 * reaches it at all is pinned below, because nothing else would notice a
 * `<select>` wired to state no renderer ever receives.
 */
describe("the province level's chrome", () => {
  /**
   * Peru with something to choose between — the shared four-unit fixture,
   * three selectable and one `sel: 0`, served where `provinceFixture` serves
   * its single square. §6.6's gate makes that square a country with no region
   * control at all, which is the wrong country to test a region control in.
   *
   * `cityProvince` names the two ids `PE_SHARD` actually ships, in two
   * different units, so a zoom is observable as the markers it stops drawing
   * rather than only as a transform nobody can see.
   */
  const PE_ZOOMABLE = {
    country: "PE",
    generatedAt: "2026-08-30T00:00:00.000Z",
    idKey: "adm1_code",
    topology: PE_TOPOLOGY,
    cityProvince: { G3936456: "PE-LIM", G3941584: "PE-CUS" },
  };

  /**
   * The manifest answers for nobody here, so `CountryLevel` falls back to a fit
   * over its own units. `PROJECTION_FIXTURE` frames a one-degree square at the
   * origin and this fixture lives at 78°W — framed by that entry every marker
   * would be projected off the viewBox, which is a rendering nothing asserted
   * below is about and a confusing thing to leave true.
   */
  function zoomableFetch(url: string) {
    const href = String(url);
    if (href === "/provinces/PE.json") {
      return Promise.resolve({ ok: true, status: 200, json: async () => PE_ZOOMABLE });
    }
    if (href === PROJECTION_PATH) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    return defaultFetch(href);
  }

  beforeEach(() => {
    fetchMock = vi.fn(zoomableFetch);
    vi.stubGlobal("fetch", fetchMock);
  });

  /** The map's markers, by the name a screen reader gets — never the list's chips. */
  function markerNames(container: HTMLElement): string[] {
    return [...container.querySelectorAll("[data-markers] [data-place]")].map(
      (el) => el.getAttribute("aria-label") ?? ""
    );
  }

  function regionControl(): HTMLSelectElement {
    return screen.getByRole("combobox", { name: "Zoom to a province" }) as HTMLSelectElement;
  }

  test("a non-China country gets a region control", async () => {
    const { container } = render(<Harness country="PE" />);
    await settle();

    // The country's SELECTABLE units and no others. `PE-XXX` is real geometry
    // that shapes the outline without being a subdivision (§7.2), so it is
    // drawn and it is not a destination — offering it here would be the
    // Northern-Cyprus bug with a Peruvian name.
    //
    // In label order, and not the fixture's own order — which is Lima, Cuzco,
    // Isla Lejana, standing in for the `adm1_code` ascending a real file ships.
    // `lib/regionScheme.test.ts` holds the sort itself; what this pins is that
    // it survives the trip into the control, and that "All of Peru" stays at
    // the top of it, because it is the way out of the choice rather than one of
    // the choices.
    expect([...regionControl().querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "All of Peru",
      "Cuzco",
      "Isla Lejana",
      "Lima",
    ]);
    expect(markerNames(container).sort()).toEqual(["Cusco", "Lima"]);
    // C5's 44px minimum, which its sibling controls are each pinned to
    // separately above. This one is the only way into a province, and it is
    // the one control in the header that is not a `STEP_UP_BUTTON` and so
    // cannot inherit the token from that constant.
    expect(regionControl().className).toContain("min-h-[var(--tap-min)]");

    fireEvent.change(regionControl(), { target: { value: "PE-CUS" } });
    await settle();

    // It reaches the renderer, which is the half a control cannot prove about
    // itself: §6.5 draws the group's own cities and drops the rest.
    expect(markerNames(container)).toEqual(["Cusco"]);
    // And §5.2 is untouched — the map filters, the spine does not.
    expect(chip("Lima")).toBeInTheDocument();
  });

  test("the back path is level-aware: region -> country -> world", async () => {
    render(<Harness country="PE" />);
    await settle();

    // One rung is offered at a time, and which one is a question about BOTH
    // machines: the country level's step up is the world, a region's step up
    // is the country, and a control that read only `level` could not tell them
    // apart.
    expect(screen.getByRole("button", { name: "← All countries" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "← All Peru" })).toBeNull();

    fireEvent.change(regionControl(), { target: { value: "PE-CUS" } });
    await settle();
    expect(screen.getByRole("button", { name: "← All Peru" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "← All countries" })).toBeNull();

    // region -> country. The LEVEL machine does not move with it: the two are
    // independent, and a back control that folded the zoom into `MapLevel`
    // would land the user in the world picker from one press.
    fireEvent.click(screen.getByRole("button", { name: "← All Peru" }));
    await settle();
    expect(screen.getByRole("group", { name: "Map of Peru" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /pick a country/ })).toBeNull();
    expect(regionControl().value).toBe("");

    // country -> world, which is the level machine and only the level machine.
    fireEvent.click(screen.getByRole("button", { name: "← All countries" }));
    await settle();
    expect(screen.getByRole("group", { name: /pick a country/ })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Map of Peru" })).toBeNull();

    // And back down again, to the whole country rather than to a region the
    // user had already stepped out of.
    fireEvent.click(screen.getByRole("button", { name: "← Back to Peru" }));
    await settle();
    expect(regionControl().value).toBe("");
    expect(screen.getByRole("button", { name: "← All countries" })).toBeInTheDocument();
  });

  test("the caption names the zoomed region", async () => {
    render(<Harness country="PE" />);
    await settle();
    // Nothing to caption while the whole country is drawn: the map is showing
    // every city it has, so there is no absence to explain.
    expect(screen.queryByText(/Showing/)).toBeNull();

    fireEvent.change(regionControl(), { target: { value: "PE-CUS" } });
    await settle();

    // Named, and paired with where the cities it stopped drawing went. A zoom
    // that silently removes markers reads as a country with fewer cities in
    // it, which is the reading §5.2 exists to prevent.
    expect(
      screen.getByText("Showing Cuzco — the list below still reaches every city")
    ).toBeInTheDocument();
  });

  test("China's chrome is unchanged", async () => {
    render(<Harness country="CN" />);
    await settle();

    // China's region control is the map itself — every province is a zoom
    // button — so the `<select>` the other 245 get would be a second control
    // for the same choice. `regionSchemeFor` is never even asked: this
    // component fetches China's curated asset, not a province file, so it
    // holds no units to build a scheme from.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("heading", { name: "Click a region to zoom in" })).toBeInTheDocument();
    expect(
      screen.getByText("Markers show curated picks — zoom into a region for every city")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Zoom into North China/ }));
    await settle();

    // §9.5's chrome half: the strings, the heading and the back control are
    // the ones pre-Phase-4 China rendered, down to "North China" being the
    // region name and the country name rather than the group label the other
    // 245 now show.
    expect(screen.getByRole("button", { name: "← All China" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "North China" })).toBeInTheDocument();
    expect(screen.getByText("Click any marker to add it to your trip")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "← All China" }));
    await settle();
    expect(screen.getByRole("heading", { name: "Click a region to zoom in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Zoom into North China/ })).toBeInTheDocument();

    // The one thing China does GAIN, stated rather than left for a reader to
    // discover: the country-level rung of the back path, which every one of
    // the 246 gets and none of them had. It is the level machine's control,
    // not a region affordance — China's region chrome above is byte-for-byte
    // what pre-Phase-4 China rendered — and it is offered here, out of the
    // whole country, exactly as it is for Peru.
    expect(screen.getByRole("button", { name: "← All countries" })).toBeInTheDocument();
  });
});

describe("fit lookups degrade instead of throwing on a foreign region label", () => {
  test("an unknown region label gets a neutral fit instead of throwing", () => {
    // bestSeasons: undefined is load-bearing — fitForPlace returns early when a
    // place has its own seasons, so a fixture that sets them would never reach
    // the REGION_MONTHS lookup this test exists to cover.
    const abroad = { ...A_CATALOG_PLACE, region: "Kansai", bestSeasons: undefined };
    expect(() => fitForPlace(abroad, 4)).not.toThrow();
    // Literal, not NEUTRAL_FIT: the constant is what's under test here, so
    // comparing against itself can't catch it regressing from "unknown" back
    // to "poor" — the exact distinction this fit exists to preserve.
    expect(fitForPlace(abroad, 4)).toBe("unknown");
  });

  test("fitForRegion degrades on a label outside China's seven", () => {
    expect(fitForRegion("Kansai", 4)).toBe("unknown");
  });
});
