# Worldwide country guidance — design

*Branch `feat/worldwide-cities`. Sits between Task 18 (done) and Task 19 (the Peru acceptance test). Tasks numbered 20–32.*

---

## The problem

The city catalog is worldwide. The generated plan's prose is not. Every string below is emitted unconditionally, for every country, and I re-read each one today.

**Tips — snapshotted into the trip forever, and published on the unauthenticated briefing.**
`lib/itinerary.ts:61-67` `GENERAL_TIPS`, read at `lib/itinerary.ts:264` `buildTips` as `[...GENERAL_TIPS]`:

> "Set up Alipay and WeChat Pay with your home bank card before flying — most of China is cashless."
> "Install and test a VPN before arrival if you need Google, WhatsApp or Instagram."
> "Book high-speed rail seats on Trip.com or the official 12306 app up to 15 days ahead."
> "Carry your passport everywhere — it's required for hotels, train travel and many attractions."
> "Download offline maps (Amap 高德 works best in China) and a translation app with offline packs."

`lib/itinerary.ts:271` adds "metro stations often lack lifts at every exit" — a claim about Chinese metros. These flow through `lib/briefing.ts:182` → `components/trip/BriefingView.tsx:175`, including `app/b/[code]/page.tsx`. **China's VPN advice is publishable on a Peru trip's share link today.**

**Hop and departure titles.** `lib/itinerary.ts:188-190`: `` `High-speed rail or flight to ${dest.name}` `` with note "Arrive at the station 30–40 minutes early; passport needed to board." `:205` "Evening train or flight out", `:212` "Head to the airport or station".

**Packing.** `lib/packing.ts:53-54, 62-66, 74, 76` — "Alipay + WeChat Pay set up and tested with your bank card", "Some RMB cash (¥300–500) as a backup", "everything in China runs through your phone", "VPN installed and tested before departure", "Universal power adapter (China uses type A/C/I plugs, 220V)", "Offline translation app (Pleco or …)", "Offline maps app (Amap 高德 has the best China coverage)", "many restrooms lack paper", "tap water isn't potable". Plus `lib/packing.ts:32` "Lip balm and moisturiser — northern air is very dry", which fires on any winter trip — including Lima's coastal-fog winter.

**Route.** `lib/route.ts:297`: "Every leg is high-speed-rail friendly — book seats ~15 days ahead on 12306 or Trip.com." Rendered at `components/map/MapExplorer.tsx:646`.

**The picker, which is Task 19's own walk-through.** `components/map/MonthTimeline.tsx:11-14` takes `{ month, onMonth }` and nothing else; it imports `HOLIDAY_BANDS` and `crowdForMonth` from `lib/months.ts` directly (`:4-8`) and renders them at `:37,49-56,97,131`. `MapExplorer.tsx:588` mounts it for every country. `components/map/PlacePopup.tsx:38-39` does the same. **A user picking Peruvian cities and scrubbing to October is shown "National Day Golden Week 🇨🇳".** February shows "Chinese New Year 🧧". Every Peruvian city hover shows China's `NATIONAL_CROWD` curve under the tooltip *"Typical national crowd pressure this month"*.

**Money.** `lib/countryProfile.ts:236-238` `isCurrencyResearched` is `code === "CN"`, so `initialCurrencySettings` stamps no pivot, so `lib/tripShared.ts:150` `currencyPivot` falls to `?? "CNY"`, so `components/trip/MoneyTab.tsx:146` renders **"Total CNY"** over Peruvian soles.

**Season.** `app/plan/page.tsx:315` calls the bare northern `seasonOfMonth`; `lib/tripSeason.ts:27` uses the profile. Peru is southern (`lib/countries.ts:68`). **The wizard previews one season's plan and the server saves the opposite one.**

**Structurally**, `lib/route.ts:143` `estimateLeg` takes no country and reads module-private `RAIL_KMH = 230` (the comment at `:69` says "China's high-speed rail network"). `CountryProfile.transport.railKmh: null` is read by nothing. Lima→Cusco is scored as a rail leg at Chinese HSR speed and rendered with the 🚄 glyph at `MapExplorer.tsx:624`.

**Six of the eight `CountryProfile` fields have zero production consumers.** Grep for `.crowdByMonth|.holidays|.climateFor|.transport|profile.tips|profile.packing` across `lib components app scripts` returns nothing outside `lib/countryProfile.test.ts`. Only `seasonOfMonth` and `currency` are read live. **The seam exists and is 25% wired. Populating it changes nothing a user sees until the consumers are rewired.**

And a defect hiding in plain sight: `lib/countryProfile.ts:73-106` `CHINA_PACKING` is byte-identical to `lib/packing.ts:48-78` (I diffed all three groups today — Documents & Money, Tech, Health & Comfort, all identical). Two copies of one document, neither pinned equal, guaranteed to drift.

---

## What we are building

Three things, in this order.

1. **Wiring, with zero new data.** Invert the import arrow, then route `itinerary.ts`, `packing.ts`, `route.ts`, `MonthTimeline` and `PlacePopup` through `getCountryProfile(country)`. `NEUTRAL_PACKING` (`countryProfile.ts:114`), `NEUTRAL_TIPS` (`:146`) and a neutral `bookingCopy` (`:197`) already exist; `TripInput` already carries `country`. After this, no user of any country is shown a false statement. Peru's plan is **honest but thin**.

2. **A facts ingest that upgrades thin to specific.** `scripts/ingest-country-facts.mjs` queries Wikidata (CC0) and emits `data/country-facts.json` — **structured scalars only, never prose**. A zero-import `lib/countryTips.ts` turns those scalars into sentences using fixed templates written in reviewed TypeScript. No upstream string ever reaches a user.

3. **An honest-gap surface.** Every country that is missing a fact says so, per field, in muted copy that is visibly not advice.

China's hand-written profile is never replaced. `lib/countryData/cn.ts` becomes the permanent editorial layer — one country today, with a documented shape and cost for adding the next.

**The bar, restated honestly.** The user's instruction is binding: *"the details will need to be as clear as china for all countries."* Their sourcing instruction is equally binding: *build-time ingest from open data, only what the data supports, honest gaps rather than invented advice, explicitly NOT hand-curated-first.* These are in tension. Alipay/VPN/12306/Amap-class advice exists in **no** structured open source for 246 countries. This design resolves the tension toward the second instruction by changing what "as clear" means: China's five tips are five specific, checkable facts, and Peru gets five specific, checkable facts of a different kind. Different facts, same standard of concreteness, every one sourced.

**This trade must be surfaced to the user before Task 25 spends the ingest budget.** It is not mine to settle unilaterally.

---

## Why this shape

**Why populate `CountryProfile` rather than build a new layer.** Because `lib/countryProfile.ts:15-45` already declares exactly the right interface, and it was written for this. `railKmh: number | null` documents "null = no meaningful rail estimate for this country" (`:16-17`). `climateFor` takes a free-form `region: string` and returns `null`. `holidays` are fractional-month bands with no China-specific fields. `bookingCopy` is documented as "Generation-time copy: where and how far ahead to book" (`:27`). `getCountryProfile` (`:218`) is total, never throws, and returns fresh objects with copied arrays every call — pinned at `countryProfile.test.ts:45-50`. A second layer would need all of that again and would give us two answers to "what does this country get."

