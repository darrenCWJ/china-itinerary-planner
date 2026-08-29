import type { Topology } from "topojson-specification";
import type { MapPlace } from "./mapTypes";

/**
 * The frozen inputs and the frozen answers for §9.5's success test: **China's
 * rendered output must be byte-identical before and after Phase 4.**
 *
 * `CHINA_BASELINE_MARKUP` was not produced by the code in this tree. Each
 * string is the serialised DOM of the **pre-Phase-4** components — commit
 * `3030f29`, the merge base this phase branched from — rendered against the
 * fixture below. `chinaBaseline.test.tsx` renders today's components against
 * the same fixture and compares. So a diff is never "the snapshot moved with
 * the code"; it is always "China draws something else now".
 *
 * To reproduce or refresh — which should only ever happen once the difference
 * has been read and understood, and never to make a red test green:
 *
 * 1. `mkdir components/map/__baseline_tmp__`
 * 2. `git show 3030f29:components/map/CountryMap.tsx` and
 *    `git show 3030f29:components/map/PlacePopup.tsx` into that directory.
 * 3. In both copies, repoint `"./mapShared"` and `"./mapTypes"` to `"../…"`,
 *    and rename the exported `CountryMap` and `PlacePopup` so the originals
 *    can be imported alongside them. Nothing else is edited — the point is
 *    that this is `3030f29`'s code, not an approximation of it.
 * 4. Render the four cases `chinaBaseline.test.tsx` renders, against the
 *    fixture below and the same props, and take `container.innerHTML` from
 *    each. The two map renders go through `settledMarkup` — a render read at
 *    mount pins `opacity: 0`, not what a user sees.
 * 5. Delete `__baseline_tmp__`. It is a capture harness, not a second copy of
 *    the component for the suite to drift against.
 *
 * The old components resolve today's `mapShared`, `mapTypes`, `lib/provinces`
 * and `lib/months`, which is deliberate: the baseline is "the pre-Phase-4
 * COMPONENTS", and a refresh that also rewound their dependencies would hide
 * exactly the regressions listed below.
 *
 * Not test-only by accident of naming, the same as `worldFixture.ts`: nothing
 * under `app/` or `components/` imports it, so it never reaches a bundle, and
 * it is a module rather than a block inside the test file because a fixture
 * that can drift from the markup it produced is not a baseline.
 *
 * **What a failure here means.** These strings pin every rendered attribute
 * China's level emits — path geometry, the region tint and its month opacity,
 * every pin's fill and radius, every label, every aria-label, the route line,
 * and the popup's four lines. That is deliberately wider than the components
 * themselves: the fit comes from `mapShared.buildFitProjection`, the colours
 * from `mapTypes`, the tints from `lib/provinces`, the popup's copy from
 * `lib/months` and `lib/countryBaseProfile`, and a change in any of them lands
 * here. A `d3-geo` bump can land here too — that is not a false alarm, it is
 * the map moving, and the answer is to read the diff and decide, never to
 * re-capture from HEAD.
 */

