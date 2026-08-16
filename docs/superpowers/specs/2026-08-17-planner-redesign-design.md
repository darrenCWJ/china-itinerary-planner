# Itinerary Planner Redesign — Design

**Date:** 2026-08-17
**Status:** Approved for planning
**Source:** Claude Design project `f12cdbfe-73f7-4940-9eef-f0ce4c3d59b2` — "Itinerary Planner Prototype.dc.html"

---

## 1. Context

The app today is a China-only trip planner: a light "railway ticket / passport"
aesthetic, a three-step wizard at `/plan`, and a trip page at `/trip/[id]`
carrying seven top tabs. A design prototype was produced in Claude Design
proposing a dark glass shell with a nine-item left rail, per-country accent
colours, a 26-country globe picker, and a time-blocked day schedule.

The prototype is a template to adapt, not a target to copy. Three problems were
named directly:

1. Too many navigation items — the prototype's nine-item rail works against the
   simplicity the app is meant to have. The existing seven-tab strip has the
   same problem.
2. The colour scheme needs to change, with a user-facing toggle.
3. Selecting things while planning — both before and during a trip — is neither
   fast nor accurate enough.

A fourth requirement emerged during design: **the app is expanding beyond China
to all countries.** This constrains every decision below. Anything that requires
hand-authoring per country does not scale and is rejected on those grounds.

### Goals

- Collapse navigation from 9 (prototype) and 7 (current) to 4 primary items.
- Make destination selection fast to perform and accurate to verify.
- Introduce a themeable token system with light default, dark support, and a
  per-country accent that is derived rather than authored.
- Make `country` a first-class concept across types, data, and UI.
- Ship a world map for country selection.

### Non-goals

Stated explicitly so they are not discovered as gaps later:

- **No country other than China gets populated destination data.** Other
  countries are reachable through catalog search and hand-added places only.
- No change to the auth, session, or trip-ownership model.
- No change to the expense-splitting or settlement logic.
- The briefing/share output is relocated in the UI but its content is unchanged.
- **Mobile layouts and offline support are specified separately** — see the
  follow-up mobile spec. This spec carries only the *constraints* that work must
  honour (§7), not its design.

---

## 2. Information architecture

### 2.1 The collapse

Sixteen surfaces across the two navigations reduce to four jobs.

| Rail item | Absorbs from prototype | Absorbs from current app |
|---|---|---|
| **Plan** — where you go, in what order, on which day | GLOBE, PLAN, ROUTE, DAY | Itinerary |
| **Today** — what is happening now; log it | TRIP (dash), PHOTOS | Tracker |
| **Money** — forecast vs. actual, who owes who | BUDGET | Money |
| **Kit** — bookings and bag | — | Tickets, Packing |

Four surfaces leave the rail entirely:

- **Trips** → a trip switcher in the header. Switching trips is a context
  change, not a navigation destination — the same reason a workspace switcher
  is not a sidebar item.
- **Crew** → header avatars plus an invite button. Membership is ambient
  context, not a page.
- **Route map** → a map ⇄ list toggle *inside* Plan. It is a view of the
  itinerary, not a sibling of it.
- **Pitch / Briefing** → a **Share** action in the header. It is an output you
  generate, not a room you occupy.

**Kit** groups tickets and packing because both are things you carry, both are
checkable, and both matter at the same two moments: the night before, and at the
barrier. Crew was deliberately removed from this group — a category you can only
define as "the other three things" is a leftovers bin, not a category.

### 2.2 Why four

Four labels fit a mobile bottom bar as thumb targets. Nine never could. That
constraint is load-bearing: it is what keeps the rail from re-growing as
countries and features are added. Any proposal for a fifth rail item must first
answer why it cannot be a section, a toggle, or a header action.

### 2.3 Shell layout

- **Desktop:** 76px left rail (icon + short label), persistent header.
- **Mobile:** bottom bar with the same four items; header collapses to trip name
  plus an overflow menu holding Share, crew, and settings.

Header contents, left to right: trip switcher · trip name and dates · crew
avatars + invite · Share · theme toggle.

---

## 3. Planner interaction

### 3.1 The accuracy problem