**The one thing standing in the way is an import arrow.** `countryProfile.ts:2` value-imports `GENERAL_TIPS` from `./itinerary`; `:12` value-imports `TRANSPORT` from `./route`. Making those modules import the profile back creates two runtime cycles. So the data moves **down** into zero-import leaves and both sides import the leaf. This is T20, on its own, provably behaviour-neutral — because a data defect and a cycle defect arriving in one commit cannot be bisected, and this project's history is ten defects living in the plan's own prescribed code.

**Why facts, not prose.** Investigation 3 ran a naive first-sentence extraction over Wikivoyage's "Get around" section: 3/10 usable, with Japan leaking raw wikitext (`thumb|[[Tokyo/Tama|Tama Monorail...`) into what would have been a user-facing string. Templates in TypeScript are deterministic, pinnable by unit tests, translatable later, and structurally incapable of leaking markup. The artifact is named `country-facts`, not `country-guidance`, and that name is a guardrail: it should read as wrong to put a sentence in it.

**Why one bundled `data/*.json`, not `public/` shards.** `lib/server/planService.ts:13-14` generates server-side; `components/PlanStep.tsx:37-38` generates the same plan client-side for the wizard preview. A `public/` read 500s in a lambda (`lib/server/cityIndex.ts:13-24` documents this). Nothing fetches guidance per country, so sharding buys nothing and two copies would drift. Precedent: `lib/countryImagery.ts:1` static-imports `data/country-images.json` (6,505 bytes, 14 countries) and it reaches the client fine.

---

## Data sources and what each supplies

Single source: **Wikidata SPARQL**, `https://query.wikidata.org/sparql` (POST, `Accept: text/csv`). Licence confirmed live from `meta=siteinfo`: *"All structured data from the main and property namespace is available under the Creative Commons CC0 License."* CC0 = public domain dedication, **no attribution condition**.

Two coverage columns, because they measure different things and **they do not agree**.

| Field | Property | Raw /246 | Post-withhold /246 | Consumed by |
|---|---|---|---|---|
| `currencyCode` + `currencyName` | P38 → P498, label of P38 | 244 | **234** | currency tip; money pivot; packing cash line |
| `plugs[]` | P2853 → 13-row standard→letter table | 222 | **222** | socket tip; packing adapter line |
| `voltageV` | P2884 | 222 | **220** | socket tip; packing adapter line |
| `drivingSide` | P1622 | 246 | **245** | driving tip |
| `emergency[{number, role}]` | P2852 + P366 qualifier | 222 publishable | **218** | emergency tip |
| `officialLanguages[]` | P37 (English labels) | 243 | **239** | language tip; packing translation line |
| `callingCode` | P474 | 242 | **238** | driving tip (second clause) |
| `lat` *(test-only, never rendered)* | P625 | 246 | **245** | one cross-check test on `SOUTHERN` |

Raw figures: Investigation 3, measured 2026-08-27 against the app's exact 246 shard codes. Post-withhold figures: the Design-3 prototype, same day, *after* the withhold rules below. **193/246 countries carry all seven rendered fields; 27 carry six, 10 carry five, 11 carry four, and 5 carry three or fewer — SH, TF, SJ, CX, IO, all uninhabited dependencies.**

**RECONCILED after the shipping query ran.** The `officialLanguages` post-withhold cell above said 237 with a note beside it that the figure "was not measured and is marked unverified" — two statements about the same number, one of them written after the other stopped being true. It is now measured, and it is **239**: the territorial-scope rule in `pickLanguages` withholds six countries (AF, AZ, BE, BQ, PW, US), and two of those six — BE and AZ — are restored by a hand-verified `CURATED_FACTS` row, because their `applies to part` qualifier names a region of the country or a variety of the language rather than a territory the national claim excludes. The rendered-field histogram moved with it: **184/246 carry all seven**, not 193. The authority for every one of these numbers is `lib/countryFacts.test.ts`'s `MEASURED_COVERAGE`, which is pinned exactly against the committed artifact; this table is a record of the design's estimate and what it turned out to be.

**Two discrepancies to reconcile at T25, not to paper over.** Driving side and latitude go 246 → 245 across the two runs, and currency 244 → 234. The currency drop is explained (withhold on multi-value); the 246 → 245 pair is not. **The shipping query must produce every number that lands in a comment or the report.** Investigation 3 measured this hazard directly: the same emergency-number question returned 0, then 84, then the correct 155 depending on `BIND`/`OPTIONAL` scoping inside Blazegraph.

### Four measured landmines, each a withhold rule and each a test fixture

**Voltage is not always domestic.** 12/246 are multi-valued; two include industrial three-phase — `BZ: 550/220`, `FR: 400/230`. A `SAMPLE()` has a coin-flip chance of publishing "Belize runs at 550 V". Rule: every raw value must fall in 100–260 V and at most two distinct values may survive; otherwise **withhold**. Genuine dual-voltage countries pass (`BO 230/115`, `BR 220/127`, `ID 230/127`, `MA 220/127`).

