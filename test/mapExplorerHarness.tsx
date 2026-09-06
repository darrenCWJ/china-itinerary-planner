import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect, useState, type ComponentType } from "react";
import { afterEach, expect, vi } from "vitest";
import { PrefsProvider } from "@/components/shell/PrefsProvider";
import type { AirportPick } from "@/components/trip/AirportPicker";
import fixture from "@/data/climate-anchors.json";
import { PROJECTION_PATH } from "@/lib/countryProjection";
import { PREFS_COOKIE, serializePrefsCookie, type UserPrefs } from "@/lib/prefs";
import { MapExplorer, type MapLevel } from "@/components/map/MapExplorer";
import type { MapPlace } from "@/components/map/mapTypes";

/**
 * The fixtures, the fetch table and the host component the four MapExplorer
 * test files share.
 *
 * A plain non-test module for the reason `countryFixture.ts` gives and spec
 * §12.1 restates: importing one `.test.tsx` from another makes vitest collect
 * the imported file's `describe` blocks a second time. Nothing under `app/` or
 * `components/` imports it, so it never reaches a bundle.
 *
 * Lives under `test/`, not beside the component it mounts: it value-imports
 * `vitest` and `@testing-library/react`, and `lib/contracts.test.ts` scans
 * `components/` for surfaces that mount `MapExplorer` — sitting in
 * `components/map/` would make this file one of them.
 *
 * What is NOT here is `fetchMock` and the `beforeEach` that builds it. Two of
 * the four files reassign that variable — `withAirports` and the province
 * chrome's own `beforeEach` do — and an ESM import is a read-only binding, so
 * a shared one could not be written to without rewriting the tests that write
 * it. Each file declares its own and points it at `defaultFetch` below.
 */

/**
 * Two countries is enough to prove a pick is carried; see WorldMap.test.tsx.
 *
 * Carries both `smallCountries` (WorldTopology's shape) and `points`
 * (GlobeTopology's shape, `lib/globeTopology.ts`) so the same fixture body —
 * `defaultFetch` below returns it for every consumer's `fetchMock` for any
 * URL that isn't a China or catalog endpoint — parses under whichever
 * world-level renderer a test exercises. `GlobeLevel.test.tsx` keeps its own
 * richer, two-hemisphere fixture for what it actually tests (rotation,
 * clipping); this one only needs to stay parseable.
 *
 * Wound south-west, north-west, north-east, south-east, the order
 * `worldFixture.ts` documents and for the reason it gives: reversed, d3 reads
 * each ring as the whole sphere minus the rectangle (`geoArea` 4π), which
 * renders without error and fits the projection to the entire globe.
 */
