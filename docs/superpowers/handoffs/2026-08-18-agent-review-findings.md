# Agent code review — confirmed findings

**Date:** 2026-08-18
**Reviewing:** commits 2843dd1, 595d0be, db3ffab, 8183a35 — the code nine agents
wrote for PR2 Tasks 25-33.

Five reviewers with distinct lenses (drag correctness, map cutover, imagery
licensing, token sweep, cross-task integration), every finding put through an
adversarial refutation round. 9 survived. Two were found independently by two
reviewers each, which is the strongest signal in the set.

**Fixed already** (commit 59c88bf): the two HIGH country findings — the wizard's
picked country never reaching the write boundary, and catalog search not being
country-scoped.

**Everything below is still open.**

## HIGH — app/plan/page.tsx:158

Task 29 added a country picker whose choice never leaves DestinationStep (local `useState("CN")` at DestinationStep.tsx:53, threaded only to MapExplorer and PlaceSearch), so `app/plan/page.tsx:157-160` builds `tripInput` without `country` and every wizard-created trip is stored with the schema default "CN" (lib/server/schemas.ts:35). Two consequences follow: (1) the season is derived with China's hemisphere — app/api/trips/route.ts:37 calls `resolveTripSeason(input.season, month, input.country)` → `getCountryProfile("CN").seasonOfMonth(1)` → "winter" for a January Australian trip, the exact northern-hemisphere bug Task 20's country profile was built to fix; (2) `tripCountry(data)` is "CN" forever, so the per-country accent (TripAccentProvider → PrefsProvider) and the CountryHero image (TripView.tsx:198) are always China's. NOT consequences, contrary to the original claim: packing, crowd bands, transport copy and currency are China's regardless of this field, since `getCountryProfile` is imported nowhere outside lib/tripSeason.ts; and the trip name defaults to `${firstDestinationName} trip` (PlanStep.tsx:193), e.g. "Sydney trip" — "China trip" is only the empty-input fallback at line 208.

**Failure scenario:** Open the world picker, select Australia, add Sydney via search, pick January on the month timeline, create the trip. The POST omits `input.country`, the schema defaults it to "CN", and `resolveTripSeason` calls `getCountryProfile("CN").seasonOfMonth(1)` → "winter" for a January Australian trip (the exact northern-hemisphere bug `country` + `getCountryProfile` were built to fix). The saved trip's `tripCountry(data)` is "CN", so packing, crowd bands, transport copy, currency and the per-country accent are all China's, and the trip name defaults to "China trip".

**Evidence:** app/plan/page.tsx:157-160 — `const tripInput = useMemo<TripInput>(
    () => ({ destinationIds: selected, days, season, adults, kids, interests }),
    [selected, days, season, adults, kids, interests]
  );` (no `country`). PlanStep posts it verbatim: `body: JSON.stringify({ tripName: tripName.trim() || "China trip", startDate: startDate || null, input, ...(month ? { month } : {}) })`. The server then defaults it: lib/server/schemas.ts:35 `country: CountryCodeSchema.default("CN"),` and app/api/trips/route.ts:37 `const season = resolveTripSeason(input.season, month, input.country);`, where lib/tripSeason.ts:27 is `return getCountryProfile(country).seasonOfMonth(month);`. DestinationStep.tsx:53 holds the choice as local state only: `const [country, setCountry] = useState("CN");` — it is passed to MapExplorer and PlaceSearch and nowhere else.

**Suggested fix:** Lift the wizard's `country` state into `app/plan/page.tsx` (or have `DestinationStep` report changes upward) and include it in `tripInput`: `() => ({ destinationIds: selected, days, season, adults, kids, interests, country })`. Also derive the default trip name from the country rather than hardcoding "China trip".

---

## HIGH — components/plan/PlaceSearch.tsx:70