The current wizard asks for destinations at step 0 and trip length at step 1
(`app/plan/page.tsx`). The user picks blind and discovers at step 2 that six
cities do not fit in five days.

### 3.2 Changes

**1. Flip the wizard order.** Dates, days, and travellers first; destinations
second, chosen against a live budget of days. This is a reorder of existing
components (`DetailsStep` before `DestinationStep`), not new code, and it is the
single largest accuracy improvement available.

**2. One merged search input.** The curated grid (`DestinationStep`) and catalog
search (`CatalogSearch`) are currently separate paths. Merge into one
always-focused input: curated results ranked first, catalog results below,
arrow-key navigation, Enter to add. This is mandatory once the app covers all
countries — a browsable grid of every city on Earth cannot be rendered.

**3. Live feasibility counter.** Persistently visible while picking:
`5 cities · 12 nights needed · 7 days set — 5 over`. The conflict surfaces at
the moment of choice rather than three screens later.

**4. Shelf plus target day.** On the trip's Plan tab: a places shelf on one
side, the day list on the other, and an explicit **"adding to Day 03"** target
chip. Tapping `+` on a place lands it in the target day — no modal, no
navigation.

**5. Drag-and-drop, layered.** Tap-to-target is the primary mechanism because it
is the only one that works reliably on a phone. Drag-and-drop is layered on top
for desktop. Both require a keyboard-accessible path (move up / move down
controls on each block), which also serves as the accessible fallback.

**6. Time-blocked days that reflow.** Adopted from the prototype's `timeline()`:
each block carries a start and a duration; ±15m controls adjust duration; later
blocks push automatically and are marked as pushed. A day-load readout
(`9h 40m planned · 2 gaps`) makes an overstuffed day visible while it is being
built.

**7. Off-map places.** A hand-typed place with no coordinates still receives
days, nights, and budget, flagged "no map pin" until a location is attached.
Without this, thin catalog coverage in a new country is a hard blocker rather
than a soft one.

---

## 4. Visual system

### 4.1 Tokens

One set of semantic CSS custom properties, so a theme change is a token swap and
nothing re-renders structurally.

```
--ink-0 … --ink-4      text ramp, strongest to faintest
--line-1 … --line-2    borders
--surf-1 … --surf-2    panel fills
--paper --raise --scrim  base, elevated, and overlay surfaces
--accent-ink           country colour as TEXT on paper   (see §4.2)
--accent-fill          country colour as FILL behind ink (see §4.2)
```

Light and dark redefine only the ramp. The existing `@theme` block in
`app/globals.css` supplies the light values.

### 4.2 Accent derivation

The prototype hand-picks a hex per country. That approach fails at ~195
countries and is rejected.

Accent resolves through three layers, in order:

1. **User override** (§4.3) — a per-user, per-country hue.
2. **Curated override** — a small hand-tuned table. China keeps a deliberately
   chosen hue.
3. **Derived** — the default for every country nobody has touched.

**Only hue varies. Lightness and chroma are pinned at every layer**, including
user-chosen ones, which is what makes the contrast guarantee hold regardless of
who picked what.

**Derivation uses golden-angle spacing over the ISO list, not a plain hash.**
`hue = (index in ISO 3166-1 alpha-2 × 137.508°) mod 360`. A naive
`hash(iso2) → hue` was specified first and measured badly — it put **CN at 324°,
TH at 321° and VN at 325°**, three countries that routinely appear in the same
trip list rendering as the same pink, and **IT at 48° beside FR at 49°**. Golden
angle guarantees consecutive indices land far apart. The ISO list is a stable
standard, so adding a country never reshuffles the countries already assigned.

**Lightness is pinned per role, not per theme.** An earlier draft of this spec
specified a single `oklch(58% 0.15 H)` for light theme and claimed it passed
contrast "without inspection". That was wrong, and the arithmetic is worth
recording so it is not reintroduced: WCAG contrast derives from sRGB relative
luminance, and for near-neutrals `Y ≈ L³`. At L 58%, `Y ≈ 0.195`, giving
**4.29:1 against white paper — below the 4.5:1 AA threshold before hue variation
is considered at all.** The same value used as a fill behind dark ink gives
≈3.5:1, also failing.