export const WORLD_FIXTURE = {
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
export const CHINA_FIXTURE = {
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

export const CHINA_TOPOLOGY_PATH = "/china-provinces.json";

/** A generic catalog place — the shape MapExplorer builds for a catalog city. */
export const A_CATALOG_PLACE: MapPlace = {
  id: "some-catalog-qid",
  kind: "catalog",
  name: "Some City",
  localName: null,
  province: "Some Province",
  country: "CN",
  region: "East",
  lat: 30,
  lon: 120,
  population: 100_000,
  level: "prefecture",
  attractionCount: 2,
  blurb: null,
};
/**
 * WorldPane pulls WorldMap in through `next/dynamic`: real code-splitting in
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
 * hands the right one straight back, so nothing in the files that import
 * this harness suspends and no assertion depends on how loaded the CPU is.
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
 * assertion in the files that import this harness would pass against the
 * wrong component.
 *
 * What is given up is coverage of the `loading` fallback, which no test in
 * the files that import this harness asserts on.
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
 * `elev` is the field §9.4's lapse-rate correction reads; Cusco's 3,312 m is
 * worth a whole band.
 */
export const PE_SHARD = {
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
      elev: 152,
      tz: "America/Lima",
    },
    {
      id: "G3941584",
      n: "Cusco",
      lat: -13.53188,
      lon: -71.96701,
      a1: "Cuzco Department",
      p: 428_450,
      elev: 3312,
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
export const PE_ENRICHMENT = {
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
export const DE_SHARD = {
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

export const anchorRow = (key: string): number[] => {
  const found = fixture.cities.find((c) => c.key === key);
  if (!found) throw new Error(`data/climate-anchors.json has no city "${key}"`);
  return found.row;
};

/**
 * Peru's climate shard, cut to the two cities `PE_SHARD` carries. The rows
 * are the anchors fixture's, which `lib/climateShard.test.ts` pins
 * byte-identical to the committed `public/climate/PE.json`, so what the map
 * colours here is what it colours in production.
 */
export const PE_CLIMATE = {
  country: "PE",
  generatedAt: "2026-09-03T19:48:35.466Z",
  source: "CHELSA V2.1 climatologies 1981-2010, CC0 1.0, DOI 10.16904/envidat.228",
  cities: { G3936456: anchorRow("lima"), G3941584: anchorRow("cusco") },
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
export const CN_SHARD = {
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
export const CN_CATALOG = [
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
export function provinceFixture(code: string) {
  // China gets a second unit because it HAS 31, and D10 suppresses the region
  // control at one: a one-unit CN would hide the province picker China gained
  // when it stopped rendering through `ChinaLevel`, which is the thing
  // several of the province cases in MapExplorer.provinces.test.tsx are about.
  const extra =
    code === "CN"
      ? [
          {
            type: "Polygon",
            id: "CN+01",
            arcs: [[0]],
            properties: {
              name: "CN second unit",
              name_en: "CN second unit",
              iso_3166_2: "CN-2",
              gn_a1_code: "CN.02",
              sel: 1,
            },
          },
        ]
      : [];
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
            ...extra,
          ],
        },
      },
    },
    cityProvince: {},
  };
}

/** `/provinces/PE.json` and nothing else — not the index, not a traversal. */
export const PROVINCE_FILE = /^\/provinces\/([A-Z]{2})\.json$/;

/**
 * The §5.4 manifest, framing the one square every province fixture draws.
 *
 * Real entries rather than an empty object, so the country level takes its
 * committed frame here exactly as it does in production. A country the
 * manifest has no entry for is still drawn — it falls back to a fit over its
 * own units — and `CountryLevel.test.tsx` is where that fallback is pinned.
 */
export const PROJECTION_FIXTURE = Object.fromEntries(
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
export function defaultFetch(url: string) {
  const href = String(url);
  // Answered ahead of the chain below rather than inside it, so the shape of
  // that chain — one country's assets, in the order the effect asks for them —
  // stays readable. The manifest is not one country's asset: it is the same
  // file for all 246.
  if (href === PROJECTION_PATH) {
    return Promise.resolve({ ok: true, status: 200, json: async () => PROJECTION_FIXTURE });
  }
  // Not a map asset at all: the route panel's arrival picker is an
  // AirportInput, and any test that seeds an arrival code hands it a
  // prefilled field. Answered explicitly so it can never fall through to the
  // world fixture at the end of the chain — that body has no `results`, and a
  // picker reading `undefined.length` fails whichever test happened to still
  // be mounted when the debounce came due, not the one that caused it.
  if (href.startsWith("/api/airports/search")) {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ results: [] }) });
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
                    : href === "/climate/PE.json"
                      ? PE_CLIMATE
                      // Every other country's climate file 404s — the honest
                      // answer for the four codes with no shard, and the shape
                      // a country takes between a catalog refresh and the next
                      // climate dispatch.
                      : href.startsWith("/climate/")
                        ? null
                        : href.startsWith("/cities/")
                          ? null
                          : WORLD_FIXTURE;
  return Promise.resolve({
    ok: body !== null,
    status: body === null ? 404 : 200,
    json: async () => body ?? {},
  });
}


/**
 * A request that never answers and rejects when it is aborted — what a real
 * in-flight fetch does when the country changes under it.
 *
 * Neither the shared mock (which resolves immediately and ignores the signal)
 * nor a bare `new Promise(() => {})` (which never settles at all) reproduces
 * that, and the abort path is the one where a *previous* country's answer can
 * still reach `setState`.
 */
export function pendingUntilAbort(init?: { signal?: AbortSignal }): Promise<never> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError"))
    );
  });
}