The catalog leg of merged place search is not scoped by country: PlaceSearch.tsx:70 fetches `/api/destinations?q=` with no country parameter, `rankPlaces` (lib/placeSearch.ts) has no country notion, and app/api/destinations/route.ts:15 searches the China-only catalog (data/catalog.json: 695 cities, no country field). So while the destination step is scoped to another country — the picker reads "planning in Japan", the curated grid says "No cards for Japan yet — search above", and CountryMap says "No map for Japan yet — search above to add places" — the search box still offers Chinese cities and Enter adds them, contradicting the scoping contract documented at CountryMap.tsx:102-104, CountryMap.tsx:127 and DestinationStep.tsx:48-52. The sibling map leg is scoped (MapExplorer.tsx:93-102 skips /api/map/cities unless hasDetailLevel(country)), so search is the only leg that leaks. Two corrections to the reported scenario: Beijing/Q956 cannot appear — lib/server/catalog.ts:142 filters the 16 CURATED_NAMES out of searchCities, and "beij" returns [] against the real catalog; reproducing cases are "nanj" → Nanjing (Q16666) and "wuh" → Wuhan (Q11746). And no non-CN trip is actually created — PlanStep.tsx:204 never sends `country` and CreateTripSchema defaults to "CN" — so the damage is the in-wizard contradiction plus a Chinese catalog city resolving into the generated plan, not a corrupted Japan trip. That makes this closer to medium than high severity.

**Failure scenario:** Pick Japan in the world map. The country level correctly shows "No map for Japan yet — search above to add places". Type "beij" in that search box: the catalog returns Beijing, the row ranks as a normal catalog hit, and Enter calls `addPlace` → `onAddCatalog({ qid: "Q956", … })`, adding a Chinese city to a Japan trip with no warning.