One lightness cannot serve both roles. The token set therefore carries two:

| Token | Role | Light theme | Dark theme |
|---|---|---|---|
| `--accent-ink` | accent **as text** on paper | `oklch(50% C H)` (≈6:1 on white) | `oklch(80% C H)` |
| `--accent-fill` | accent **as fill** behind dark ink | `oklch(72% C H)` | `oklch(80% C H)` |

**Chroma is clamped to the sRGB gamut maximum across all hues at the chosen
lightness (~0.12), not set to 0.15.** Above that, yellow-greens fall outside
sRGB and browsers gamut-map by reducing chroma — which preserves contrast but
makes adjacent countries render at visibly different saturation, undermining the
consistency the derivation exists to provide.

The correct framing of the guarantee: pinning L and C per role makes the §9
contrast test pass **by construction**. The test is the guarantee; the
derivation is what makes the test cheap to satisfy.

The prototype needs a `darken()` helper precisely because its neon hexes are
illegible on light backgrounds. Role-pinned lightness removes the need for that
patch — but not the need to verify it.

### 4.3 Toggles

- **Theme:** Light (default) · Dark · System
- **Accent mode:** "Per country" (default) or one fixed accent applied
  everywhere
- **Per-country hue:** in "per country" mode, any country's hue can be
  overridden individually

**The per-country picker offers a hue wheel, never a freeform colour field.**
A raw colour input lets someone choose `#FFFF00`, which is illegible on paper
and defeats §4.2 entirely. Restricting the choice to hue keeps lightness and
chroma pinned, so **every selection a user can physically make is legible in
both themes.** Expressive control is preserved; the failure mode is removed.

**Overrides are per user, not per trip.** Members of a shared trip may each see
their own colours. This keeps the data in the prefs record already required
above, with no shared-state conflict resolution — at the cost that "the pink
trip" is not a phrase two members can reliably exchange. Trip-level colour is a
deliberate non-goal.

Overrides are sparse: a map of ISO code to hue holding only what the user has
actually changed. An untouched country falls through to the curated table, then
to derivation, so a country seen for the first time always renders correctly
without anyone configuring it.

Both persist per user. Theme must be applied before first paint to avoid a
flash.

There is no user-preferences storage today — neither store backend has a prefs
table and there is no prefs endpoint. This is small but real work and belongs to
PR1 step 1: a prefs table in both backends, a read/write endpoint, and a cookie
plus inline script so the first paint is correct rather than corrected.

### 4.4 Country imagery

Source is Wikidata P18 → Wikimedia Commons — the pipeline that already fills
`CatalogCity.image` and `CatalogAttraction.image`. No new dependency, no API
key. Used as a hero band behind the trip header and on country cards in the
picker.

Three rules, because photographic backgrounds are where contrast usually breaks:

- A **scrim gradient always sits between photo and text**, so contrast holds
  regardless of which image is returned.
- An **accent-gradient fallback** renders whenever no image exists. Across all
  countries many will have none, and that path must look intentional.
- **Commons attribution** renders as a small credit line, as the licences
  require.

### 4.5 Identity

Ticket motifs — perforated edges, monospace codes, stamp shapes — are retained
as country-agnostic chrome, because they signify *travel* rather than China.

The 同行 chop and the kai font stop being global furniture and become a
China-specific flourish supplied by country data (`Country.mark`). Japan then
receives its own mark rather than inheriting a Chinese one.

---

## 5. Data model

### 5.1 Type changes

```ts
// Destination
- chineseName: string
+ localName: string | null
- region: Region              // China-only union
+ country: CountryCode        // ISO 3166-1 alpha-2
+ region: string              // free-form, meaningful within its country

// New
interface Country {
  code: CountryCode;
  name: string;
  localName: string | null;
  hemisphere: "north" | "south";
  accent?: string;   // curated override; omitted means derive
  image?: string;    // Wikimedia Commons hero
  mark?: string;     // cultural glyph, e.g. 同行 for CN
}
```

`CatalogCity` gains `country`; its `province` field generalises to `adminArea`.

### 5.2 The CountryProfile seam

