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
--accent --accent-ink  country colour; --accent-ink is the text-safe variant
```

Light and dark redefine only the ramp. The existing `@theme` block in
`app/globals.css` supplies the light values.

### 4.2 Accent derivation

The prototype hand-picks a hex per country. That approach fails at ~195
countries and is rejected.

- A small **curated override table** for countries that warrant hand-tuning.
  China keeps a deliberately chosen accent.
- Everything else derives: `hash(iso2) → hue`, rendered in **OKLCH at pinned
  lightness and chroma** — `oklch(58% 0.15 H)` for light, `oklch(80% 0.18 H)`
  for dark.

Pinning L and C means every generated accent passes contrast in both themes
without inspection. The prototype needs a `darken()` helper precisely because
its neon hexes are illegible on light backgrounds; pinning lightness removes the
need for that patch entirely.

### 4.3 Toggles

- **Theme:** Light (default) · Dark · System
- **Accent:** "Per country" (default) or a fixed override, so a user who
  dislikes a generated hue can replace it

Both persist per user. Theme must be applied before first paint to avoid a
flash.

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

```ts
interface CountryProfile {
  seasonOfMonth(month: number): Season;  // hemisphere-aware
  crowdByMonth: number[];
  holidays: HolidayBand[];
  packingRules: PackingRule[];
}
```

China ships as the one fully populated profile. Every other country falls back
to a neutral default deriving hemisphere from latitude, a flat crowd curve, and
generic packing rules. This fixes the hemisphere bug structurally rather than
patching it, and reduces "add Japan" to authoring a profile file.

### 5.3 Migration

Existing trips carry destination ids with no country. Backfill `country: "CN"`.
The backfill is additive and must not touch member-owned plan edits — generated
plans are drafts that members own, and a schema migration is not a rebuild.

---

## 6. Maps

`d3-geo` and `topojson-client` are already dependencies, and `ChinaMap` already
renders TopoJSON through `geoMercator` + `geoPath` from
`public/china-provinces.json`. The world map reuses this pipeline exactly.

- Add `public/world-countries.json` — Natural Earth 110m, public domain, keyed
  by ISO code. No new dependencies.
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

1. Token system + theme/accent providers and toggles (unblocks everything visual)
2. `lib/countries`, `lib/accent`, `lib/countryProfile` + tests
3. Type changes and CN backfill migration
4. App shell — rail, header, trip switcher, crew, Share
5. Trip page — collapse 7 tabs into Plan / Today / Money / Kit
6. Planner — wizard reorder, merged search, feasibility counter
7. Day builder — shelf, target day, reflow, drag layer
8. World map + country map generalisation
9. Country imagery with scrim and fallback

Steps 1–3 are independent of the UI work and can proceed in parallel with
nothing blocked behind them.

Steps 4–7 each carry their §7 contract: the shell establishes the single nav
source and takes ownership of the bottom edge, the planner removes the pinned
wizard footer, and the day builder separates state from layout.

---

## 11. Open risks

- **Catalog coverage outside China is unknown.** The off-map place mechanism is
  the mitigation, but the first non-China trip will expose how thin it is.
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