/**
 * Absolute (untransformed) TopoJSON, one closed ring per geometry.
 *
 * Four geometries, chosen so the render exercises what is actually
 * China-specific rather than merely present: three provinces from three
 * different regions (North, East, Southwest) so the tint, the label anchor and
 * the month fit all differ between them, plus the nine-dash line, which is the
 * one geometry `provinceByAdcode` does not resolve and which the level draws
 * without ever treating as a region.
 *
 * Real adcodes, because `provinceByAdcode` is what the level filters on: an
 * invented one would silently fall out of the province set and be drawn as a
 * second nine-dash line.
 *
 * **Wound south-west, north-west, north-east, south-east**, which is the order
 * `worldFixture.ts` documents and for the same reason: d3 reads a ring
 * spherically, so the other winding makes each province *the whole globe minus
 * the rectangle* (`geoArea` 4π against 2.3e-4). That renders without error and
 * drags `buildFitProjection` onto the entire sphere, which would leave this
 * baseline pinning the markup of four inverted polygons — byte-identical, and
 * saying nothing about the map anyone looks at.
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
      [121, 31],
      [121, 32],
      [122, 32],
      [122, 31],
      [121, 31],
    ],
    [
      [102, 29],
      [102, 32],
      [105, 32],
      [105, 29],
      [102, 29],
    ],
    [
      [110, 10],
      [110, 12],
      [112, 12],
      [112, 10],
      [110, 10],
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
          properties: { adcode: 310000, name: "上海市" },
        },
        {
          type: "Polygon",
          arcs: [[2]],
          properties: { adcode: 510000, name: "四川省" },
        },
        // No province owns adcode 0 — the nine-dash line.
        {
          type: "Polygon",
          arcs: [[3]],
          properties: { adcode: 0, name: "南海诸岛" },
        },
      ],
    },
  },
} as unknown as Topology;

function place(over: Partial<MapPlace> & Pick<MapPlace, "id" | "name">): MapPlace {
  return {
    kind: "curated",
    localName: null,
    province: null,
    region: "East",
    lat: 31.2,
    lon: 121.5,
    population: null,
    level: "curated",
    attractionCount: 0,
    blurb: null,
    ...over,
  };
}

/**
 * Five places covering every branch the marker code takes.
 *
 * Beijing and Shanghai are curated, so they carry the unscaled radius 7, the
 * `tabIndex={0}` the pre-Phase-4 level gave curated places only, and — being
 * the two route stops — the selection ring and the numbered label. Chengdu is
 * a municipality and Suzhou a prefecture over 3M, so both are labelled at
 * their own radii; Yangzhou is a county-level city under the label threshold
 * and is the only marker that renders as a bare dot.
 *
 * Beijing also carries `bestSeasons`, which routes it through `fitForPlace`'s
 * curated branch instead of its region's month row — the two produce different
 * pin colours in October, and a regression that collapsed one into the other
 * would otherwise be invisible.
 */
export const CHINA_PLACES: MapPlace[] = [
  place({
    id: "beijing",
    name: "Beijing",
    localName: "北京",
    region: "North",
    lat: 39.9,
    lon: 116.4,
    attractionCount: 12,
    emoji: "🏯",
    bestSeasons: ["autumn"],
    avoidSeasons: ["summer"],
    seasonNotes: { autumn: "Clear skies over the Forbidden City." },
  }),
  place({
    id: "shanghai",
    name: "Shanghai",
    localName: "上海",
    region: "East",
    attractionCount: 9,
  }),
  place({
    id: "G1796236",
    name: "Chengdu",
    kind: "catalog",
    province: "Sichuan",
    region: "Southwest",
    lat: 30.66,
    lon: 104.06,
    population: 7_415_590,
    level: "municipality",
    blurb: "Teahouses, pandas and the Sichuan basin.",
  }),
  place({
    id: "G1886760",
    name: "Suzhou",
    kind: "catalog",
    province: "Jiangsu",
    region: "East",
    lat: 31.3,
    lon: 120.6,
    population: 4_083_000,
    level: "prefecture",
  }),
  place({
    id: "G1785623",
    name: "Yangzhou",
    kind: "catalog",
    province: "Jiangsu",
    region: "East",
    lat: 32.4,
    lon: 119.4,
    population: 460_000,
    level: "county",
  }),
];

/** October: a month whose fit differs across the three regions on the fixture. */
export const CHINA_MONTH = 10;

/** Both curated places, in order, so the route line and the stop numbers render. */
export const CHINA_ROUTE_IDS = ["beijing", "shanghai"];

/**
 * The pre-Phase-4 markup, keyed by what was rendered.
 *
 * `country` and `region` are the two states `ChinaLevel` has: the whole country
 * with its region labels and zoom controls, and one region opened, where the
 * transform is no longer the identity and `k` divides every stroke, radius and
 * font size. `popupCurated` and `popupCatalog` are `PlacePopup` over a Chinese
 * place of each kind — the popup lines §9.5 names alongside the pin colours.
 */
export const CHINA_BASELINE_MARKUP: Record<
  "country" | "region" | "popupCurated" | "popupCatalog",
  string