`seasonOfMonth`, `NATIONAL_CROWD`, `lib/packing.ts`, and `lib/itinerary.ts`
currently bake China in. Notably `seasonOfMonth` (`lib/months.ts:29`) is
hardcoded northern-hemisphere — March–May is spring unconditionally, which is
wrong for Australia or Peru and feeds the itinerary generator.

Move these behind an interface:

A four-field interface is not enough. Review against the code found the
coupling is both wider and deeper:

- **Transport is China's HSR.** `RAIL_KMH = 230` and
  `FLIGHT_THRESHOLD_KM = 1200` (`lib/route.ts:27-32`) encode a dense
  high-speed-rail network; "rail at 230 km/h" is fiction in most countries.
  Booking copy names 12306 and Trip.com (`:115`).
- **Generated copy is China's, and it is persisted.** `GENERAL_TIPS` names
  Alipay, VPN, 12306 and Amap (`lib/itinerary.ts:47-53`); travel items read
  "High-speed rail or flight to X … passport needed to board" (`:171-176`).
  These are snapshotted into `TripData` at creation, so they are a
  generation-time concern, not a render-time one.
- **Packing is a China document, not a rule set.** `lib/packing.ts:50-77`
  hardcodes RMB cash, Alipay/WeChat, VPN, plug types, and non-potable tap water,
  with `BEACH_DESTINATIONS` as a set of Chinese destination ids (`:36`) and a
  Harbin cold-weather special case (`:40-44`). Destination-id checks must become
  attributes (`hasBeach`, `severeWinter`).
- **Climate has no profile analogue.** `REGION_MONTHS` is
  `Record<Region, …>` (`lib/months.ts:116`) and is the fallback month-fit for
  every non-curated place. An unknown region key throws rather than degrades.
- **`Season` itself is temperate-biased** (`lib/types.ts:1`). Wet/dry tropical
  countries do not map onto four temperate seasons.

```ts
interface CountryProfile {
  seasonOfMonth(month: number): Season;   // hemisphere-aware
  crowdByMonth: number[];
  holidays: HolidayBand[];
  packing: PackingDocument;               // whole document, not deltas
  transport: TransportProfile;            // modes, speeds, thresholds, booking copy
  tips: string[];                         // generation-time, persisted
  climateFor(region: string): RegionMonthClimate[] | null;  // null degrades, never throws
  currency: CurrencyCode;                 // conversion pivot — see §5.5
}
```

**Trip-level season is the deepest coupling and needs an explicit decision.**
`TripInput.season` is a single `Season` for a whole trip
(`lib/itinerary.ts:7`), derived client-side through the hardcoded northern
`seasonOfMonth` at `app/plan/page.tsx:162`, then persisted. A hemisphere-aware
profile changes nothing while derivation stays on the client. **Resolution:
season derivation moves server-side behind the profile.** Per-destination season
— which a Peru + Mexico trip genuinely needs — is acknowledged as a limitation
and deferred; a single trip-level season resolved through the right country's
profile is correct for single-country trips, which is every trip today.

China ships as the one fully populated profile. Every other country falls back
to a neutral default: hemisphere from latitude, flat crowd curve, generic
packing, no climate rows (rendering unfit-unknown rather than throwing). This
fixes the hemisphere bug structurally and reduces "add Japan" to authoring a
profile file.

### 5.3 The time-block data model

§3.2.6 specifies time-blocked days with durations and reflow. The persisted
model does not support that today: `ScheduledItem` carries
`slot: morning | afternoon | evening` plus an optional `time` string
(`lib/itinerary.ts:15-27`), and the accepted mutations — `addItem`,
`updateItem`, `removeItem`, `moveItem`, `addDay` (`lib/server/schemas.ts:60-86`)
— have no duration or start-time semantics. **As specified, the day builder's
core interaction cannot be saved.**

Required, and in scope:

- `ScheduledItem` gains `startMinutes: number | null` and
  `durationMinutes: number | null`. Both nullable, because legacy items have
  neither.
- `PlanOp` gains a `setTiming` operation; `addItem`/`updateItem` accept the new
  fields.