**The ISO code sits on the wrong item for composite states.** `NL`'s P297 is on Q29999 "Kingdom of the Netherlands", so P38 yields `EUR/USD/AWG/XCG` — a naive ingest gives `getCountryProfile("NL").currency === "AWG"`, **worse than today's admitted USD placeholder because it looks researched**. Also `FR → EUR/XPF`, `MO → HKD/MOP`, `ZW → 13 currencies`, `CZ → "203/CZK"` (203 is Czechia's ISO *numeric* code leaking into P498), `PL → "PLZ/PLN"` (the pre-1995 zloty, still ISO-shaped and still truthy). Rule: keep only `/^[A-Z]{3}$/` values (this rescues `CZ`); if more than one survives, **withhold**, then apply a hand-verified override (below).

**Plug types are technical standards, not letters.** P2853 returns `Europlug`, `Schuko`, `BS 1363`, `NEMA 1-15`, `AS/NZS 3112`, `IEC 60906-1`, `SN 441011`, `Type E/H/K/L`. The distinct value set across all 246 is **exactly 14 items** — small and auditable. One of them, `AC power plugs and sockets: British and related types` (Q60740126, 39 countries), is a *Wikipedia article* used as a value. Measured: **0 countries have it as their sole value**, so dropping it by explicit id is lossless. Rule: a hard-coded 13-row standard→letter table; **any unrecognised standard withholds the whole plug field for that country**, never passes through.

**P2852 values are Q-items, not literals.** The number lives in the item's `rdfs:label`. Cross-checked: Q11185210 serves as both Japan's coast-guard number and Switzerland's fire number, consistent only if the item is "118" — and it is. Rule: validate the label against `/^[0-9]{2,6}$/`. Publish only if the statements carry `P366` roles (155 measured) **or** there is exactly one number (67 measured) — 222 publishable. Multiple unlabelled numbers → **withhold**.

### `CURATED_FACTS` ships populated

Judges disagreed: Design 3 shipped it empty ("withholding is honest, sampling is not"); the buildability judge said Poland with no currency reads as broken. **Resolution: populate it, with rules.** Each row is a hand-verified value, carries a comment naming the exact upstream shape that caused the withhold, follows the `CURATED_HEROES` precedent (attribution is never invented to fill it), and **is asserted by a test to actually fire** — so if Wikidata is later fixed, the stale override goes red instead of becoming silent cruft. Shipping rows: `NL`, `FR`, `PL`, `ZW`, `MO` currencies, plus `FR` voltage. Withholding is honest; a hand-verified value with its provenance recorded is *more* honest, and it is not sampling.

### What no source supplies, measured

- **`railKmh` outside CN.** `?line wdt:P31 wd:Q928830` ("high-speed railway line") returns lines for **Peru, Panama, Ecuador, Bangladesh, Venezuela, Colombia, Australia and the Philippines**, and 1,369 for the US. World Bank `IS.RAI.TOTL.KM` would say Peru has ~1,900 route-km — true, and mostly mineral freight. Either would tell the app Peru is high-speed-rail friendly. **This is the invented-advice failure in its purest form, on the exact field this work exists to fix.**
- **`holidays`.** Nager.Date covers 204/246, missing IN, TH, MY, LK, NP, PK, MM, LA, IL, AE, SA, QA, KW, OM, JO, LB, TW, MO, MU, MV, FJ, UZ, IR, AZ and 18 more — disproportionately where holiday crowding matters most. It returns single dates, not travel-impact bands, and has duplicate rows (PE 2026 lists both "Holy Thursday" and "Maundy Thursday" on 2026-04-02). Wikidata P832 is worse: 73/246.
- **`crowdByMonth`.** No open per-country per-month tourism seasonality source exists. UNWTO arrivals are not openly redistributable at this granularity.
- **`climateFor`.** Needs station normals (GHCN/WMO) — a separate dataset of a different order of size.
- **Payment apps, connectivity, booking channels, tipping, tap water, visa rules.** No structured source. Visa rules also depend on the traveller's passport, which the app does not know.

**Wikivoyage is refused, on measured grounds, recorded here so it is not re-litigated.** Licence is CC BY-SA 4.0 (confirmed live, not 3.0) and share-alike is viral — derived guidance would attach that licence to the app's own generated itinerary copy, materially larger than the CC BY it carries today. And it cannot deliver: 57.9% of country articles are `{{outlinecountry}}` (its lowest tier, only 6 of 242 are `guide` or `star`); fact-bearing subsections run Visas 14.5%, Electricity 15.3%, Tipping 33.5%, Costs 32.2%; `{{quickbar}}` is present on 97.5% but 86.8% of those carry only a map image (currency 1.7%, electricity 2.9%). The one section that extracts cleanly is "Buy" (9/10) — which yields the currency, the field Wikidata already gives at 99.2%. **Text extraction succeeds only where it is not needed.**

---

## The honest-gap rule

**Absent, never empty. Never a placeholder sentence. Never a hedge.**

A field with no supporting data emits **nothing** — the template does not run. A country with no facts at all falls through to `neutralProfile`, which is already the honest default. `assertFactsSane` carries a positive fixture for a known-sparse country asserting it is present *with fields absent*, so "we degraded to fabrication" and "we degraded to silence" can never be confused.

Silence alone is not enough, though — a user cannot tell "there is nothing to say" from "we forgot Peru." So `CountryProfile` gains **`gapNote: string[]`**: muted copy, rendered as a note and never as a tip, composed per field.

**Line 1 — always, for every non-CN country:**

> These notes come from open reference data. We don't have Peru-specific guidance on payments, connectivity, booking channels or public holidays yet — and we'd rather leave that blank than guess.

**Line 2 — only when one of the six rendered fields is absent**, naming exactly which:

> We also have no emergency numbers or plug types for Saint Helena.

Composed from the fixed list `["currency", "plug types", "mains voltage", "emergency numbers", "official language", "dialling code"]`, joined with commas and a final "or". Absent entirely when all six are present.

**China's `gapNote` is `[]`.** It is researched by hand.

**`gapNote` is never snapshotted into the trip.** `plan.tips` is persisted at creation and never regenerated (`planService.ts:13`), which is right for advice a traveller acted on — but wrong for a statement about *our current data*. The note is computed at render time from the trip's country, so it shrinks as the data improves and disappears when a country is fully covered. This also avoids a persisted-shape migration on `TripData.plan`.

**`crowdByMonth` becomes `number[] | null`.** This is the honesty judge's decisive catch and I am adopting it over two designs that shipped the flat curve. `FLAT_CROWD = 3` (`countryProfile.ts:153`) is not the absence of a crowd claim — wired into `MonthTimeline.tsx:49-56` it renders `Crowds ●●●○○` under the tooltip *"Typical national crowd pressure this month"*. Wiring Peru through a flat-3 profile would **manufacture a brand-new unsourced claim while believing we were removing one**. `null` renders no crowd element at all. Cost, verified today: two pins in `countryProfile.test.ts` — "crowd pressure is flat rather than invented" (`toHaveLength(12)` + `new Set(...).size === 1`) and the junk-code totality test's `expect(getCountryProfile(junk).crowdByMonth).toHaveLength(12)`.

---

## Attribution

**Wikidata is CC0. No attribution condition. Therefore: no change to `components/plan/GeoNamesCredit.tsx`, and no widening of the C7 derived contract.**

This is a decision, not an oversight, and it is recorded in three coupled places so a reader cannot mistake it for one: a `SOURCE_LICENSE = "CC0-1.0"` const in the ingest, a `license` field stamped into the artifact envelope, and an `## Attribution` section in `data/country-facts-report.md` that states the source is CC0 and that **no UI credit is added, and why**.

The existing component already argues this exact case for this exact source (`GeoNamesCredit.tsx`, doc-comment): *"Wikidata is deliberately NOT named… Its `schema:description` values are CC0 — public domain dedication, no attribution condition to discharge — and naming a CC0 source here would imply the credit is discretionary, when every line below is required."* Adding a CC0 source to a legal notice would weaken the notice.

**The new report is deliberately outside C7.** Verified today: `lib/contracts.test.ts` names `data/cities-report.md` specifically at `:712`, `:952`, `:972` and `:1032`, and `:1026` re-runs `buildReport` from `scripts/ingest-cities.mjs` live and byte-compares its Attribution section against the committed file. `data/country-facts-report.md` joins none of that, because it names no attribution-bearing source.

**The trigger, stated in advance.** If a future task adds a source with an attribution condition, that task owns, in a single commit: the clause in `GeoNamesCredit.tsx`, the C7 token-list widening at `lib/contracts.test.ts:634-666`, and the enumerated-surface update in `data/cities-report.md` — because `:980-989` asserts the report's list **equals** the crediting set in both directions and `:963-978` forbids the phrase "every surface". This coupling is a second, independent reason holidays stay out of scope: Nager.Date's terms are unverified, and an attribution requirement there would drag the most protected construct in the repo into a data task.

---

## What a Peru plan says after this

*Peru, June, 10 days, Lima → Cusco → Arequipa, two adults and one child.*

**Season: winter.** Both the wizard preview and the saved trip agree, for the first time. Today they disagree for every southern-hemisphere country.

**Tips panel** — three neutral lines, then five fact-derived ones:

1. Check your passport validity and entry requirements well before you book.
2. Tell your bank you are travelling so your cards keep working.
3. Download offline maps and a translation pack before you leave.
4. Prices are in Peruvian sol (PEN). Set your home currency on the Money tab for live conversions.
5. Sockets are type A, B and C at 220 V — bring a universal adapter.
6. Emergency numbers: 105 police, 116 fire, 106 ambulance.
7. Spanish is the official language, with Quechua and Aymara also official — download an offline Spanish pack before you go.
8. Traffic drives on the right. The international dialling code is +51.

*Travelling with kids:* "pack light and allow buffer time between stops." (No metro claim — that moved to `cn.ts`.)

**Gap note**, muted, below the tips, structurally not a tip:

> These notes come from open reference data. We don't have Peru-specific guidance on payments, connectivity, booking channels or public holidays yet — and we'd rather leave that blank than guess.

(No second line. Peru carries all six fields.)

**Hop titles:** "Travel to Cusco", "Travel to Arequipa" — no note. Departure: "Evening departure — safe travels home!" or "Time to head home — safe travels!".

**Route:** Lima→Cusco ~570 km. `railKmh === null`, so rail is not a candidate. LIM and CUZ are both within `airportSearchRadiusKm`, so the leg resolves `mode: "flight"` with real hours and a ✈️ glyph — which is how Peruvians actually travel it. A leg with no airport pair in range renders as `kind: "overland"` with its km and **no hours**, because `km / 60` is a claim about Andean roads (Lima→Cusco by coach is roughly 20 h, not 9.5 h). Route note: *"Book long-distance transport ahead — fares climb close to the date."* Zero 🚄 anywhere; the "high-speed-rail friendly" note is emitted only when `railKmh !== null`.

**Packing:**
- *Documents & Money* — passport with six months' validity; a payment card that works abroad; **"Some Peruvian sol (PEN) in cash as a backup"**; travel insurance details; bookings stored offline.
- *Tech* — **"Universal power adapter (Peru uses type A/B/C plugs, 220V)"**; phone and power bank; **"Offline Spanish translation pack"**; offline maps downloaded before you fly.
- *Health & Comfort* — prescription medicines in original packaging; basic meds; reusable water bottle; broken-in walking shoes. (No "restrooms lack paper", no "tap water isn't potable" — both are unsourced country claims.)
- *Clothing for winter* — fires correctly for southern June, **without** "northern air is very dry".

**Month scrubber:** no holiday bands. **No crowd element at all** — not a flat ●●●○○. Place popups drop the crowd dots rather than showing China's curve.

**Money tab:** pivot is PEN, header reads "Total PEN", and `Rates.tsx` has a destination currency to work with. Today it reads "Total CNY".

**The plug line is the design's strongest gate, and it is not a fixture I invented.** Fed China's Wikidata facts, the same template emits:

> Universal power adapter (China uses type A/C/I plugs, 220V)

— character-for-character the string a human wrote at `lib/packing.ts:64` without ever seeing Wikidata, because CN's P2853 values are Europlug + NEMA 1-15 + AS/NZS 3112 → sorted `["A","C","I"]`, and P2884 is 220. That is an independent check on the whole template layer, and it makes a bad upstream edit fail the build on the one country whose answer is known to be right.

**China is unchanged, byte for byte**, and `countryProfile.test.ts:17-33` proves it.

---

## Non-goals

Each of these is a decision with a reason, not an omission.

- **`railKmh` outside CN stays `null`, permanently.** The Wikidata HSR signal lists Peru, Panama, Ecuador, Bangladesh and the Philippines as high-speed-rail countries. Rail speed for a new country is a hand-written, cited entry in `lib/countryData/`.
- **`holidays` stays `[]`, `crowdByMonth` becomes `null`, `climateFor` stays `null`.** Judges split here: one design gated holidays behind a licence check; two refused. **Refused.** The gating design's own risk section concedes it "makes India *look* covered while being empty," and the licence branch would drag in the C7 cascade above. The gap note names public holidays explicitly, so the absence is visible rather than silent. Climate is the highest-value future addition — it is what actually answers "when should I go" — and is a named successor task with its own ingest, attribution and gates.
- **`lib/countries.ts:66-70` `SOUTHERN` is not retired**, despite its own comment asking for a latitude lookup. Verified today: `lib/isoTopology.test.ts:39-55` regex-scans the `SOUTHERN` block out of the source and `:124` asserts `southern.length >= 30`, and `:129` builds a reconciliation set from `[...curated, ...southern]`. Retiring it reddens a derived contract in a file unrelated to guidance, and the careless fix — deleting the assertion — silently shrinks the reconciliation set, which is exactly this repo's recurring hollow-test shape. The hand list also encodes a *judgment* ("countries straddling the equator are listed by where their travel season actually falls") that a centroid latitude would overrule for ID, KE, BR and CD. Instead, T25 adds a **cross-check**: every code in `SOUTHERN` has negative `lat` in the artifact, or is on a named, commented equator-straddling exception list. That is the only consumer of the ingested `lat` field.

  > **SUPERSEDED.** The cross-check as specified here was ONE-DIRECTIONAL, and that is the hole it left: it walked `SOUTHERN` and checked each entry's latitude, so it could see a wrong entry and never a missing one. The hand list held 34 of the 58 countries with a negative centroid, so 25 — Ecuador, Gabon, the Comoros, Mauritius, the Falklands, Christmas Island and 19 more — were told a June trip was summer while passing the check. `SOUTHERN` is now DERIVED from the artifact's latitudes and reconciled in BOTH directions; the equator judgement survives as a named exception list (KE alone), not as a reason to keep the list hand-maintained. See the block comment on `SOUTHERN` in `lib/countries.ts` and `SOUTHERN cross-check` in `lib/countryFacts.test.ts`.
- **`lib/server/catalog.ts:367,400`'s blanket `bestSeasons: ["spring","autumn"]`** — stamped on every catalog and GeoNames city worldwide, feeding both the map tint (`mapTypes.ts:61`) and `scoreActivity` (`itinerary.ts:75`). One judge wanted it in scope, one out, one was silent. **Resolution: take the measurement, not the change.** T32 records which cities the stamp affects and what removing it would do to curated China cities; the change belongs to Task 19's plan or a successor, because an unbounded change to itinerary ranking does not belong in a task whose purpose is fixing itineraries.
- **App chrome beyond the plan path** — `components/shell/AppShell.tsx:110-111`'s `游` logo, `components/home/TripsDashboard.tsx:79`, `components/trip/TicketsTab.tsx:293,327,340,354` (`"e.g. G2 · CA1858"`, `"Beijing or PEK"`, `"Seat 05A, carriage 3"`, `"¥553"`), `components/trip/ExpenseForm.tsx:28,118` (`QUICK_CURRENCIES = ["CNY","SGD"]`, `"Hotpot dinner"`), `components/DestinationStep.tsx:400,438,455`. Named follow-up with the file:line list attached. **Explicitly including `app/globals.css:90-92`'s `.font-kai` Kaiti stack in that follow-up as a question, not a change** — it is applied to `localName` at five call sites and is *correct* for Chinese names, so changing it is an untested visual change to working UI. **And explicitly not a tree-wide CJK scan over `app/` and `components/`** — that buys a permanent constraint that can redden future commits touching files this work never went near.
- **`lib/data/{east,north,south,west}.ts` (100% China, so `DestinationStep`'s cards view is empty elsewhere), `catalog.ts`'s `foods: []`, `lib/briefing.ts:85-88`'s China-only `localNameFor`, and `data/country-images.json`'s 14 heroes.** These make Peru *thin*, not *wrong*. Separate content work.
- **`lib/meta.ts:19-24` `SEASONS.months`** (`"Mar – May"` etc., rendered at `DetailsStep:61`, `PlanStep:65`, `TripView:194,376`). One judge wanted it; it is four render sites and a shared-metadata change for a label that is wrong only in the southern hemisphere. Deferred to the same follow-up as the branding sweep, listed so it is tracked.
- **`isCurrencyResearched` is not deleted.** One design deleted it; two re-implemented it. **Re-implemented.** It keeps its name, both `tripShared.ts` call sites (`:47`, `:173`) and its docblock claim to be "the one place 'researched' is decided" — only the body changes to `getCountryProfile(code).currency !== null`. Smaller blast radius, and the docblock stays true.
- **`lib/rates.ts` is not refactored.** One design extracted a currency-code leaf from it because `rates.ts:1` imports zod and the `.mjs` ingest cannot. A `/^[A-Z]{3}$/` filter in the ingest avoids the whole problem, and this is the money path on a project whose memory flags PR4 as having merged without its production data check.

---

## Risks carried

**1. The bar as literally stated is not met, and the design says so on the surface.** China gets five lines of hand-written local knowledge; every other country gets five lines of fact-derived specificity. Comparable concreteness, different content. Mitigations are honesty, not concealment: the per-field gap note, the report's table ranking countries by fact count, and an explicit user sign-off gate before T25. `lib/countryData/cn.ts` is the escape hatch and it is permanent, not transitional — one design proposed dissolving it into the artifact once the ingest reproduced its strings, which would cap every non-CN country at seven templated facts forever. **It is never dissolved.** Its doc-comment states the shape and the cost of adding a country: roughly 5 tips, 4 packing deltas, 1 booking line, optionally a cited rail speed.

**2. A template renders a true fact into a false sentence.** This is the design's own biggest failure mode. Mitigation is the CN reproduction gate (above), which is strong precisely because it is not self-referential.

**3. Thin data.** Measured, not feared: 193/246 carry all seven fields; the five thinnest are uninhabited dependencies. A missing field produces no sentence at all, and a test asserts that **at least one country is withheld by each of the currency, voltage, plug and emergency rules**, so the withhold path is observably live rather than dead code.

**4. The gate that catches nothing.** A bad Wikidata edit changing one country's voltage passes every ratio, every coverage floor and every drift check — it is one field in one country. The CN and PE pins cover two countries; **for the other 244, nothing does.** Stated plainly. Partial mitigation only: value-set allowlists (plugs ∈ the 13-row table, `drivingSide` ∈ {left,right}, voltage ∈ [100,260], currency ISO-shaped) reject *implausible* values even when single-country, which is what turns `BZ 550/220` into a withhold rather than "Belize runs at 550 V".

**5. Upstream outage vs upstream answering nothing — the Task 7 shape.** Task 7 shipped a data-wipe because an HTTP 200 with a short body was treated as a full answer, deleting 2,559 of 5,118 records in one unattended night at exit 0. Five structural defences, each covering a shape the others cannot see:
- **Per-property demotion and carry-forward.** A property query whose answer covers less than `MIN_PROPERTY_ANSWER_RATIO` of the countries that carried it last run is demoted to a *failed property*; its previous values are carried forward, not deleted, and the run continues. This is the middle of the hazard that throw/no-throw cannot see, and it is the right granularity for a multi-property query where one property routinely times out. (Adopted from the runner-up over the whole-run abort both other designs proposed.)
- **Scope narrowing.** A country absent from a property's answer is never emptied — the single `.filter` whose deletion once left the whole suite green while wiping a country (`enrich-cities.mjs:334`).
- **`notFoundIsEmpty: false` for SPARQL.** A 404 there is an outage, not an empty result (`enrich-cities.mjs:462-468`). Blazegraph's "upstream request timeout" is *expected* on property-path traversals and must never read as an answer.
- **The whole merge computed in memory**, all gates run, and only then the single whole-file write. There is no per-country write loop, so no half-written tree is reachable.
- **`readJson` throws on a file that exists but does not parse** — the `enrich-cities.mjs:587-600` version, never `ingest-cities.mjs:784`'s swallow. That swallow makes `assertSane`'s `if (!previous) return;` skip every drift check, and it is the flaw this repo has already paid for once and still has not fixed in the older script.

**6. Two count-blind failures.** All 246 records surviving while one field goes null everywhere — closed by **per-field coverage floors** (the `assertExtractQualitySane` lesson). One country emptied while the global ratio barely moves — closed by a **per-country field-loss gate with an absolute grace** (the `assertCountryCoverageSane` lesson).

**7. The CN cross-check can redden the nightly job.** A Wikidata edit to China's plugs or voltage fails the build and commits nothing. Accepted deliberately: a silent degradation of the one country known to be correct is strictly worse.

**8. The window where Peru gets worse-looking before better.** Between T23 and T27 a Peru plan is honest but generic. Correct, but it should be stated rather than discovered: land T23 and T27 close together and do not demo in between.

**9. Known test edits, so they are not surprises.** Verified today: `lib/tripShared.test.ts:58,62,72,76` use `"JP"` as the unresearched-currency fixture with the comment *"getCountryProfile("JP").currency is "USD" today — an admitted gap"*. After T27, Japan is `JPY`, so both must move to `"XX"` — a permanently-invalid code, **not another real country**, whose status Wikidata could fix overnight. `countryProfile.test.ts`'s "currency falls back to the documented placeholder pivot" (`expect(xx.currency).toBe("USD")`) becomes `toBeNull()`. `components/trip/MoneyTab.test.tsx:68`'s "Total CNY" legacy guarantee should be *unaffected* — `currencyPivot`'s `?? "CNY"` stays for legacy persisted rows, which `tripShared.ts:23-28` correctly argues is a backfill and not a scope default — but verify rather than assume. `lib/route.test.ts:59`'s helper returns `"unknown"` for any non-estimated leg, so an overland leg would read as unknown there; harmless today because that test is China-only, but named so it is not a surprise.

**10. Bundle weight.** The artifact reaches the browser because `PlanStep.tsx:37-38` generates the preview client-side; serving it server-only would reintroduce the preview/saved-trip disagreement. The Design-3 prototype measured **50,265 bytes** compact for all seven fields across all 246 countries, against `data/country-images.json`'s 6,505 bytes (fine) and `lib/server/cityIndex.ts`'s 3.65 MB (explicitly forbidden from client components). **That figure must be re-measured by the shipping build at T25 before it appears in any comment.** The budget is enforced as a *test*, modelled on `lib/cityShard.test.ts:368-375` — there is currently no byte budget on any `data/*.json`. **The gzipped size is not measured and is not asserted anywhere.**

**11. The hollow test — this repo's recurring killer.** Named failure modes and their closers: (a) the generalised anti-leak loop passes vacuously if the artifact fails to load, so **its iteration count is asserted against a pinned floor**; (b) a forbidden-token scan passes perfectly on an empty page, so **every scan carries a positive half**; (c) a scan that silently matches nothing looks identical to a clean one, so **the same scan is run against a CN plan and asserted to fail**; (d) every fixture is a real Peruvian city with real coordinates from the committed PE shard, a real month, `kids > 0` and `season: winter` — never `cities: []`, never a synthetic country.

**12. Type widening — resolved smaller than either design proposed.** Two judges disagreed on when to land the transport change: early (so the checkpoint is not internally inconsistent — copy saying "Travel to Cusco" over an estimator still scoring rail at 230 km/h) or late (so the widening can be dropped wholesale). **Neither `LegMode` gains `"ground"` nor does `hours` become `number | null`.** Instead `RouteLeg` gains a third variant `{ kind: "overland"; from; to; km }`. Verified today: every consumer narrows *positively* on `kind === "estimated"` — `MapExplorer.tsx:610`, `route.ts:259`'s filter, and 10 sites in `route.test.ts` — so nothing breaks, and `hours` stays `number`, which keeps all 9 measured `.hours` reads compiling unchanged (`MapExplorer.tsx:620,621,625` and `route.test.ts:21,22,202,215,382`, including `expect(aware.hours).toBeGreaterThan(bare.hours)` which a nullable `hours` would fail at `tsc --noEmit`). This makes the change *both* early **and** lower-blast-radius than either proposal. One named consequence: `route.ts:259`'s `totalKm` filter widens to include overland km, or Peru's total distance silently under-counts.

---

## Task breakdown

Gate for every task: `npx tsc --noEmit`, then `npm test`. Current suite: 90 files / 1486 tests, all green.

**T20–T23 close the leak with zero new data and form a shippable checkpoint. T24 is disjoint from them and can be built in parallel.**

---

### T20 — Break the import cycle. Provably behaviour-neutral.
**Goal:** move country data down into zero-import leaves so `itinerary.ts`, `route.ts` and `packing.ts` can read a profile without a cycle.
**Files:** new `lib/countryData/cn.ts`, `lib/countryData/neutral.ts`, `lib/countryData/transportDefaults.ts`; `lib/countryProfile.ts`, `lib/itinerary.ts`, `lib/route.ts`, `lib/packing.ts`, `lib/types.ts`.
`cn.ts` takes `GENERAL_TIPS` (`itinerary.ts:61-67`), the one China packing document, the China `bookingCopy`, hop/departure copy, the kids tip and the "northern air is very dry" line. `neutral.ts` takes `NEUTRAL_PACKING`/`NEUTRAL_TIPS`/neutral `bookingCopy` from `countryProfile.ts:114-150`. `transportDefaults.ts` takes `FLIGHT_THRESHOLD_KM`, `FLIGHT_KMH`, `RAIL_BUFFER_H`, `FLIGHT_BUFFER_H`, `GROUND_TRANSFER_KMH`; `RAIL_KMH`'s China identity moves to `cn.ts`. `itinerary.ts` re-exports `GENERAL_TIPS`; `route.ts` re-exports `TRANSPORT`. `PackingGroup` moves to `lib/types.ts`, re-exported from `packing.ts`. **Delete `CHINA_PACKING` (`countryProfile.ts:73-106`)** — verified byte-identical to `packing.ts:48-78`.
**Test story:** the existing 1486 tests pass with a **zero-line diff in test files** — `itinerary.test.ts:134-141`, `route.test.ts:34-40` and `countryProfile.test.ts:17-33` are the proof and may not be edited. Two new tests: (a) a derived contract reading every `lib/countryData/*.ts` source and asserting zero imports matching `./itinerary|./route|./packing|./countryProfile`, so the cycle cannot regrow; (b) the former duplicate is now one object by import identity.
**Done when:** suite green, test-file diff is zero lines outside the two new tests.

---

### T21 — Route the generators through the seam.
**Goal:** `buildItinerary` and `buildPackingList` read `getCountryProfile(input.country ?? DEFAULT_COUNTRY)`. **No signature changes** — `TripInput.country` is already carried into both (`lib/itinerary.ts:15`), so `planService.ts` and `PlanStep.tsx` are untouched. `DEFAULT_COUNTRY` is one shared constant, not a second `"CN"` literal.
**Files:** `lib/itinerary.ts` (`:188-190`, `:205`, `:212`, `:264-274`), `lib/packing.ts` (`:32`, `:48-78`), `lib/countryProfile.ts` (adds `copy: { kidsTip, winterClothingNote }` and `transport.hopTitle`/`hopNote`/`departureCopy`; `hopTitle` is a template with `{city}`).
**Test story:** CN output byte-identical to today — pin the full tips array and all packing groups for a CN fixture. A PE fixture (real city from the committed PE shard, real coordinates, `kids > 0`, `season: winter`) produces `NEUTRAL_PACKING` + `NEUTRAL_TIPS` and contains none of `Alipay, WeChat, VPN, RMB, ¥, 12306, Trip.com, Amap, Pleco, 高德, China, Chinese` and no codepoint in `[一-鿿]`. **Positive half:** the same fixture has ≥1 day, ≥1 packing group and ≥1 tip — a leak "fixed" by emitting nothing must fail.
**Done when:** both halves green and the CN snapshot is unchanged.

---

### T22 — Make `railKmh: null` load-bearing.
**Goal:** a country with no rail network gets no rail leg, no 🚄 and no rail booking copy.
**Files:** `lib/route.ts`, `components/map/MapExplorer.tsx` (`:610-626` gains an overland branch; `:624`'s binary glyph is untouched inside the estimated branch), `lib/countryProfile.ts`.
Add `{ kind: "overland"; from; to; km }` to `RouteLeg`. `estimateLeg`/`suggestRoute` gain an optional `transport?: TransportProfile` defaulting to today's constants. When `railKmh === null`: flight if the airport pair resolves and wins door-to-door, otherwise `overland` with km and no hours. `route.ts:297`'s hardcoded note becomes `transport.bookingCopy`, emitted only when `railKmh !== null`. `route.ts:259`'s `totalKm` filter widens to include overland km.
**Test story:** every existing `route.test.ts` case passes **with no edit** — that is what the default parameter buys, and it is the proof the CN path is untouched, including the exact 6.5 h airport-aware / 6.0 h legacy pins for Beijing → Ürümqi at `:215` and `:382`. New: a PE fixture with LIM and CUZ in the airport list returns `mode: "flight"` with real hours; a PE fixture with no airport in range returns `kind: "overland"` with a real km and no `hours` property; no PE fixture ever returns `mode: "rail"`; the all-rail note is never emitted for PE; `totalKm` counts the overland leg.
**Done when:** `tsc --noEmit` clean with zero edits to `route.test.ts`.

---

### T23 — The picker surfaces and the season-derivation bug.
**Goal:** stop the Peru map showing Chinese New Year and China's crowd curve, and make the wizard preview agree with the saved trip.
**Files:** `components/map/MonthTimeline.tsx` (gains `country`), `components/map/PlacePopup.tsx:38-39`, `components/map/MapExplorer.tsx:570,588` (has `countryCode` at `:184`), `app/plan/page.tsx:315`, `lib/countryProfile.ts` (`crowdByMonth: number[] | null`), `lib/countryProfile.test.ts` (two pins).
**Test story:** jsdom render of `MonthTimeline` with `country="PE"` asserts no "Chinese New Year", no 🧧, no 🇨🇳, no band list **and no crowd element at all** (not a flat ●●●○○). The same component with `country="CN"` still renders four bands and the 12-month curve — **the prop must be load-bearing in both directions, or the assertion is not armed.** A wizard test asserts a June Peru selection previews **winter** and the saved trip agrees. Plus: every profile satisfies `crowdByMonth === null || length === 12` — the guard TypeScript cannot give and nothing at runtime does.
**Done when:** both directions green.

> **Checkpoint.** The China leak is closed. Peru is honest and thin. Everything after this is enrichment.

---

### T24 — The ingest: pure build and gates. No network.
**Goal:** `scripts/ingest-country-facts.mjs` with every pure function and one exported throwing `assertFactsSane(built, previous)`.
**Files:** `scripts/ingest-country-facts.mjs`, `scripts/ingest-country-facts.test.ts`.
Follows the `ingest-cities.mjs` skeleton verbatim: header doc-comment (what / why / idempotent / aborts-before-writing / licence / usage / Node type-stripping caveat), `// ---` banners in the house order pure-parse → pure-build → gate → paths/sources/network → writing → report → fetchers → `run()` → entry guard. `node:fs|path|url` only. Reuses `fetchSource` (`ingest-cities.mjs:744`), `writeFileAtomic` (`:771`, an acknowledged fourth verbatim copy with the Windows-rename comment, since build-time logic may not live in `lib/`), `stampedPayload` (`:832`) and the entry guard (`:1085`). **Uses `enrich-cities.mjs:587-600`'s `readJson` that throws on exists-but-unparseable.** `mkdirSync` goes **below** the gate, fixing the tracked finding at `ingest-cities.test.ts:1339-1341`.
`assertFactsSane`, in this order: two-sided country-count band (never a bare floor — a floor cannot bound a first run where `previous === null`); required-key fixtures a count cannot see (CN, PE, JP, CH non-empty; one known-sparse country present *with fields absent*); per-record shape (alpha-2 regex, no empty strings, no sentinel leakage, bounded lengths); the four landmine gates; the CN cross-check; per-field coverage floors; **then** `if (!previous) return;` and the drift checks — no country loses all facts, `MAX_SHRINK_RATIO`/`MAX_GROWTH_RATIO` 0.10, per-country field-loss with an absolute grace. Plus the per-property demotion/carry-forward logic as a pure function.
**Test story:** one test per landmine built from the **measured** upstream shape — `BZ 550/220`, `FR 400/230`, `NL EUR/USD/AWG/XCG`, `CZ CZK/203`, `PL PLN/PLZ`, `ZW` ×13, Q60740126 — each asserting a withhold, plus an assertion that **zero countries have Q60740126 as their sole plug value**, so a future upstream edit that breaks that fails the build. Each `CURATED_FACTS` override asserted to actually fire. Then a `run()` block driving the real `run({ fetchBindings, dataDir })` with injected loaders and `vi.mock("node:fs", importOriginal)` replacing **only** `writeFileSync`/`renameSync` with spies, asserting `not.toHaveBeenCalled()` on a corrupt feed rejected for a *genuine* reason. **No source-position grep test** — `ingest-cities.test.ts:1263-1276` records four mutations that keep one green while a corrupt feed reaches disk.
**Done when:** every gate branch has a test and the `run()` spy asserts no write on each.

---

### T25 — Network layer, first real build, measured constants.
**Goal:** run it, commit the artifact, back-fill every constant with a measured value and its date.
**Files:** `scripts/ingest-country-facts.mjs` (fetchers, `run()`), `data/country-facts.json`, `data/country-facts-report.md`, `lib/countryFacts.test.ts`.
Per-property SPARQL batching with named batch sizes and politeness delays; `fetchWithRetry` honouring `Retry-After` capped at `MAX_RETRY_AFTER_MS`; `notFoundIsEmpty: false` for SPARQL; a justified `SPARQL_TIMEOUT_MS`. Envelope `{ generatedAt, source, license, countries }` keyed by uppercase alpha-2. Report is a pure `buildReport({ countries, generatedAt })` with no per-run counts, a **"Not derivable"** section carrying the measurement that justifies each refusal, a table ranking countries by fact count, and the `## Attribution` section stating CC0 and no UI credit.
**Reconcile the two coverage discrepancies** (driving side and latitude 246 → 245; currency 244 → 234) and record the shipping query's own figures. Measure `officialLanguages` post-withhold — currently unverified.
**Test story:** `lib/countryFacts.test.ts` under `describe.skipIf(!hasAssets)` (`lib/cityShard.test.ts:325` precedent): 246 records; **CN reproduces `CNY` / `["A","C","I"]` / `220` / `right` / `+86` / `110` police, `119` fire, `120` EMS**; **PE reproduces `PEN` / `["A","B","C"]` / `220` / `right` / `+51` / `105`, `116`, `106`**; per-field coverage floors; a byte budget set from the measured build (prototype measured 50,265 bytes — **re-measure, do not carry the number forward untested**); **at least one country has an absent field**, proving gaps are real; and the `SOUTHERN` cross-check (every code has negative `lat` or is on the named exception list).
**Done when:** the artifact and report are committed and every `EXPECTED_*` / `MIN_*` / byte constant carries a value produced by the shipping query plus the date it was produced.

---

### T26 — Facts become sentences.
**Goal:** `lib/countryFacts.ts` (typed reader, boundary validator that **drops** malformed records rather than repairing them, `CURATED_FACTS`, copy-on-read) and `lib/countryTips.ts` (fixed templates + the gap note). Nothing wired yet.
**Files:** `lib/countryFacts.ts`, `lib/countryTips.ts`, `lib/countryTips.test.ts`.
`countryFacts.ts` mirrors `lib/countryImagery.ts:1`'s static-import structure and copies on read so `countryProfile.test.ts:45-50`'s fresh-object contract survives a shared JSON import.
**Test story:** golden-output tests for PE, CN and a deliberately sparse country. **The reproduction gate**: the plug template fed CN's ingested facts emits `Universal power adapter (China uses type A/C/I plugs, 220V)` character-for-character. Parameterise over **every field being individually absent** and assert no template ever emits a partial sentence, a hedge or a placeholder. A zero-fact country produces zero fact-tips and only the gap note. The gap note's second line names exactly the absent fields and is absent entirely when all six are present.
**Done when:** every template has a golden test and an each-field-absent test.

---

### T27 — Data-driven `getCountryProfile`, and currency becomes a fact.
**Goal:** three-way dispatch — CN → the hand-written profile untouched; facts present → `factsProfile`; else → `neutralProfile`. `currency: string | null`. `gapNote: string[]` added.
**Files:** `lib/countryProfile.ts`, `lib/tripShared.ts:47,173`, `lib/countryProfile.test.ts`, `lib/tripShared.test.ts`, `lib/money.test.ts:156`.
`isCurrencyResearched` keeps its name, its docblock and both call sites; its body becomes `getCountryProfile(code).currency !== null`. **Changing one without the other turns an honesty predicate into a false claim** — that is why they land together.
**Test story:** `countryProfile.test.ts:17-33`'s CN pins pass **unchanged** — that is the ingest's self-check, not a test to relax. `:45-50` fresh-object and `:110-115` totality on `["", "   ", "CHN", "🙂", "constructor"]` pass. `countryProfile.test.ts:86-93`'s anti-leak test is promoted from `"XX"` alone to a **loop over every country in the artifact**, scanning `JSON.stringify({ tips, packing, gapNote, transport.bookingCopy, holidays })` for `Alipay, WeChat, VPN, RMB, ¥, 12306, Trip.com, Amap, Pleco, 高德, China, Chinese` and any CJK codepoint — **with the loop's iteration count asserted against a pinned floor**, or it passes vacuously when the artifact fails to load. Separately: **PE's profile is not byte-equal to the neutral default**, which is what proves the ingest ran for it. `getCountryProfile("JP").currency === "JPY"`; `getCountryProfile("XX").currency === null`; `isCurrencyResearched(c) === (currency !== null)` swept. The four `"JP"` fixtures in `tripShared.test.ts` move to `"XX"`.
**Done when:** the sweep is armed (iteration floor asserted) and both halves pass.

---

### T28 — Render the gap note.
**Goal:** the honesty surface reaches the user.
**Files:** `components/PlanStep.tsx` (tips panel), `components/trip/PlanTab.tsx:235`, `components/trip/BriefingView.tsx:175`.
Computed at render time from the trip's country via `tripCountry(data)` — **never snapshotted into `plan`**, because it is a statement about our current data, not about the trip, and it must shrink as coverage improves. Styled as a muted note, structurally distinct from a tip.
**Test story:** jsdom render for PE shows the note; for CN shows nothing (`gapNote: []`); for a sparse country shows both lines with the correct field names. The note is not inside the tips list element.
**Done when:** all three surfaces render it and CN renders none.

---

### T29 — Nightly.
**Goal:** the artifact refreshes unattended and fails closed.
**Files:** `.github/workflows/refresh-cities.yml`.
A third ingest step in the **existing** job, after enrich and before the existing `npm test` verify step — not a fourth workflow, because this job already carries `concurrency: group: refresh-data` shared with `refresh-airports.yml`, and a new group name would let two commit jobs overlap into a non-fast-forward push. `data/country-facts.json` joins the `git status --porcelain -- <paths>` change test (not `git diff --quiet` — an untracked new file is invisible to it) and `git add`; `data/country-facts-report.md` joins `git add` only, matching `data/cities-report.md`. Introduces no new outage coupling: `enrich-cities.mjs` already depends on Wikidata.
**Test story:** not automatable. One manual `workflow_dispatch` run recorded, plus a deliberate failure injection (unreachable host) confirming the job goes red and commits nothing.
**Done when:** both runs are recorded in the PR.

---

### T30 — The Peru acceptance gate. This is Task 19 with teeth.
**Goal:** prove the whole thing, in both directions.
**Files:** `lib/worldwidePlan.test.ts` (node), `components/plan/worldwidePlan.test.tsx` (jsdom).
Build a full Peru trip from a real Peruvian city with real coordinates taken from the committed PE shard, a real month, `kids > 0`, `season: winter` and real airports. Serialise plan + packing + route notes + tips + gap note + briefing.
**Negative half:** contains none of `China, Chinese, Alipay, WeChat, VPN, RMB, ¥, 12306, Trip.com, Amap, Pleco, 高德, high-speed rail, 🚄, 🧧, 🇨🇳` and no codepoint in `[一-鿿]`.
**Positive half:** contains `PEN`, `220`, `type A`, `105`, `+51`, `Spanish`, a transport mode, ≥1 day and ≥1 route leg.
**Arming proof:** the identical scan run against a CN plan **asserts that it fails** — a scan that silently matches nothing cannot pass.
The jsdom sibling does the same over the rendered wizard, trip page and the public briefing at `app/b/[code]/page.tsx`, because `plan.tips` reaches an unauthenticated surface via `briefing.ts:182`.
**Done when:** all three assertions (negative, positive, arming) are green.

---

### T31 — Plan-path branding text.
**Goal:** the two on-plan strings and the browser title. Text only.
**Files:** `components/PlanStep.tsx:56,59` (the `启程` chop → `getCountry(...).mark`, matching what `TripView.tsx:236` already does correctly, and `<h2>Your China itinerary</h2>` → country-derived), `app/layout.tsx:27,29`, `app/trip/[id]/page.tsx:5`.
**Explicitly not** `globals.css`'s `.font-kai`, not `TicketsTab`/`ExpenseForm`/`AppShell`/`TripsDashboard`, not a tree-wide CJK scan.
**Test story:** a `PlanStep` render for `country="PE"` asserts no CJK codepoint and no "China"; the same render for `country="CN"` asserts `启程` still appears — **arming proof in both directions.** Folded into T30's derived scan so the wizard surface is covered by the same assertion as the plan.
**Done when:** both directions green.

---

### T32 — Measured-number audit and the `bestSeasons` measurement.
**Goal:** every number added by T20–T31 was produced by running something.
**Files:** `scripts/ingest-country-facts.mjs` docstrings, `data/country-facts-report.md`, comments across the touched `lib/` files.
A final pass over every comment, report line and docstring confirming each figure has a run behind it and a date. Explicitly re-state what was **not** measured: the gzipped artifact size is not asserted anywhere.
Separately, **measure only**: which cities `lib/server/catalog.ts:367,400`'s blanket `bestSeasons: ["spring","autumn"]` stamp affects, and what removing it would do to the map tint (`mapTypes.ts:61`) and `scoreActivity` (`itinerary.ts:75`) for curated China cities. Record the numbers in the PR description for Task 19's plan to act on. **No change to `catalog.ts` in this task.**
**Done when:** the audit is complete and the `bestSeasons` measurement is recorded.

---

**Dependencies:** T20 → T21 → T22 → T23 → checkpoint. T24 is disjoint and parallel to T20–T23. T24 → T25 → T26 → T27 → T28. T29 after T25. T30 after T28. T31 free-floating. T32 last.

**This project's history says defect eleven will live in the plan's prescribed code, not the implementation.** The three most likely homes for it here are: the generalised anti-leak loop passing vacuously (closed by the iteration floor in T27), the `hours` type looking safe when it is not (closed by adding a variant instead of widening, T22), and a coverage figure carried forward from a prototype instead of re-measured (closed by T25 and audited by T32).