> = {
  country: "<div class=\"relative\"><svg viewBox=\"0 0 860 620\" class=\"h-auto w-full select-none\" role=\"group\" aria-label=\"Map of China segmented by region\"><g style=\"transform: translate(0px, 0px) scale(1); transform-origin: 0 0; transition: transform 650ms cubic-bezier(0.33, 1, 0.68, 1);\"><path d=\"M598,69.933L598,15.104L640,15.104L640,69.933Z\" fill=\"#8a6d3b\" fill-opacity=\"0.5\" stroke=\"var(--paper)\" stroke-width=\"1\" class=\"cursor-pointer\" role=\"button\" aria-label=\"Zoom into North China (Beijing)\"><title>Beijing · North China</title></path><path d=\"M808,507.893L808,458.633L850,458.633L850,507.893Z\" fill=\"#1d5c9e\" fill-opacity=\"0.5\" stroke=\"var(--paper)\" stroke-width=\"1\" class=\"cursor-pointer\" role=\"button\" aria-label=\"Zoom into East China (Shanghai)\"><title>Shanghai · East China</title></path><path d=\"M10,604.896L10,458.633L136,458.633L136,604.896Z\" fill=\"#7d5b8a\" fill-opacity=\"0.5\" stroke=\"var(--paper)\" stroke-width=\"1\" class=\"cursor-pointer\" role=\"button\" aria-label=\"Zoom into Southwest China (Sichuan)\"><title>Sichuan · Southwest China</title></path><path d=\"M346,1456.353L346,1370.776L430,1370.776L430,1456.353Z\" fill=\"none\" stroke=\"var(--seal)\" stroke-opacity=\"0.5\" stroke-width=\"1\"></path><text x=\"409.0000000000009\" y=\"-40.5484400545738\" text-anchor=\"middle\" class=\"pointer-events-none font-mono uppercase\" font-size=\"13\" letter-spacing=\"0.18em\" fill=\"var(--ink-2)\" opacity=\"0.85\">North</text><text x=\"1039.0000000000018\" y=\"-332.7486590453707\" text-anchor=\"middle\" class=\"pointer-events-none font-mono uppercase\" font-size=\"13\" letter-spacing=\"0.18em\" fill=\"var(--ink-2)\" opacity=\"0.85\">Northeast</text><text x=\"707.2000000000016\" y=\"428.8197161645662\" text-anchor=\"middle\" class=\"pointer-events-none font-mono uppercase\" font-size=\"13\" letter-spacing=\"0.18em\" fill=\"var(--ink-2)\" opacity=\"0.85\">East</text><text x=\"367.0000000000009\" y=\"876.3288872260489\" text-anchor=\"middle\" class=\"pointer-events-none font-mono uppercase\" font-size=\"13\" letter-spacing=\"0.18em\" fill=\"var(--ink-2)\" opacity=\"0.85\">South</text><text x=\"-11\" y=\"614.4910344050056\" text-anchor=\"middle\" class=\"pointer-events-none font-mono uppercase\" font-size=\"13\" letter-spacing=\"0.18em\" fill=\"var(--ink-2)\" opacity=\"0.85\">Southwest</text><text x=\"-409.99999999999955\" y=\"15.103879614671087\" text-anchor=\"middle\" class=\"pointer-events-none font-mono uppercase\" font-size=\"13\" letter-spacing=\"0.18em\" fill=\"var(--ink-2)\" opacity=\"0.85\">Northwest</text><text x=\"455.2000000000007\" y=\"498.08303472941475\" text-anchor=\"middle\" class=\"pointer-events-none font-mono uppercase\" font-size=\"13\" letter-spacing=\"0.18em\" fill=\"var(--ink-2)\" opacity=\"0.85\">Central</text><polyline points=\"614.800000000002,48.097347327741545 829.0000000000018,498.08303472941475\" fill=\"none\" stroke=\"var(--ink-1)\" stroke-width=\"2\" stroke-dasharray=\"7 5\" stroke-linecap=\"round\" opacity=\"0.75\" style=\"transition: opacity 250ms;\"></polyline><g opacity=\"1\" style=\"transition: opacity 250ms;\"><g class=\"cursor-pointer\" role=\"button\" tabindex=\"0\" aria-pressed=\"true\" aria-label=\"Beijing (selected)\"><circle cx=\"614.800000000002\" cy=\"48.097347327741545\" r=\"10.5\" fill=\"none\" stroke=\"var(--seal)\" stroke-width=\"2\" opacity=\"0.9\"></circle><circle cx=\"614.800000000002\" cy=\"48.097347327741545\" r=\"7\" fill=\"#2f7d54\" fill-opacity=\"0.95\" stroke=\"var(--paper)\" stroke-width=\"1.2\"></circle><text x=\"614.800000000002\" y=\"51.29734732774155\" text-anchor=\"middle\" font-size=\"8\" font-weight=\"700\" fill=\"var(--paper)\" class=\"pointer-events-none\">1</text><text x=\"614.800000000002\" y=\"38.097347327741545\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"600\" fill=\"var(--ink-0)\" stroke=\"var(--paper)\" stroke-width=\"3\" paint-order=\"stroke\" class=\"pointer-events-none\">Beijing</text></g><g class=\"cursor-pointer\" role=\"button\" tabindex=\"0\" aria-pressed=\"true\" aria-label=\"Shanghai (selected)\"><circle cx=\"829.0000000000018\" cy=\"498.08303472941475\" r=\"10.5\" fill=\"none\" stroke=\"var(--seal)\" stroke-width=\"2\" opacity=\"0.9\"></circle><circle cx=\"829.0000000000018\" cy=\"498.08303472941475\" r=\"7\" fill=\"#2f7d54\" fill-opacity=\"0.95\" stroke=\"var(--paper)\" stroke-width=\"1.2\"></circle><text x=\"829.0000000000018\" y=\"501.28303472941474\" text-anchor=\"middle\" font-size=\"8\" font-weight=\"700\" fill=\"var(--paper)\" class=\"pointer-events-none\">2</text><text x=\"829.0000000000018\" y=\"488.08303472941475\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"600\" fill=\"var(--ink-0)\" stroke=\"var(--paper)\" stroke-width=\"3\" paint-order=\"stroke\" class=\"pointer-events-none\">Shanghai</text></g></g></g></svg></div>",
  region: "<div class=\"relative\"><svg viewBox=\"0 0 860 620\" class=\"h-auto w-full select-none\" role=\"group\" aria-label=\"Map of East China with selectable places\"><g style=\"transform: translate(-3715.0000000000073px, -2106.3156876779613px) scale(5); transform-origin: 0 0; transition: transform 650ms cubic-bezier(0.33, 1, 0.68, 1);\"><path d=\"M598,69.933L598,15.104L640,15.104L640,69.933Z\" fill=\"#8a6d3b\" fill-opacity=\"0.05\" stroke=\"var(--line-1)\" stroke-width=\"0.13999999999999999\"><title>Beijing · North China</title></path><path d=\"M808,507.893L808,458.633L850,458.633L850,507.893Z\" fill=\"#1d5c9e\" fill-opacity=\"0.5\" stroke=\"var(--paper)\" stroke-width=\"0.13999999999999999\"><title>Shanghai · East China</title></path><path d=\"M10,604.896L10,458.633L136,458.633L136,604.896Z\" fill=\"#7d5b8a\" fill-opacity=\"0.05\" stroke=\"var(--line-1)\" stroke-width=\"0.13999999999999999\"><title>Sichuan · Southwest China</title></path><polyline points=\"614.800000000002,48.097347327741545 829.0000000000018,498.08303472941475\" fill=\"none\" stroke=\"var(--ink-1)\" stroke-width=\"0.4\" stroke-dasharray=\"1.4 1\" stroke-linecap=\"round\" opacity=\"0.75\" style=\"transition: opacity 250ms;\"></polyline><g opacity=\"1\" style=\"transition: opacity 250ms;\"><g class=\"cursor-pointer\" role=\"button\" tabindex=\"0\" aria-pressed=\"true\" aria-label=\"Shanghai (selected)\"><circle cx=\"829.0000000000018\" cy=\"498.08303472941475\" r=\"2.5\" fill=\"none\" stroke=\"var(--seal)\" stroke-width=\"0.4\" opacity=\"0.9\"></circle><circle cx=\"829.0000000000018\" cy=\"498.08303472941475\" r=\"1.8\" fill=\"#2f7d54\" fill-opacity=\"0.95\" stroke=\"var(--paper)\" stroke-width=\"0.24\"></circle><text x=\"829.0000000000018\" y=\"498.72303472941474\" text-anchor=\"middle\" font-size=\"1.9800000000000002\" font-weight=\"700\" fill=\"var(--paper)\" class=\"pointer-events-none\">2</text><text x=\"829.0000000000018\" y=\"495.6830347294147\" text-anchor=\"middle\" font-size=\"2.2\" font-weight=\"600\" fill=\"var(--ink-0)\" stroke=\"var(--paper)\" stroke-width=\"0.6\" paint-order=\"stroke\" class=\"pointer-events-none\">Shanghai</text></g><g class=\"cursor-pointer\" role=\"button\" tabindex=\"-1\" aria-pressed=\"false\" aria-label=\"Suzhou\"><circle cx=\"791.2000000000016\" cy=\"493.1702465582075\" r=\"1.3\" fill=\"#2f7d54\" fill-opacity=\"0.8\" stroke=\"var(--paper)\" stroke-width=\"0.24\"></circle><text x=\"791.2000000000016\" y=\"491.2702465582075\" text-anchor=\"middle\" font-size=\"2.2\" font-weight=\"600\" fill=\"var(--ink-0)\" stroke=\"var(--paper)\" stroke-width=\"0.6\" paint-order=\"stroke\" class=\"pointer-events-none\">Suzhou</text></g><g class=\"cursor-pointer\" role=\"button\" tabindex=\"-1\" aria-pressed=\"false\" aria-label=\"Yangzhou\"><circle cx=\"740.8000000000011\" cy=\"438.7795133240518\" r=\"0.9\" fill=\"#2f7d54\" fill-opacity=\"0.8\" stroke=\"var(--paper)\" stroke-width=\"0.24\"></circle></g></g></g></svg></div>",
  popupCurated: "<div class=\"pointer-events-none absolute z-20 rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-3 shadow-lg\" style=\"width: 260px; left: 270px; top: 208px; transform: translateY(-100%);\" role=\"tooltip\"><div class=\"flex items-baseline gap-2\"><span aria-hidden=\"true\">🏯</span><p class=\"font-display text-sm font-bold\">Beijing</p><span class=\"font-kai text-xs text-[var(--seal)]\">北京</span></div><p class=\"font-mono text-[10px] uppercase tracking-widest text-[var(--ink-2)]\">North China</p><div class=\"mt-2 flex items-center gap-2\"><span class=\"inline-block h-2.5 w-2.5 rounded-full\" style=\"background-color: rgb(47, 125, 84);\" aria-hidden=\"true\"></span><span class=\"text-xs font-semibold\">Great time</span><span class=\"text-xs text-[var(--ink-2)]\">7°–19°C typical</span></div><p class=\"mt-1 text-xs text-[var(--ink-2)]\">Clear skies over the Forbidden City.</p><p class=\"mt-1 text-xs\"><span aria-hidden=\"true\">✨</span> Fragrant Hills foliage from late Oct</p><div class=\"mt-2 flex items-center justify-between border-t border-dashed border-[var(--line-1)] pt-2 text-[11px] text-[var(--ink-2)]\"><span title=\"National Day Golden Week falls in this month\">Crowds ●●●●○<span class=\"ml-1\">🇨🇳</span></span><span>12 sights</span></div><p class=\"mt-1.5 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--accent-ink)]\">Click to select</p></div>",
  popupCatalog: "<div class=\"pointer-events-none absolute z-20 rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-3 shadow-lg\" style=\"width: 260px; left: 8px; top: 60px;\" role=\"tooltip\"><div class=\"flex items-baseline gap-2\"><p class=\"font-display text-sm font-bold\">Chengdu</p></div><p class=\"font-mono text-[10px] uppercase tracking-widest text-[var(--ink-2)]\">Sichuan · municipality</p><div class=\"mt-2 flex items-center gap-2\"><span class=\"inline-block h-2.5 w-2.5 rounded-full\" style=\"background-color: rgb(47, 125, 84);\" aria-hidden=\"true\"></span><span class=\"text-xs font-semibold\">Great time</span><span class=\"text-xs text-[var(--ink-2)]\">14°–21°C typical</span></div><p class=\"mt-1 line-clamp-3 text-xs text-[var(--ink-2)]\">Teahouses, pandas and the Sichuan basin.</p><div class=\"mt-2 flex items-center justify-between border-t border-dashed border-[var(--line-1)] pt-2 text-[11px] text-[var(--ink-2)]\"><span title=\"National Day Golden Week falls in this month\">Crowds ●●●●○<span class=\"ml-1\">🇨🇳</span></span><span>7.4M people</span></div><p class=\"mt-1.5 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--accent-ink)]\">Click to select</p></div>",
};