- **Legacy items render in slot lanes.** An item with null timing is placed in
  its slot's band and shown as untimed rather than assigned a fabricated start.
  Assigning invented times to existing trips would be a silent data change.
- Reflow only pushes items that have timing. Untimed items never move.

### 5.4 Migration

Existing trips carry destination ids with no country.

**There is no bulk backfill.** An earlier draft specified one; it was both
unsafe and unnecessary.

*Unnecessary:* nothing persisted carries country-shaped data. `trips.data` is a
`TripData` JSON blob holding `input.destinationIds` as bare strings; destination
objects are resolved at read time (`lib/briefing.ts:85-87`). A read-boundary
default is exactly equivalent to a rewrite.

*Unsafe:* the only unguarded write path is `updateTripData`
(`lib/server/tripStore.ts:200`), which has no version check — the guarded
variant is `updateTripDataIf` (`:214`). A migration reading a trip and writing
through the unguarded path would silently clobber any member edit landing
concurrently through the version-guarded plan route. That is precisely the
member-owned-edit loss this project's ownership model forbids. There is also no
migration runner in either backend, and `touch()` bumps `version` on every
write, so a fleet-wide rewrite would churn every polling client.

**The approach instead:** `country` defaults to `"CN"` at the read boundary via
a zod default when the field is absent, and is written through on the next
natural write. Bulk rewrites through `updateTripData` are forbidden.

### 5.5 Currency pivot

`lib/money.ts:41` hardcodes CNY as the conversion pivot, and
`CurrencySettings.rates` is documented as "CNY per 1 unit"
(`lib/tripShared.ts:102`) — a semantic baked into persisted trip data. A Japan
trip would show totals labelled CNY on day one.

§1 lists expense-splitting logic as a non-goal and that stands: the *split*
arithmetic is unchanged. But the **pivot** moves from a hardcoded constant to
`CountryProfile.currency`. Because rate semantics are persisted, existing trips
keep CNY-relative rates and are read with an explicit pivot of `"CNY"` rather
than being reinterpreted. New trips record their pivot alongside the rates.

### 5.6 Off-map places

§3.2.7 requires places without coordinates. `Destination.lat/lon` are currently
required numbers (`lib/types.ts:48-50`) and `RoutePlace extends LatLon`, so
`suggestRoute` and `estimateLeg` assume coordinates on every place
(`lib/route.ts:3-6,38-45`).

- `lat`/`lon` become `number | null`.
- A route leg with a coordinate-less endpoint yields no distance or duration
  estimate and renders as an untimed transfer rather than a fabricated one.
- Off-map places take a default `suggestedDays` of `[1, 2]` so the feasibility
  counter in §3.2.3 still has an input.

---

## 6. Maps

`d3-geo` and `topojson-client` are already dependencies, and `ChinaMap` already
renders TopoJSON through `geoMercator` + `geoPath` from
`public/china-provinces.json`. The world map reuses this pipeline exactly.

- Add `public/world-countries.json` — **Natural Earth 50m**, public domain,
  keyed by ISO code. No new dependencies.

  Not 110m. At 110m resolution, city-states and small islands are absent or
  sub-pixel — Singapore, Malta, Maldives, Bahrain among them, which are prime
  travel destinations, and Hong Kong and Macau are not ISO-coded features at
  all. 50m plus a point-feature layer for countries below an area threshold
  keeps them selectable. **Search remains the guaranteed path to every
  country**; the map is a discovery affordance, never the only route to a
  selection.
- `ChinaMap` generalises to a two-level component:
  - **World level** — countries as selectable features, tinted by their accent.
  - **Country level** — the existing province/city behaviour. China is the only
    country with a populated detail level; others fall back to list + search
    within the same shell.
- Projection, zoom, and hover machinery are shared between levels.

Loaded lazily — the world topology is only fetched when the picker opens.

---

## 7. Mobile contract

Mobile layouts and offline support are a separate spec, scheduled to follow this
one. Its agreed scope is full: responsive layouts throughout, a four-item bottom
bar, a bottom-sheet day builder, touch maps, card layouts below `sm`, camera
capture, polling backoff, and **offline Kit** — tickets and packing readable
with no signal.