**Evidence:** components/plan/PlaceSearch.tsx:70 — `const res = await fetch(`/api/destinations?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });` — no country parameter, and `hits` is passed straight into `rankPlaces` with no country filter (lib/placeSearch.ts has no `country` at all). The route is unscoped too: app/api/destinations/route.ts returns `results: q.trim().length >= 2 ? searchCities(q) : []`, over a catalog lib/server/catalog.ts:45 calls "the full all-China dataset" (695 cities, all Chinese). Meanwhile CountryMap.tsx:102-104 claims "Search — the input the destination step keeps above this pane, scoped to the same country — is the guaranteed path to every place"; CountryMap.tsx:127 tells the user to "search above for anywhere else in ${label}"; DestinationStep.tsx:49-51 says "search is scoped by it too … both have to agree on which one is open". Only the curated leg is actually scoped (DestinationStep.tsx:249 `curated={countryDestinations…}`).

**Suggested fix:** Skip the catalog fetch and drop `hits` when the active country is not the catalog's country: in the debounce effect, bail to `setHits([])` unless `country` normalises to "CN" (the same predicate `hasDetailLevel` already encodes), until a multi-country catalog exists.

---

## MEDIUM — components/map/WorldMap.tsx:66

The small-country point layer is the only pointer target for 76 countries (their polygons render with pointer-events-none and aria-hidden, WorldMap.tsx:393-402), and its hit area is well under the 44px minimum the layer's own build script cites as its reason for existing. POINT_HIT_R = 9 in a viewBox 860 units wide on an SVG sized h-auto w-full: on /plan (app/plan/page.tsx:210 max-w-6xl px-4, minus MapExplorer's card sm:p-5) the SVG renders ~1080 CSS px, scale 1.256, so the hit circle is ~22.6 CSS px across — below WCAG 2.2 AA 2.5.8's 24px and about half of --tap-min (app/globals.css:44). At a 375px viewport the same circle is ~6.5 px across, making Singapore, Malta, Qatar, Cyprus, Luxembourg and Hong Kong a near-miss by default. WCAG's "Equivalent" exception does not apply: MapExplorer.tsx:238 points the user at the search above, but PlaceSearch is scoped to the already-chosen country (components/plan/PlaceSearch.tsx:28, 123) and cannot change it, so the map is the only country-selection surface.

Two corrections to the original finding. (1) The remedy is not simply a larger POINT_HIT_R. Reaching 44 CSS px needs r ≈ 17.5 viewBox units, but San Marino and Vatican City sit ~6 units apart at this fit (and the Caribbean cluster is tighter), so 35-unit-wide circles would swallow neighbours and make the wrong country selectable — breaking the invariant stated at WorldMap.tsx:45. At the current r=9 those micro-state circles already overlap. The real fix is a different interaction: zoom-to-cluster, or a country list/search that can actually change the planned country. (2) All 76 remain keyboard-reachable via the roving tabindex (lines 229-241), so this is a pointer-target defect, not total inaccessibility.

**Failure scenario:** On /plan (max-w-6xl = 1152px, minus px-4 and the card's sm:p-5) the SVG renders ~1078 px wide, scale 1078/860 = 1.254, so the hit circle is 2 × 9 × 1.254 ≈ 22.6 CSS px across — under WCAG 2.2 AA 2.5.8's 24 px and half of `--tap-min`. At a 375 px viewport the same circle is ≈ 6.5 px across, so tapping Singapore, Malta, Qatar, Cyprus, Luxembourg or Hong Kong is a near-miss by default.

**Evidence:** components/map/WorldMap.tsx:64-66 — `const POINT_R = 4.5;` / `/** Transparent hit circle: the visible dot is smaller than a usable target. */` / `const POINT_HIT_R = 9;`, drawn at `<circle cx={point.x} cy={point.y} r={POINT_HIT_R} fill="transparent" />` inside a viewBox of `MAP_VIEW_W = 860` (mapShared.ts:19) on an SVG sized `className="h-auto w-full"`. Those countries' polygons are deliberately dead: `interactive: !pointCodes.has(f.id)` and the non-interactive branch renders `className="pointer-events-none" aria-hidden`. scripts/build-world-topology.mjs:61-69 justifies the layer with "well under the 44px tap minimum, so the polygon alone is not a target", and app/globals.css:44 defines `--tap-min: 44px` (spec C5: "a minimum 44px interactive target … applied even where desktop does not need them").

**Suggested fix:** Size the hit circle from the token rather than a magic number: pick `POINT_HIT_R` so `2 · r · (renderedWidth / MAP_VIEW_W) ≥ 44` at the narrowest supported width (i.e. r ≈ 60 viewBox units at 375 px), or give each point a fixed-pixel hit target outside the scaled SVG. If overlapping hit areas become the constraint, keep the small country's polygon interactive as well — the build script's contract is "a point *in addition to* their polygon", not instead of it.

---

## MEDIUM — components/shell/CountryHero.tsx:72

CountryHero reimplements the accent override instead of routing through the precedence lib/prefs.ts owns, so "one hue everywhere" is silently ignored by the accent-gradient hero (spec §4.4). With prefs `{ accent: 210, accentHues: { JP: 300 } }` on a JP trip (JP has no entry in data/country-images.json and CURATED_HEROES is empty, so the gradient path runs), CountryHero.tsx:72 passes 300 to pickHero and the band paints `linear-gradient(135deg, oklch(72% 0.115 300), oklch(50% 0.08 300))`, while resolveAccentVars short-circuits on the fixed accent and sets `--accent-ink: oklch(50% 0.08 210)`. With `{ accent: 210, accentHues: {} }` the band paints JP's derived hue instead. Note the band itself does not show two hues: the gradient div is opaque, `inset-0` and `-z-10` inside a `relative isolate` parent, so it paints over TripView.tsx:200's `color-mix(in oklab, var(--accent-ink) 85%, var(--ink-0))` ground, which is only visible as the image-load fallback. The visible defect is that the hero band disagrees with every other accent surface on the same page (e.g. TripView.tsx:235's tab pills on `var(--accent-ink)`), and the fixed hue the user explicitly chose is the one the hero ignores. In `accent: "country"` mode the two agree, because TripAccentProvider.tsx:29 now feeds tripCountry(data) into PrefsProvider.

**Failure scenario:** Prefs are `{ accent: 210, accentHues: { JP: 300 } }` and the user opens a JP trip (JP has no entry in data/country-images.json, so the gradient path runs). PrefsProvider calls resolveAccentVars, which short-circuits on the fixed accent and sets `--accent-ink: oklch(50% 0.08 210)`. TripView.tsx:199 grounds the band in `bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))]` — hue 210. But CountryHero passes `prefs.accentHues["JP"]` = 300 to pickHero, so the gradient painted over that ground is `linear-gradient(135deg, oklch(72% 0.115 300), oklch(50% 0.08 300))` — hue 300. The band shows two unrelated hues, and the fixed accent the user explicitly chose is ignored by exactly the surface spec §4.4 calls the accent-gradient fallback. The same disagreement occurs with `{ accent: 210, accentHues: {} }`: tokens at 210, gradient at the country's derived hue.

**Evidence:** components/shell/CountryHero.tsx:72 — `const hero = pickHero(country, { theme, accentHue: prefs.accentHues[country.code] });`

versus the module that owns the precedence, lib/prefs.ts:124-130:
```
export function resolveAccentVars(prefs, countryCode, theme) {
  const code = countryCode.trim().toUpperCase();
  const override = typeof prefs.accent === "number" ? prefs.accent : prefs.accentHues[code];
```
whose docblock (lib/prefs.ts:115-119) states: "Precedence is not reimplemented here. A fixed accent short-circuits to its own hue... Fixed mode ignores accentHues by construction — 'one accent everywhere' and 'this country is different' cannot both be honoured, and the explicit choice wins."

`prefs.accent` is a live user setting: `accent: isHue(raw.accent) ? raw.accent : "country"` (lib/prefs.ts:56).

**Suggested fix:** Do not resolve precedence in the component. Export the resolver from lib/prefs.ts (e.g. `export const resolveAccentOverride = (prefs: UserPrefs, code: string) => typeof prefs.accent === "number" ? prefs.accent : prefs.accentHues[code];`), use it inside resolveAccentVars, and call it from CountryHero: `pickHero(country, { theme, accentHue: resolveAccentOverride(prefs, country.code) })`.

---

## LOW — data/country-images.json:56

Nothing bounds the length of `artist` at the ingest (scripts/ingest-country-images.mjs:241) or at the validating boundary (lib/countryImagery.ts:70-74, where `text()` only trims), and data/country-images.json:56 commits a 984-character value for `ID` — 18x the next-longest artist in the file. components/shell/CountryHero.tsx:121-143 renders it verbatim as a single underlined anchor in an unclamped 10px/16px monospace paragraph, so Indonesia's hero band renders roughly a dozen wrapped lines of Commons filenames — several times taller than the two-line content it annotates — instead of the "small credit line" spec §4.4 (specs/2026-08-17-planner-redesign-design.md:270) requires. Reachable at components/map/WorldMap.tsx:435 (map selection) and components/TripView.tsx:197 (an ID trip page).

**Failure scenario:** A user selects Indonesia in the world map. WorldMap.tsx:435 mounts CountryHero with `className="mt-3 rounded-xl bg-[var(--ink-0)] px-4 py-3 text-white"` — a narrow band whose content is two short lines. pickHero returns the ID image, and Credit renders the 984-character artist string as a single underlined anchor at 10px/16px, wrapping to roughly a dozen lines and making the credit several times taller than the hero it belongs to. The same happens on an ID trip page via TripView.tsx:197.

**Evidence:** data/country-images.json:56, the ID entry (984 characters, measured):
```
"artist": "Tari_Pendet.jpg : Christopher Michel from San Francisco, USA Garuda Pancasila.jpg : Gunkarta Borobudur-Nothwest-view.jpg : Gunkarta TMII Rumah Gadang West Sumatra.JPG : Gunkarta ... Bamboofabric.gif :Peggy Reeves Sanday derivative work: Gunkarta"
```
The ingest takes `Artist` with no length check (scripts/ingest-country-images.mjs:241):
```
const artist = metaValue(meta, 'Artist') ?? metaValue(meta, 'Attribution') ?? metaValue(meta, 'Credit');
```
the boundary validator only trims (lib/countryImagery.ts:70-74, `text()` returns any non-empty trimmed string), and the component renders it whole as the link text (components/shell/CountryHero.tsx:125-133):
```
<p className="mt-3 font-mono text-[10px] leading-4 text-white/70">
  Photo{" "}
  {source ? (<a href={source} ...>{credit.artist}</a>) : (credit.artist)}
```

**Suggested fix:** Cap the credit at ingest and at the boundary rather than in CSS, since a CSS clamp would visually truncate a licence-required credit: in scripts/ingest-country-images.mjs prefer a short `Artist` and fall through when it exceeds a limit (e.g. `const pick = (v) => v && v.length <= 120 ? v : null; const artist = pick(metaValue(meta,'Artist')) ?? pick(metaValue(meta,'Attribution')) ?? pick(metaValue(meta,'Credit'));`) so a file with only an unusable credit is dropped to the gradient — the designed state — and add the same length gate to `credited()` in lib/countryImagery.ts so a hand-curated entry cannot reintroduce it. Then re-run the ingest for ID or pin a curated hero for it.

---

## MEDIUM — components/trip/BalancesCard.tsx:89

The token sweep replaced `rail` with `--accent-ink` at three sites where the colour carried meaning rather than country identity, and because China's curated hue (30) was deliberately placed on the seal vermilion (H 29), those pairs lost their hue separation. At BalancesCard.tsx:89 a positive balance was 224 degrees from a negative one (rail #1d5c9e, H 253 vs seal #c93b2e, H 29) and is now one degree away. The two are still distinguishable — L 50.0 / C 0.080 muted brick against L 56.1 / C 0.181 vermilion, a 2.3× chroma gap, not the "saturation only" difference originally claimed — but they read as one family. Two further pairs collapse the same way: TicketsTab.tsx:184 `✎ Edit` beside :192 `✕ Remove`, and CatalogSearch.tsx:138 where the hover is a chroma jump within one hue instead of a hue change. Severity is capped at cosmetic/low rather than a functional defect, for three reasons the original claim missed: (a) colour is never the sole differentiator — the balance row prints the words "is owed " / "owes " and the buttons read "Edit" / "Remove", so no information is lost; (b) `text-seal` is not purely the error colour — it is dual-purpose, also carrying the brand vermilion for local-name text (CatalogSearch.tsx:90, DestinationStep.tsx:380, map/PlacePopup.tsx:56, trip/BriefingView.tsx:79, plan/PlaceSearch.tsx:207) and the `.stamp` chop mark, so "is owed" landing in that family is less unambiguously error-coded than stated; (c) CatalogSearch.tsx is slated for deletion in PR3 Task 34, so that third instance is arguably already owned. Scope is broader than stated in one respect: TripAccentProvider falls back to "CN" off trip routes (handoff §5f item 1 is stale — the accent wiring was since fixed), so the collision covers non-trip surfaces too. Fix: point BalancesCard.tsx:89's positive branch at `var(--ink-0)` — no new token, no reintroduced retiring utility.

**Failure scenario:** On any China trip — the default country, and the only one the curated data covers — a positive balance renders at H 30 and a negative one at H 29, differing only in saturation, where before they were 224 degrees apart (blue vs red). `text-seal` is the app's error colour everywhere (AuthForm.tsx:123, TicketsTab.tsx:124, MoneyTab.tsx:227 and :330), so "is owed" now renders in the error family. The same collapse hits two other meaning-bearing pairs: TicketsTab.tsx:184 `✎ Edit` (`text-[var(--accent-ink)]`) beside :192 `✕ Remove` (`text-seal`) — destructive vs non-destructive no longer separated by hue; and CatalogSearch.tsx:138 `className="text-[var(--accent-ink)] hover:text-seal"`, where a colour swap is the *only* hover style on the remove control, so the hover now reads as a saturation shift within one hue instead of a hue change.

**Evidence:** components/trip/BalancesCard.tsx:89
  <span className={b.net > 0 ? "font-medium text-[var(--accent-ink)]" : "font-medium text-seal"}>

lib/countries.ts:32-33
  // 30 sits on the vermilion seal (#c93b2e) the app already uses for China.
  CN: { name: "China", localName: "中国", accentHue: 30, mark: "同行" },

app/globals.css:36  --accent-ink: oklch(50% 0.08 30);
app/globals.css:79  --color-seal: #c93b2e;

Measured with lib/accent's own maths:
  #c93b2e            = oklch L 56.1% C 0.181 H 29
  accent-ink @hue 30 = oklch L 50.0% C 0.080 H 30   (1 degree apart)
  #1d5c9e (retired `rail`, what this was) = oklch L 47.1% C 0.124 H 253

**Suggested fix:** Stop routing `--accent-ink` into semantic signals. `--accent-ink` is the country-identity colour (spec §4.2) and is hue-variable by design, so it cannot be the affirmative half of an affirmative/destructive pair. Give the three meaning-bearing sites a hue-fixed pair: keep `text-seal` for negative/destructive and use `--ink-0` (or a new fixed positive token) for BalancesCard.tsx:89's positive branch and TicketsTab.tsx:184's Edit; add a non-colour hover change (underline or background) at CatalogSearch.tsx:138 so the affordance does not depend on hue at all.

---

## HIGH — app/plan/page.tsx:158

MEDIUM (not high): the wizard never sends `input.country`, so the country picked on the world map is discarded at the write boundary — `TripInputSchema` fills in `"CN"` (lib/server/schemas.ts:35), `buildTripData` stores it verbatim, and `tripCountry(data)` therefore returns "CN" for every trip the app can create. The consequence is that the per-country accent and `CountryHero` remain effectively inert even after 8183a35 fixed the provider nesting: `--accent-ink` never leaves hue 30 and the hero photo is always China's, because nothing can ever put another code in storage. DestinationStep owns the country privately (components/DestinationStep.tsx:53; `Props` at :14-29 declares no country callback) and the only other `country:` write in the wizard is the hardcoded off-map placeholder (app/plan/page.tsx:113); `PlaceSearch` even stamps the active country onto `PickedPlace.country` and the off-map path (`onAddOffMap(place.name)`) throws it away, which is the "country from the active country" the PR2 plan asked for at line 181. What the original finding overstates: a mislabelled Thailand trip is not reachable in this tree. Curated data carries no `country` field and the catalog is 695 Chinese cities, so a non-CN country offers only hand-typed off-map places, and `resolveDestinations` (lib/server/catalog.ts:278-288) cannot resolve `offmap:` ids — such a trip dies with a 400 at app/api/trips/route.ts:44 instead of being stored as China. Likewise the `resolveTripSeason(input.season, month, input.country)` hemisphere concern is latent, not live: every trip that survives creation contains Chinese cities, for which China's hemisphere is correct. So the defect to fix is the discarded country (thread it from DestinationStep into `tripInput`, and stop hardcoding it in `addOffMap`), and the harm to record is a permanently inert per-country accent/hero plus a latent wrong-hemisphere season that becomes live the moment non-CN place data lands.

**Failure scenario:** User clicks "🌍 China" → world map → picks Thailand. The map/search re-scope to TH and the header reads "planning in Thailand". They add places and press "Build my plan" → POST /api/trips carries no `country`, zod fills in "CN", `data.input.country === "CN"`. On the trip page `tripCountry(data)` returns "CN", so TripAccentProvider passes "CN" to PrefsProvider (--accent-ink stays hue 30) and CountryHero renders the Great Wall photograph behind a Thailand trip. `resolveTripSeason(input.season, month, input.country)` (app/api/trips/route.ts:37) also derives the season against China's hemisphere, so a January trip in a southern-hemisphere country is stored as winter.

**Evidence:** app/plan/page.tsx:157-160 —
  const tripInput = useMemo<TripInput>(
    () => ({ destinationIds: selected, days, season, adults, kids, interests }),
    [selected, days, season, adults, kids, interests]
  );

DestinationStep owns the country and never reports it upward (components/DestinationStep.tsx:53, and `Props` at :14-29 declares no country callback):
  const [country, setCountry] = useState("CN");
  const changeCountry = (code: string) => { setCountry(code); setRegion("All"); };

PlanStep posts that object verbatim (components/PlanStep.tsx:204-215): `body: JSON.stringify({ tripName..., startDate..., input, ...})`, and the server defaults the missing field (lib/server/schemas.ts): `country: CountryCodeSchema.default("CN")`. The only other `country:` write in the wizard is the off-map placeholder, hardcoded `country: "CN"` (app/plan/page.tsx:113).

**Suggested fix:** Give DestinationStep an `onCountryChange` prop, hold `country` in app/plan/page.tsx alongside `days`/`season`, and include it in the `tripInput` useMemo so it reaches CreateTripSchema.

---

## MEDIUM — components/plan/useDayBuilder.ts:62

`activitiesByDestination` is read only as `useReducer`'s init argument (useDayBuilder.ts:62-66), so the injected activity map is frozen at mount and no action updates it — a destination that enters `plan.days` after mount gets a permanently empty shelf. The reachable trigger is a whole-plan rebuild, not the add-day control: PlanTab's destination select offers only destinations already in `plan.days` (PlanTab.tsx:69-73) and a destinationId-less `addDay` copies the last day's destination (planOps.ts:77-79), so no UI add can introduce a new destinationId. `PATCH /api/trips/[id]` (route.ts:68-73), however, is member-authorized and replaces `data.plan` wholesale from a new `input` — a scenario the reducer already anticipates when it clamps `targetDay` (lib/dayBuilder.test.ts:336). When such a rebuild lands via the poll while a member sits on the Build view, PlanTab's memo recomputes to include the new curated destinations but the reducer keeps its mount-time map, so `state.activitiesByDestination[target.destinationId]` is undefined, the shelf holds only the custom row, and ShelfPanel renders "Everything for this destination is already on the plan." (DayBuilder.tsx:408-411) — false, since none of that destination's activities are scheduled. Mitigating: no client calls that endpoint today (grep for PATCH in components hits only tickets/expenses/journal), and toggling to Days and back remounts DayBuilder with a fresh map.

**Failure scenario:** A member is on the Build view with a Beijing-only plan. Another member adds a Xi'an day; the poll applies the new `days`, PlanTab recomputes `activitiesByDestination` to include xian's curated activities, but the reducer keeps its mount-time map. The member selects the new "Day 04" chip: `state.activitiesByDestination["xian"]` is undefined, the shelf holds only the custom row, and ShelfPanel renders "Everything for this destination is already on the plan" — a false statement, since none of Xi'an's activities are scheduled.

**Evidence:** components/plan/useDayBuilder.ts:62-66 —
  const [state, dispatch] = useReducer(
    dayBuilderReducer,
    activitiesByDestination,
    createDayBuilderState
  );

React calls the third argument only on the initial mount, and `DayBuilderAction` (lib/dayBuilder.ts:78-90) contains no action that writes `activitiesByDestination`; no reducer case assigns it. `deriveShelf` reads it from state: `for (const activity of state.activitiesByDestination[target.destinationId] ?? [])`. The prop is recomputed live upstream — components/trip/PlanTab.tsx:85-93 memoises it on `[plan.days]` — so the caller's map and the reducer's copy diverge silently.

**Suggested fix:** Add an action (or fold it into `serverPayload`) that replaces `activitiesByDestination` and re-derives the shelf, and dispatch it from an effect keyed on the prop.

---

## MEDIUM — components/plan/PlaceSearch.tsx:70

Catalog search is not scoped by the selected country, so the invariant asserted twice in comments — DestinationStep.tsx:60-63 ("browsing Japan must not offer Chinese cities") and CountryMap.tsx:102-104 ("search ... scoped to the same country") — holds for the curated half only, and a non-CN plan can silently collect Chinese cities. Failure scenario: country is switched to JP; `countryDestinations` is empty so the curated list and the curated-name dedupe in `rankPlaces` are both empty; the user types "wuh" and the China-only catalog returns Wuhan, Wuhu, Wuhai as normal ranked rows; clicking one calls `onAddCatalog`, and `DestinationStep.tsx:126` then stamps the resulting chip `country: "CN"` on a Japan plan with nothing in the UI indicating the mismatch. Note the original claim's example is wrong: Beijing is a curated destination and is filtered out of `searchCities` by `CURATED_NAMES` (lib/server/catalog.ts:122-142) — verified that "beij" returns zero rows against the real data/catalog.json. Non-curated Chinese cities (Wuhan, Nanjing, Tianjin) are the reachable cases. The fix follows the pattern already used in the map half: `MapExplorer.tsx:87-102` gates both China-only assets on `hasDetailLevel(country)`; the search fetch needs the same gate.

**Failure scenario:** Country is switched to JP. The CountryPlaceList fallback tells the user "No map for Japan yet — search above to add places". They type "beij": the China-only catalog returns Beijing, it is offered as a normal ranked row, and clicking it calls `onAddCatalog` — a Chinese city is now a destination of the Japan plan with nothing in the UI indicating the mismatch.

**Evidence:** components/plan/PlaceSearch.tsx:70 sends only the query —
  const res = await fetch(`/api/destinations?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });

app/api/destinations/route.ts reads no country: `const q = req.nextUrl.searchParams.get("q") ?? ""; ... results: q.trim().length >= 2 ? searchCities(q) : []`. `rankPlaces(query, curated, hits, options)` (lib/placeSearch.ts) has no country parameter, and `RankOptions` carries only `selectedIds`, `selectedOffMapNames`, `catalogLimit`. The `country` prop PlaceSearch does receive is used only to stamp `PickedPlace.country` (:126), which DestinationStep's `addPlace` (:149-169) never reads. The contradicted claim is components/DestinationStep.tsx:58-63: "Offers are scoped: browsing Japan must not offer Chinese cities."

**Suggested fix:** Either pass the country to `/api/destinations` and filter `searchCities` by it, or drop catalog rows whose country does not match the active one before ranking, leaving only the off-map row for unsupported countries.

---