/** A catalog that reports itself down, for a country with no shard to fall back on. */
export function deadCatalog(url: string) {
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


/**
 * The one hook every file needs, registered where the file calls this rather
 * than at this module's top level: a top-level `afterEach` in an imported
 * module attaches to whichever suite happens to be collecting it, which is a
 * coupling no reader of the test file can see.
 */
export function installMapExplorerHarness(): void {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    // Written by `Harness`'s `prefs` prop, via the same cookie `PrefsProvider`
    // reads on mount — cleared so one test's prefs never leak into the next.
    document.cookie = `${PREFS_COOKIE}=; Path=/; Max-Age=0`;
  });
}

/**
 * Flush mount effects, the promises they start, and the renders those cause —
 * then let the test query synchronously.
 *
 * Used instead of `findBy*` throughout the four MapExplorer test files. Those
 * poll against a wall-clock budget, and mounting this component is real CPU
 * work (jsdom plus d3-geo projection) rather than anything that waits. That
 * is comfortably inside the budget on an idle machine and can fall outside
 * it when the full suite has every core busy, which is exactly the shape
 * of the flake: it never reproduced on those files alone, only in a full
 * run. Nothing here was ever slow to *settle* — it was slow to *compute*,
 * and a poll timeout cannot tell those apart, so it reported "Unable to
 * find role=…" as though the element were missing.
 *
 * The "~165ms" this note used to quote for that mount was measured off the
 * first test that calls it, and was mostly not the mount: the bulk of it was
 * the one-time jsdom environment warmup that every file's first role query
 * used to pay, which now happens in vitest.setup.ts instead. Removing it
 * from this file takes the first test from ~347ms to ~164ms. The sibling
 * tests that mount and settle the same world level land at ~35-45ms; the
 * first test stays longer than they do because it also pays React's first
 * render and the world renderer's first module evaluation, neither of which
 * the setup warmup covers.
 *
 * Draining to a fixed point removes the clock from the assertion entirely. The
 * work still takes however long it takes; the test simply waits for it rather
 * than racing it. vitest's own testTimeout stays as the backstop for a genuine
 * hang, which is the only thing a timeout should be catching.
 */
export async function settle(): Promise<void> {
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
export function chip(name: string | RegExp): HTMLElement {
  const matches = screen
    .getAllByRole("button", { name })
    .filter((el): el is HTMLElement => el.tagName === "BUTTON");
  expect(matches, `expected one list chip named ${name}`).toHaveLength(1);
  return matches[0];
}

export function Harness({
  country = "CN",
  level = "country",
  prefs,
  selected = [],
  onAddCatalog = () => {},
  onToggleSelect = () => {},
  arrival = null,
  onArrivalChange,
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
  selected?: string[];
  onAddCatalog?: (hit: unknown) => void;
  /** Curated markers report through this one; catalog markers never do. */
  onToggleSelect?: (id: string) => void;
  /** Task 9: the wizard's arrival gateway, and the callback the route panel's picker reports to. */
  arrival?: AirportPick | null;
  onArrivalChange?: (pick: AirportPick | null) => void;
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
        selected={selected}
        visited={[]}
        country={activeCountry}
        level={activeLevel}
        onCountryChange={setCountry}
        onLevelChange={setLevel}
        onToggleSelect={onToggleSelect}
        onAddCatalog={onAddCatalog}
        onRemoveCatalog={() => {}}
        onReorder={() => {}}
        arrival={arrival}
        onArrivalChange={onArrivalChange}
      />
    </PrefsProvider>
  );
}

/**
 * Mounts `Harness` and flushes its mount effects — this file's own
 * `render` + `settle()` pair, named for the tests that call `renderExplorer`
 * that only vary `selected`/`country`/`arrival`/`onArrivalChange` and want
 * the mount and flush in one call. Returns what `render` returns, `unmount`
 * included, so a test that needs a second render of its own can tear the
 * first down first.
 */
export async function renderExplorer(props: {
  selected?: string[];
  country?: string;
  arrival?: AirportPick | null;
  onArrivalChange?: (pick: AirportPick | null) => void;
}): Promise<ReturnType<typeof render>> {
  const result = render(<Harness {...props} />);
  await settle();
  return result;
}