Because that spec is written after this work is built, this section records the
constraints the desktop build must honour so mobile is an addition rather than a
retrofit. Each is cheap now and expensive later.

**C1 — One nav source.** The rail and the bottom bar render from a single nav
configuration, not two hardcoded lists. Adding or reordering an item must be a
one-place change.

**C2 — No `position: fixed` bottom elements outside the shell.** The wizard
footer at `app/plan/page.tsx:183` is resolved as part of this work, not
deferred: the shell owns the bottom edge. Two pinned bottom elements cannot
coexist.

**C3 — Layout-independent builder state.** The day builder's state — shelf
contents, target day, block ordering and reflow — lives in a hook with no layout
knowledge. The desktop split-pane and the mobile bottom sheet are then two views
over one state machine rather than two implementations.

**C4 — One trip-payload accessor.** All reads of the trip payload route through
a single accessor. A cache layer can then be inserted beneath it without
touching components. Components must not call `fetch` for trip data directly.

**C5 — Safe-area and touch-target tokens exist from the start.**
`env(safe-area-inset-*)` and a minimum 44px interactive target are part of the
token set in §4.1, applied even where desktop does not need them.

**C6 — Server-driven trip payload stays serialisable.** No non-serialisable
state in the payload, so it can be persisted to a cache and rehydrated
unchanged.

**C7 — Nav labels stay short.** Every rail label must fit a bottom-bar tab at
375px. This is the constraint that keeps the four-item collapse from eroding.

## 8. Module boundaries

Each unit below has one purpose, a defined interface, and can be tested
independently.

| Module | Purpose | Depends on |
|---|---|---|
| `lib/countries` | Country records, ISO codes, curated overrides | — |
| `lib/accent` | `hash(iso2) → OKLCH accent`, per theme | `lib/countries` |
| `lib/countryProfile` | Season/crowd/holiday/packing per country | `lib/countries` |
| `components/shell/AppShell` | Rail, header, theme + accent providers | `lib/accent` |
| `components/plan/PlaceSearch` | Merged curated + catalog search | catalog API |
| `components/plan/DayBuilder` | Shelf, target day, blocks, reflow | `lib/itinerary` |
| `components/map/WorldMap` | Country-level TopoJSON picker | `d3-geo` |
| `components/map/CountryMap` | Region/city level (China populated) | `d3-geo` |

`lib/accent` and `lib/countryProfile` are pure and directly unit-testable, which
is where the highest-risk logic lives.

---

## 9. Testing

- **Unit:** accent derivation (contrast bounds hold across all 195 ISO codes in
  both themes); `seasonOfMonth` for both hemispheres; timeline reflow and push
  marking; feasibility arithmetic.
- **Integration:** wizard reorder preserves state across steps; the CN backfill
  leaves member edits untouched; catalog search merge ranks curated first.
- **Visual:** light and dark at 375 / 768 / 1440; the imagery scrim holds
  contrast against both a light and a dark photograph; the no-image fallback.
- **Accessibility:** the four rail items are keyboard reachable; drag-and-drop
  has a keyboard equivalent; contrast meets AA in both themes.

Coverage target 80%, per project standard.

Contract checks from §7 are asserted here too, since they are the cheap failures
to catch early: one nav source (C1), no fixed bottom element outside the shell
(C2), builder state importable without any layout component (C3), and no direct
trip-data `fetch` outside the accessor (C4).

---

## 10. Build order

Delivered as **three** pull requests, not two. An earlier draft claimed the
foundation work was "independent of the UI work"; that was wrong. Renaming
`Destination.chineseName` touches 17 files, and replacing the `Region` union
breaks `REGION_MONTHS` (`lib/months.ts:116`, a `Record<Region, …>`),
`provinceByAdcode`, `fitForRegion`, and `ChinaMap`'s `zoomRegion` prop — the
exact components PR2 exists to rewrite. Foundation-with-removals cannot
typecheck without dragging UI work into PR1.

The cut line that does work is **additive first, removals last.**

### PR1 — Foundations (strictly additive; old UI untouched and green)

1. Token set added **alongside** the existing `@theme` block; theme and accent
   providers wired; the theme toggle ships light-only or hidden, because the old
   components use fixed light palette utilities and `ChinaMap` hardcodes hex
   literals in its SVG. A dark toggle over the old UI would restyle half of it.
