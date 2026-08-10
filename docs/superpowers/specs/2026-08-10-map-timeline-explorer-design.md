# Map + Timeline Explorer — Design

Date: 2026-08-10
Status: Approved (chat) — map style, placement and AI scope confirmed by user.

## Goal

Add an interactive, zoomable map of China to step 1 of the wizard, with a
draggable month timeline that shows seasons/crowds/monthly highlights, marker
multi-select feeding the existing wizard state, and a rule-based route
suggester (with a clean seam to add AI later).

## Decisions (from user)

- **Map style**: real province-level SVG map; country view segmented by the
  app's 7 regions, zooming into a region reveals the full catalog (~700
  cities) in that region.
- **Placement**: a Map ↔ Cards view toggle inside the Destinations step.
  Map selections and card selections are the same state.
- **AI**: none for now. Route suggestions are rule-based; the suggester's
  function boundary is the future AI slot.
- **21st.dev**: used as interaction-pattern inspiration only (timeline
  scrubber, hover cards); implemented in plain Tailwind to match the existing
  paper-ticket aesthetic. No shadcn/Radix install.

## Architecture

### Geometry

- Simplified China province boundaries (TopoJSON, target ≤ ~300 KB) bundled
  as a static asset under `public/`, lazy-fetched only when map view opens.
- `d3-geo` for projection (geoMercator fitted to China) and path generation;
  `topojson-client` to inflate the TopoJSON. No tile server, no API keys.

### Shared libraries (pure, unit-tested)

- `lib/provinces.ts` — province table: Chinese name (as it appears in the
  GeoJSON), English name, region. Single source of truth for the
  province→region mapping; `lib/server/catalog.ts` switches to it.
- `lib/geo.ts` — haversine distance, bbox helpers.
- `lib/months.ts` — `MONTH_META` (per-month national crowd level 1–5,
  holiday bands: Chinese New Year, Labour Day, summer holidays, Golden
  Week), `seasonOfMonth()`, `monthFit(dest, month)` returning
  `great | ok | poor | avoid` derived from `bestSeasons`/`avoidSeasons`,
  a region×month fallback score for catalog cities, a region×month
  approximate climate table (temp range + one-line note), and curated
  monthly highlights for curated destinations (e.g. Harbin Ice Festival).
- `lib/route.ts` — `suggestRoute(places, options)`: nearest-neighbour
  ordering from the northern-/western-most anchor (deterministic), legs with
  haversine distance, estimated rail time (~250 km/h + 1 h buffer), and a
  `flight` flag for legs > 1200 km. This is the future AI seam: same input
  (selected places + month), same output (ordered legs + notes).

### Data

- `Destination` gains required `lat`/`lon`; all curated entries get real
  coordinates. Catalog cities already carry lat/lon.
- New `GET /api/map/cities`: compact JSON of all catalog cities (qid, name,
  chineseName, province, lat, lon, population, level, attractionCount,
  truncated description). ~60–140 KB, cached immutable per deploy.

### Components (`components/map/`)

- `ChinaMap.tsx` — SVG rendering: province paths, region tinting, markers,
  selection stamps, route polyline. Two zoom levels: country ↔ region.
  Zoom is a CSS transform transition on a group; markers fade out during
  the transition and fade in at the target zoom (avoids mid-transition
  scale artefacts). Marker radius/stroke compensate by 1/k at rest.
- `MonthTimeline.tsx` — draggable Jan–Dec scrubber (pointer events +
  keyboard arrows for a11y), holiday/crowd bands, selected-month readout.
- `PlacePopup.tsx` — hover card: name, province, month verdict, typical
  weather, crowd meter, season note / monthly highlight.
- `MapExplorer.tsx` — container: owns month + zoom + hover state, fetches
  `/api/map/cities` and the TopoJSON lazily, renders map + timeline +
  legend + route panel.

### Wiring

- `DestinationStep` gets a Map ↔ Cards toggle. `MapExplorer` receives the
  same `selected`/`extras`/callbacks as the card grid. Selecting a catalog
  city on the map constructs a `CatalogHit` (same flow as search).
- "Apply this order" calls a new `onReorder(ids)` prop so the plan
  generator receives destinations in route order.
- Picking a month also sets the wizard `season` (month → season), so the
  details step stays consistent.

## Rendering rules

- Country view: provinces tinted by region hue; intensity scales with the
  selected month's fit for that region (great = full, ok = muted,
  poor/avoid = washed out). Curated destinations shown as markers.
- Region view: all catalog cities in the region as markers — municipalities
  and prefectures larger, counties as small dots; marker color = month fit.
  Back button returns to country view.
- Selected markers get the 已选 stamp treatment (ring + seal color).

## Error handling

- TopoJSON/cities fetch failure → inline error card with retry; the Cards
  view is always available as fallback.
- Missing/zero-city catalog (serverless cold start) → `ensureCatalogLoaded`
  in the API route; if still empty, map shows curated markers only plus a
  notice.

## Testing

- Unit: `lib/months.test.ts` (season mapping, fit verdicts, holiday bands),
  `lib/route.test.ts` (deterministic ordering, leg distances/times, flight
  flag), existing suites stay green after the `Destination` type change.
- Manual/browser: zoom in/out, drag timeline, hover popups, select on map →
  appears in cards view and flows to plan; print view unaffected.

## Out of scope (this iteration)

- AI-generated plans/suggestions (seam left in `lib/route.ts`).
- Free pan/zoom gestures beyond the two zoom levels.
- Attraction-level markers (cities only; attractions stay in popups/counts).