2. `lib/countries`, `lib/accent` (role-pinned lightness, gamut-clamped chroma),
   `lib/countryProfile` with China populated and a neutral default — plus tests.
   Pure modules, no UI dependency.
3. Additive type changes only: `country` optional with a read-boundary `"CN"`
   default; `localName` added *alongside* `chineseName`; `lat`/`lon` widened to
   nullable. The `Region` union stays, mechanically aliased to `ChinaRegion`.
4. **Extract the trip-payload accessor** (contract C4), absorbing the polling,
   out-of-order guard, version-monotonic apply and optimistic-update logic that
   currently lives in `TripView`. This must land before the tab collapse, not
   as a side effect of it.
5. `ScheduledItem` timing fields and the `setTiming` `PlanOp` per §5.3 — added,
   nullable, not yet used by any UI.

### PR2 — Redesign

6. App shell — rail, header, trip switcher, crew, Share
7. Trip page — collapse 7 tabs into Plan / Today / Money / Kit
8. Planner — wizard reorder, merged search, feasibility counter
9. Day builder — shelf, target day, reflow, drag layer
10. World map + country map generalisation
11. Country imagery with scrim and fallback

Consumers migrate to `localName` and `country` here. Steps 6–9 each carry a §7
contract: the shell establishes the single nav source and takes ownership of the
bottom edge, the planner removes the pinned wizard footer, and the day builder
separates state from layout.

### PR3 — Cleanup

12. Delete `chineseName`, retire the `Region` union, remove the superseded
    `@theme` block, enable the dark toggle.

Only safe once PR2 has replaced every consumer. Keeping it separate is what
lets PR1 and PR2 each land green.

---

## 11. Open risks

- **The catalog pipeline is China-scoped at the Wikidata class level, not just
  by a country filter.** This is the most significant constraint on the
  all-countries ambition and it is not solved by this spec.
  `scripts/ingest-destinations.mjs` enumerates *PRC-specific administrative
  classes* (direct-administered municipality, sub-provincial, prefecture-level,
  county-level) and *Chinese tourism rating classes* (AAAAA/AAAA), and its
  sanity checks hard-fail unless Beijing, Shanghai, Chengdu and the Forbidden
  City appear, within a 300–700 city band. There is no universal "city class" on
  Wikidata — **every new country needs its own class research, its own quality
  sources, and its own expected-record ranges.** "Adding a country is data, not
  a release" is true of the *app*; it is not yet true of the *pipeline*. Making
  it true is its own piece of work and should be specced separately before the
  second country is attempted.
- **Catalog coverage outside China is unknown.** The off-map place mechanism is
  the mitigation, but the first non-China trip will expose how thin it is.
- **Generated trip content is snapshotted, not rendered.** Tips, travel-item
  titles and packing lists are written into `TripData` at creation. Existing
  trips keep their China-specific text permanently, and country context must be
  applied at *generation* time — theming the render layer will not reach it.
- **Timezone is assumed UTC+8.** `lib/tracker.ts:48` computes "today" from the
  device clock, with a comment noting the whole party is assumed to be in
  China's timezone. The day tracker will roll over at the wrong hour abroad.
  Out of scope here; recorded so it is not mistaken for a regression later.
- **Natural Earth ISO codes need reconciling** with the catalog's country codes;
  disputed and small territories are the usual source of mismatch.
- **Wikimedia image quality is uneven.** Some country P18 images are maps or
  flags rather than scenery. A curated override per country is the escape hatch.
- **Mobile is specified after it is partly built.** The §7 contract is the
  mitigation, but a contract is a prediction. The likeliest miss is the day
  builder: if its state and layout are not cleanly separated, the mobile bottom
  sheet becomes a rewrite rather than a second view. C3 is the constraint most
  worth enforcing in review.
- **Offline Kit interacts with auth.** A session expiring while offline has no
  defined behaviour today. That decision belongs to the mobile spec, but it
  constrains this one: the trip payload must remain serialisable and cacheable
  (C6), which rules out embedding live session objects in it.
