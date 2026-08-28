# Phase 4 — country and region levels for every country

**Date:** 2026-08-29
**Status:** design, awaiting review
**Supersedes:** §6 of [2026-08-23-global-expansion-design.md](2026-08-23-global-expansion-design.md)
**Scope:** reversing judgement call J14 — a real country level (L2) and admin-1
region level (L3) for every country, plus the airport map layer, trip gateways,
and the worldwide climate data all three of those need to not be grey.

---

## 1. Why this document exists

The roadmap said each phase gets its own design when the phase before it lands,
"because the code will have changed by then." It had. §6 was written on
2026-08-23, before the globe (PR #17) and the worldwide city catalog (PR #21,
merged 2026-08-28) shipped, and three of its load-bearing claims aged badly.

A survey of 79 claims against current `main`, each re-checked by an independent
agent instructed to refute it, corrected 18. Two further measurement runs
acquired Natural Earth 10m and CHELSA V2.1 and replaced §6.2's unverified size
table with real numbers.

**Everything below that carries a number was measured.** Anything not measured
is labelled `UNMEASURED` and must not be used to size, gate, or budget.

---

## 2. What the roadmap got wrong

> **Reference convention:** every bare `§n` in this section refers to
> [2026-08-23-global-expansion-design.md](2026-08-23-global-expansion-design.md),
> the document being superseded. Everywhere else in this file, `§n` means a
> section of *this* file. The two numbering schemes overlap — the roadmap has a
> §6.1 and so does this design — so the distinction matters.

### 2.1 The surface Phase 4 was going to delete is the best one in the app

§1.3 describes non-China countries as rendering "a flat list of buttons with no
geometry," framed as the deficiency Phase 4 removes. Today
`CountryPlaceList` ([CountryMap.tsx:114](../../../components/map/CountryMap.tsx))
serves **249 codes**, **246 of them populated** from the Phase 3 shards, as real
`<button aria-pressed>` chips at `min-h-[var(--tap-min)]` — keyboard-reachable,
screen-reader-listable, with honest copy.

What §6.1 replaces it with is what `ChinaLevel` does: SVG circles of radius
4.5–9 in an 860-wide viewBox — **~3.7 CSS px on a 390px phone** — carrying
`tabIndex={-1}` for every non-curated place. Outside China every place is
non-curated, so China's *zoomed* view already has **zero tab stops among ~1,067
markers**. The hole is invisible today only because 245 countries get the list
instead.

The repo already rejected this shape in writing.
`worldLevelShared.tsx:160-170`: per-marker tab stops are "indefensible for 235",
which is why L1 has roving tabindex *and* an A–Z `CountryPicker`. §6 proposed L2
with neither.

**Resolution: the list survives as the accessibility spine (§5.2).**

### 2.2 The counts do not exist

§6.1 says 234, §6.2 says 241. Neither is a real set. Measured:

| Set | Count |
|---|---|
| ISO table, `lib/countries.ts` | 250 |
| `public/world-countries.json` (50m) | 235 polygons + 76 points |
| `public/world-globe.json` (110m) | 174 polygons + 77 points, same 235 codes |
| NE 10m `admin_0_countries` | 258 features, 239 alpha-2-keyable |
| NE 10m `admin_0_map_units` | 298 features, 237 alpha-2-keyable |
| NE 10m admin-1 | 4,596 features (**roadmap's figure confirmed**) |
| City shards, `public/cities/` | **246** countries, 58,746 cities |
| Codes with an outline and zero cities | 4 — AQ, BV, HM, UM |

**Phase 4 emits 246 files**, one per code that has a city shard. That predicate
is the one the app already uses everywhere else, and it excludes the four
uninhabited codes — drilling into Antarctica opens an empty room by
construction.

### 2.3 The 13 "undrawable" countries were never undrawable

`SEARCH_ONLY` lists 13 codes with real cities and no drawable feature: XK (77
cities), YT (66), RE (28), GP (25), MQ (23), GF (20), TV (12), BQ (10), GI (7),
CC, CX, SJ, TK. This is a **50m resolution artefact**, not missing data. At 10m,
`admin_0_map_units` has a dedicated feature for all 13, and every one has ≥1
admin-1 unit.

Two repo comments are simply wrong and should be corrected in the same commit:

- `lib/isoTopology.ts:65` — "Tokelau has no 50m feature." Tokelau **is** drawn at
  50m, as two unkeyed polygons (2.9 km² and 2.2 km²) inside the New Zealand
  feature, at (−172.487, −8.564) and (−171.196, −9.344).
- The claim that Cocos and Guadeloupe have no admin-1 feature. GP is `FRA-4603` /
  `FR-GP`, a 6-part MultiPolygon; CC is `IOA-1928`, reachable via `gu_a3 = CCK`.

### 2.4 The projection problem is differently shaped than §6.1 says

§6.1 names five antimeridian countries and prescribes "a per-country projection
rotation, chosen at build time from each country's `geoBounds`." Both halves
need correcting.

**The prescribed rotation is a no-op on the country it names first.** Fiji's
feature is split at ±180, so `geoBounds` returns the degenerate
`[[-180, …], [180, …]]` and a mean-of-bounds rotation is 0°.

**The dominant failure is not the antimeridian, it is remote territory.**
Fitting the whole multipart feature mis-fits **29 countries by ≥3×**. France
fits at scale 409 instead of 2,683 because French Guiana and Réunion are in the
same feature; the Netherlands at 637 instead of 7,846 because of Bonaire, Saba
and Sint Eustatius. Under §6.1 as written, opening the Netherlands shows the
Randstad as a smudge with the Caribbean in the corner.

**But a 114-step rotation search is unnecessary.** In Mercator, λ-rotation is a
horizontal translation, so the optimum is analytic — the negated centre of the
minimal covering longitude arc. Measured agreement with brute-force search:
**worst deviation 0.000000% across all 235**.

### 2.5 §6.2's size table is uniformly high, by +2% to +23%

| Roadmap | Measured |
|---|---|
| median 21 KB | **20,507 B** |
| p90 88 KB | **77,196 B** |
| JP 114 / FR 151 / PE 65 / MA 23 KB | **97,613 / 123,648 / 59,426 / 21,332 B** |
| RU 821 / CA 719 / US 447 / CN 331 KB | **696,023 / 633,973 / 363,661 / 295,239 B** |
| all together 10.1 MB / 3.4 MB gz | **9,287,143 B / 3,202,628 B** |

Mean overstatement ≈ +13%, with no single factor explaining the spread, so the
roadmap's pipeline cannot be reconstructed. **None of its numbers may be carried
into an assertion.**

Two framing errors in the same table: the "four heavy countries" are actually
**eleven** over budget (RU CA US CN ID BR AQ GL IN GB CL), and the worst
*gzipped* country is **CA (193,433)**, not RU (192,376).

### 2.6 Smaller corrections

- **There is no migration layer** for §6.4, and none is needed — trips are a
  whole-blob JSON/`jsonb` column with an `as TripData` cast, and commit
  `0cfd0a9` is a written argument against bulk-rewriting them.
- **`useTripPayload` needs zero edits** — it is field-agnostic. The real site is
  `components/TripView.tsx:89-114`.
- §8's `vi.mock("next/dynamic")` warning **was already fixed by Phase 2** in both
  sites, and now throws on ambiguity.
- §8's "`FIT_COLORS` is the deliberate categorical exception" is **no longer
  true** — `worldLevelShared.tsx:368` is a second reasoned hex exception.

### 2.7 The gap §6 never mentions, which is the largest real one

`MAX_LIST_PLACES = 60`. **150 of 246 countries are truncated.** Peru's shard
holds 750 cities and 690 are unreachable from the map surface. Every city
already carries `a1` — an admin-1 display name, 99.25% populated, 3,782 distinct
`(country, a1)` pairs — so grouping is possible today with **zero new data**.

---

## 3. Decisions

Recorded with who decided, because several are product calls rather than
engineering ones.

| # | Decision | Decided by |
|---|---|---|
| D1 | Full §6 scope: L2, L3, airport layer, and trip gateways all ship | user |
| D2 | L2 is map **plus** list; the list is the accessibility spine and gains admin-1 grouping and a filter | user |
| D3 | Gateways anchor `suggestRoute` **only when user-set**; the default path is unchanged | user |
| D4 | Worldwide climate normals are in scope, and the three fit-model failures are fixed **before** fit colours ship | user |
| D5 | ISO 3166 is the single territory rule, encoded as named overrides | user |
| D6 | The province file is also the outline file (`merge()`), so L2 and L3 share one fetch | this design |
| D7 | China keeps its curated 58 KB topology, re-enveloped | measurement |
| D8 | City→province assignment is build-time point-in-polygon, `a1c` as fallback | measurement |
| D9 | Jan Mayen unions into `SJ` (ISO 3166 SJ is "Svalbard and Jan Mayen") | this design, following D5 |
| D10 | The 34 single-unit countries get no L3 affordance | this design |
| D11 | Airport layer toggle is ephemeral state, not a `UserPrefs` field | this design |
| D12 | The airport line reads "Main airport", not "Nearest" | this design |

---

## 4. Architecture

### 4.1 One artifact family (D6)

`topojson-client`'s `merge()` turns a country's admin-1 geometries into its
country outline. So L2's outline and L3's units come from the **same file and
the same fetch**:

```
public/provinces/XX.json  ──merge()──▶   L2: country outline
     (246 files)          ──features─▶   L3: admin-1 units
                          ──cityProvince▶ which city sits in which unit
```

This is not only a byte saving. It removes a whole class of defect: an outline
sliced from `admin_0` and provinces sliced from `admin_1` are different
generalisations of the same coastline, so province edges would not lie on the
country edge. Merged, they agree by construction.

### 4.2 The five subsystems and their order

| PR | What | Depends on | Ships value alone? |
|---|---|---|---|
| 1 | Ingest: persist `a1c` and `elev` in city shards | — | no (enabler) |
| 2 | L2 list upgrade: `a1` grouping, filter, no 60-cap | — | **yes — fixes 150 countries** |
| 3 | `build-provinces.mjs`, 246 province files, projection manifest | 1 | no (artifact) |
| 4 | L2 map: outline, markers, registry, selected-place card | 3 | yes |
| 5 | L3: third map level, province zoom, China regions as grouping | 4 | yes |
| 6 | Climate ingest + corrected fit model | 1 | no (artifact) |
| 7 | Climate in the UI: fit colours worldwide | 5, 6 | yes |
| 8 | Airport map layer | 4 | yes |
| 9 | Trip gateways | 8 | yes |

PR2 is deliberately first among the user-visible work: it is the largest real
improvement, it needs no new data, and it establishes the list-as-spine
invariant before any geometry can tempt anyone to delete it.

---

## 5. L2 — the country level

### 5.1 The registry

`hasDetailLevel(country) === "CN"`
([CountryMap.tsx:55](../../../components/map/CountryMap.tsx)) becomes a
`COUNTRY_DETAIL` registry resolved from `public/provinces/index.json`. Note the
shape drift since the roadmap: the comparison is no longer an inline `=== "CN"`
literal but a `DETAILED_COUNTRY` export with normalisation, so a grep for the
literal misses it.

Two consumers change together:

- `MapExplorer.tsx:187`, plus the data effect at `:224`/`:285` and four render
  branches at `:499`, `:512`, `:536`, `:588`.
- `RouteMap.tsx:121` — **the trip-page map, on a guest-reachable surface**, which
  fetches `/china-provinces.json` directly at `:128` and draws only bundled
  curated CN destinations at `:55-80`. It is blank today for every worldwide
  trip. Any registry change that skips it leaves that blank.

### 5.2 The list stays and improves (D2)

`CountryPlaceList` gains:

- **Grouping by `a1`**, using data that already exists in the shards.
- **A filter input**, which is what actually makes 750 cities navigable.
- **Per-group caps replacing `MAX_LIST_PLACES = 60`**, so Peru's remaining 690
  cities become reachable.

Selection is shared with the map; the list is the source of truth for the
accessibility tree. The map is a backdrop that **never becomes the only way to
select a place** — this is the invariant, and §12.2 makes it testable.

### 5.3 Three accessibility fixes that opening 245 countries makes load-bearing

1. **Roving tabindex on markers**, porting `useCountrySelection`'s
   `tabStop`/`activeCode`/`refocus` pattern from `worldLevelShared.tsx`.
2. **Transparent hit circles sized to `--tap-min`** behind each marker. Visual
   radius stays 4.5–9 (`radiusFor`, `CountryMap.tsx:250-255`); the *target*
   becomes 44 CSS px at the current scale.
3. **A real selected-place card.** `PlacePopup` is `role="tooltip"`,
   `pointer-events-none`, and positioned from `onMouseEnter`/`onMouseMove` only —
   it has no touch story at all. The "selected city's card" the roadmap's §6.4
   assumes it can add a line to **does not exist anywhere in the map layer**.
   The card is a net-new surface with focus and dismiss semantics, and it is
   where the climate `lo`/`hi` line and the airport line live.

### 5.4 Projection manifest

Committed `country-projections.json`. The figures below were measured on the 50m
admin-0 source: 235 entries, **20,939 B minified / 7,438 B gzipped**, mean
89.1 B/entry. Under D6 the rendered geometry is the merged 10m province set, so
**the manifest is regenerated against that and re-verified** — the rule, the
gates and the entry shape are settled, the specific values are not. See §14.5.

```json
"ZA": { "rotate": 0,
        "bounds": [[16.4468,-34.7854],[32.8845,-22.1456]],
        "scale": 2383.2504,
        "hidden": [{"lon":37.738,"lat":-46.899,"km2":243.1}],
        "hiddenAreaPct": 0.02 }
```

`bounds` is in the **rotated** frame. No polygon index list — NE indices are
unstable across a refresh, and `bounds` recovers the retained set losslessly
(verified for all 235 at 1e-3). `scale` is redundant by construction, which is
the point: it is the committed expected value the build-time test recomputes.

**The rule:**

1. λ = −centre of the minimal covering longitude arc, or 0 if that arc does not
   cross ±180.
2. **Trajectory trim** — repeatedly drop the extent-driving polygon whose removal
   leaves the largest scale, then take the best point on the *whole* trajectory,
   not the first improving step. A per-step gate fails on clustered outliers:
   NL's three Caribbean polygons each gain ≈1.1× alone and **11.5× together**.
3. **Gate A** — ≤1% of the country's land may be hidden.
4. **Gate B** — separation ≥0.5, measured from the polygon to the **anchor**
   (largest polygon), never to the residual keep set.
5. Accept only if gain ≥1.5×.

Both gates are load-bearing and both were measured failing otherwise: area
budget alone **hides Tasmania** (64,158 km², 0.83% of AU) and **Stewart Island**
(1,635 km², 0.61% of NZ); separation against the residual set lets outliers
shield each other and loses NL's 11.5× entirely.

**The accepted list is 5 of 235, complete:**

| code | hidden | % area | scale before → after | gain |
|---|---|---|---|---|
| NL | 3 | 0.681% | 636.89 → 7327.81 | 11.51× |
| NZ | 4 | 0.197% | 643.27 → 2015.62 | 3.13× |
| FJ | 6 | 0.863% | 3556.00 → 10925.12 | 3.07× |
| ZA | 1 | 0.020% | 1123.21 → 2383.24 | 2.12× |
| NC | 1 | 0.381% | 5863.54 → 11737.39 | 2.00× |

Hidden geometry, in full: **NL** Bonaire 223.7 km², Saba 22, Sint Eustatius 7.2.
**ZA** Prince Edward Is. 243.1. **NC** Chesterfield 71.1. **NZ** Auckland Is.
441.6, Campbell 80, and two polygons of 2.9 and 2.2 km² that are **Tokelau,
drawn inside the NZ feature** (§2.3).

**The US needs no trim.** Rotation alone takes it from 1.913% to 16.876%
coverage — better than Chile (2.91%) or Norway (3.97%) get untouched.

**Primary-landmass-only is prohibited**, and no insets live in this artifact: an
inset is a render-time layout decision (second projection, second viewBox,
label, frame), and shipping one inside a projection manifest would misdescribe
the file. The 34 countries the gates refuse are carried untrimmed with the
diagnostic naming the price, so the editorial call is visible rather than
silent.

**Twelve countries are unfixable by any projection** (final coverage): KI
0.007%, FM 0.010%, SH 0.017%, MH 0.047%, PW 0.091%, MP 0.103%, PF 0.103%, TO
0.301%, WF 0.364%, MV 0.374%, TF 0.519%, GS 0.890%. These need point markers, as
`smallCountries` already does — not a manifest entry.

### 5.5 The renderer trap that cost a full measurement pass

```ts
const l = e.rotate, [[x0,y0],[x1,y1]] = e.bounds, xm = (x0+x1)/2, c = [];
for (const x of [x0,xm,x1]) for (const y of [y0,y1]) c.push([x-l, y]);
geoMercator().rotate([l,0,0]).fitExtent(BOX, { type:"MultiPoint", coordinates:c })
```

**Do not use a GeoJSON `Polygon` rectangle.** d3-geo reads rings spherically, so
a clockwise rect is *the globe minus the rect* and every fit collapses to
`600/(2π) = 95.49`. Use three longitudes, not two, so corner order stays
unambiguous as spans approach 180°.

---

## 6. L3 — provinces

### 6.1 The level

`MapLevel` gains a third member. `zoomRegion: ChinaRegion | null`
(`CountryMap.tsx:76`, the J14 site — note the anchor has drifted from the
roadmap's `:66` to **`:70-76`**) widens to a region identifier resolved through a
per-country provider.

Blast radius, measured: two prop consumers (`MapExplorer.tsx:566`,
`RouteMap.tsx:171` which hard-codes `null`), plus `lib/months.ts:132`'s
`Record<ChinaRegion, …>`, `lib/provinces.ts:11,61-66`, and the `isChinaRegion`
narrowing at `mapTypes.ts:45-47` that `PlacePopup.tsx:39,65` depends on.

### 6.2 Degenerate bounds

`transformForBounds` deliberately does not guard zero-extent input, and its
docblock says why: "callers zoom to a region they know has features, and
inventing a fallback here would hide the caller's bug." **That stays.** The
guard goes at the call site — `CountryMap.tsx:222` calls
`transformForFeatures(pathGen, regionFeatures)` on a filter that can legitimately
return one feature.

One correction to the roadmap: a *single province* has non-zero extent, so it
never produces `860/0 = Infinity`. It pins to `MAX_ZOOM_K` through the ordinary
ceiling branch, which is separately and deliberately tested
(`mapTransform.test.ts:136-149`). Only a genuine single **point** divides by
zero.

### 6.3 China keeps its curated topology (D7)

Measured side by side:

| | committed `china-provinces.json` | NE 10m CN slice |
|---|---|---|
| bytes | **58,650** raw / 20,183 gz | 295,239 raw / 89,578 gz |
| features | **35** | 32 |
| vertices | 5,823 | 33,768 |
| names | Chinese (`北京市`) | English, Chinese in `name_zh` |
| join key | `adcode` (GB/T 2260) | `iso_3166_2` |

The province sets are not the same: the committed file is 31 mainland units plus
Taiwan, Hong Kong, Macau and `100000_JD`, the **nine-dash line**. NE carries no
nine-dash line anywhere — it treats the Spratlys as their own `adm0_a3 = PGA`
and the Paracels as a Chinese province. Forced to parity at 5,824 vertices, the
NE slice is *still* 10.5% larger raw and 16.4% larger gzipped.

`public/provinces/CN.json` is therefore a **re-envelope of the committed curated
topology**. Because the id scheme differs, the index entry carries
`idKey: "adm1_code" | "adcode"` and the loader reads it rather than assuming.
`CountryMap.tsx:196` already does `Object.keys(topology.objects)[0]` and never
mentions `china_full`, so a per-country object key already parses.

Two China traps:

1. **Never match China provinces on `name_alt`.** `foldPlaceName` strips NFD
   combining marks, so `Shǎnxī` (`CN-SN`, Shaanxi) and `Shānxī` (`CN-SX`,
   Shanxi) both fold to `shanxi`. Adcodes 140000 and 610000 then both resolve to
   the Shaanxi polygon and `CN-SX` is orphaned — one province silently drawing
   the wrong outline, in the country the app is named after. Match on `name` +
   `name_en` (32/34, no collisions), or key on `gn_a1_code` / `wikidataid`.
   **Ship a regression test asserting 140000 and 610000 resolve to different
   polygons.**
2. `ProvinceProps` declares `adcode: number`, but the real asset carries the
   string `"100000_JD"` for the nine-dash line. Widen the type.

### 6.4 China's seven regions become a grouping above admin-1

L3 is uniformly admin-1. China's 7 curated regions — the only ones with
month-by-month climate data — become an optional grouping *above* it, preserved
verbatim. `REGION_MONTHS` is not re-keyed and not re-derived (§9.5).

### 6.5 City→province assignment (D8)

Three mechanisms, measured over 3,782 `(country, a1)` pairs and 58,746 cities:

| mechanism | pairs | city-weighted | countries at zero |
|---|---|---|---|
| name join | 2,397 = **63.38%** | 66.24% | **35** |
| code join (`gn_a1_code`) | 3,211 = 84.90% | 86.35% | 34 |
| **point-in-polygon** | — | **96.08%**, 0.00% ambiguous | — |

**The name join is dead**: a third of provinces fail, 35 countries score
literally zero (BF BQ CI DM GB GF GG GP GU IE IM JE KE KI KY LK MC MH MO MQ MW
NA NP PR RE RS SJ SK SR TF TK TV UG VC YT), and the failures concentrate in
Great Britain, Ireland, Kenya, Puerto Rico, Sri Lanka and Nepal.

**Point-in-polygon is primary**, computed at build time and written into the
province envelope as `cityProvince: Record<cityId, adm1_code>`. Of the 20,124
cities whose pair failed the name join, **19,229 (95.55%) land in a polygon
anyway** — containment does not care that GeoNames says "England" and Natural
Earth says "Shropshire".

**`a1c` is still mandatory** (§11), for the two things containment cannot do:
verify the geometric assignment, and cover the **2,301 cities (3.92%)** that fall
inside no polygon at all.

Cross-validated on the 37,438 cities both joins hit: name agrees with
containment 97.24%, code 96.11%. The residual is a hierarchy mismatch no key can
fix — GeoNames holds NUTS-1-style regions (`GB.ENG` England, 513 cities;
`BE.VLG` Flanders, 438) where NE holds NUTS-2/3 provinces.

**`iso_3166_2` is never a primary key**: 4,501 distinct values over 4,596
features, **60 codes reused** (worst `PH-MNL` ×17), and 12 features carry
`-99-X##~` placeholders including two of the 13 targets (CC, CX). Feature `id` is
`adm1_code`; carry `gn_a1_code` and `iso_3166_2` as properties.

### 6.6 Single-unit countries (D10)

34 countries have exactly one admin-1 unit, where L3 would be identical to L2.
They get **no L3 affordance**, gated on `index.countries[].count <= 1` rather
than a hard-coded list. The file is emitted anyway so the loader needs no special
case.

This matters more than redundancy: NE names the Faroes' single unit
**"Eysturoyar"** — one island — so an L3 label there would be *actively wrong*.
`KI-X02~` additionally has a **null `name`**. Label correctness for the other 33
is `UNMEASURED`.

---

## 7. Territory policy (D5)

ISO 3166 is the single rule, encoded as **named overrides** so nothing is decided
by key-precedence accident.

### 7.1 The attribution rule (normative)

Per feature, most-specific first: `gu_a3` → `iso_3166_2` prefix → `iso_a2` →
`adm0_a3`, plus one explicit rule, `/^NL-BQ\d$/` → `BQ` (the three
Caribbean-Netherlands units carry `gu_a3 = NLD`).

This yields 250 codes with 7 features unattributable. **Do not use `iso_a2`
first** — that rule folds YT RE GP MQ GF into FR, TK into NZ, SJ into NO, BQ into
NL, and drops CC and CX entirely, which is exactly the set Phase 4 exists to
reach.

**`admin_0_map_units` is not a geometry source.** Under D6 the L2 outline is
`merge()`d from the country's own admin-1 set, so no admin-0 layer is sliced at
all. The map-unit layer is used at build time for exactly two things: confirming
all 13 `SEARCH_ONLY` codes exist as separable units (§2.3), and resolving the
fold-in table below. Where it *is* read, key on **`GU_A3`** — never `ISO_A2` (13
countries are stamped `-99`; Taiwan is `CN-TW`; `XD` is the UNDOF Zone, a Syrian
overlay polygon), and never `FIPS_10` (its `TK` is Turks & Caicos, not Tokelau).

This also makes the fold-in mechanism cheap: the seven unattributable features in
§7.2 are themselves **admin-1** features carrying `-99-X##~` placeholders, so
"folded into the outline of X" means *included in X's `merge()` input while
excluded from X's selectable geometry list*. No cross-layer stitching.

### 7.2 The override table — **review this line by line**

| Feature | ISO 3166-2 code | Selectable province | Folded into outline of | Note |
|---|---|---|---|---|
| Crimea | UA-43 | yes, under UA | UA | NE's `iso_a2` says RU; `iso_3166_2` says UA. ISO decides: UA. |
| Sevastopol | UA-40 | yes, under UA | UA | as above |
| Northern Cyprus (`CYN`) | none (`-99-X##~`) | no | **CY** | ISO 3166-1 treats the island as CY |
| Somaliland (`SOL`) | none | no | **SO** | ISO 3166-1 has no SO-split |
| Akrotiri (`WSB`) | none | no | **CY** | ISO 3166-1 gives it no code |
| Dhekelia (`ESB`) | none | no | **CY** | as above |
| Guantánamo (`USG`) | none | no | **CU** | within Cuba's ISO territory |
| Siachen (`KAS`) | none | no | **excluded** | ISO gives no guidance; excluding is the only non-editorial option |
| Spratlys (`PGA`) | none | no | **excluded** | see asymmetry below |
| Taiwan / Hong Kong / Macau | own ISO 3166-1 codes | yes, **as their own countries** | own files | non-selectable within `CN.json` |
| Jan Mayen (`NJM`) | — | no (zero admin-1) | **SJ** | ISO 3166 SJ is "Svalbard and Jan Mayen" (D9) |

So Cyprus's *shape* includes the north while its *clickable subdivisions* follow
ISO 3166-2. That is the intended reading of "ISO 3166 as the single rule":
3166-1 governs territorial extent, 3166-2 governs subdivision identity.

### 7.3 The one asymmetry this leaves, stated plainly

`CN.json` retains all 35 curated features **as geometry**, including
`100000_JD`, the nine-dash line. It is not an ISO concept, it has no equivalent
in any other source, and Natural Earth's own treatment of the same waters
differs. Removing it would change what China's map has rendered since 2026-08-10;
keeping it means one file carries a cartographic claim the other 245 do not.

**This design keeps it, and records that it is a deliberate exception rather
than an oversight.** It is the one item most worth overruling if the reviewer
disagrees.

---

## 8. Sizes, budget and toolchain

### 8.1 Reproducing the numbers

- Node v24.14.1; `topojson-server@3.0.1` and `topojson-simplify@3.0.3`, both
  ISC, both **`devDependencies`** — nothing at runtime imports them. Total new
  install **294 KB across 3 packages**. `quantize` needs no new dependency; it
  ships in `topojson-client@3.1.0`, already a runtime dep.
- **`mapshaper` is rejected**: 15.3 MB unpacked, MPL-2.0, ~25 direct deps
  including a GeoPackage/SQLite stack, landing in every `npm ci`.
- Pipeline, in the **only order that works** — `quantize` throws
  `already quantized` if `topology()` is given a quantisation argument first:

```js
let t = topology({ provinces: featureCollection });  // MUST be unquantised
t = presimplify(t);                                  // planarTriangleArea
t = simplify(t, tolerance);                          // 0 for the default pass
t = quantize(t, 1e5);                                // LAST
```

- Quantisation **1e5** per country over its own bbox. Not a guess:
  `world-countries.json`'s transform against its bbox measures Qx = Qy = 100000
  exactly.

### 8.2 Why global simplification is rejected

Measured area error per admin-1 unit, swept over all 240 countries:

| tolerance | units effectively erased | units off by >5% |
|---|---|---|
| 1e-5 | **2** — Vatican, Vaavu Atoll (MV) | 49 |
| 1e-4 | **30** — 13 Maldivian atolls, Paracels, Redonda, both Bermudian cities, Pukapuka, Rakahanga, Vatican | 208 |

Total area is preserved everywhere (worst country-total error 0.132%). **The
damage is entirely in the smallest units and it is a cliff, not a slope**: a unit
keeps its name, its id and its place in the file, and draws nothing.

1e-5 is disqualified as a global constant because it erases the Vatican, and VA
is one of the 34 countries whose *entire* admin-1 representation is that one
polygon. 1e-4 erases exactly the small island jurisdictions a travel planner
wants clickable.

**Default is tol = 0 — quantise only.**

### 8.3 The budget

The `150_000` at `lib/cityShard.test.ts:371` is a *city-shard* test measuring raw
`statSync().size`. Province files get their own assertion, keeping the UX intent
but measuring what crosses the wire:

> **`gzipSync(file).length <= 150_000`**, plus a raw tripwire at 700,000 B so a
> runaway build fails loudly.

Under tol = 0 this fails on exactly **two** countries, and the whole override
table is two rows:

| country | tol | raw | gzip | worst-unit area error | units erased |
|---|---|---|---|---|---|
| CA | 1e-4 | 416,022 | **135,304** | 2.85% | 0 |
| RU | 1e-4 | 402,791 | **122,649** | 1.00% | 0 |

CA is the hardest slice in the dataset despite having only 13 features: its
72,507 vertices are almost all Arctic coastline, which is precisely what
Visvalingam defends longest.

`DERIVED` totals under this configuration: **8,775,960 B raw / 3,074,772 B
gzip**. The build must print the real 246-file totals.

### 8.4 Build hazards, all verified

- **Directory is `public/provinces/`. Never `public/cities/` or a subdirectory
  of it.** `ingest-cities.mjs:1009` sweeps stale shards with
  `rmSync(path, { force: true })` — **no `recursive`** — skipping only
  `index.json` and a hard-coded `enrich`. A new subdirectory throws
  `ERR_FS_EISDIR`, verified on this box, killing `refresh-cities.yml` nightly in
  a job whose failure mode is "the catalog silently stops refreshing." Two
  further breakages: `cityShard.test.ts:346`'s two-way orphan check and
  `countryFacts.test.ts:139`'s exact count over `^[A-Z]{2}\.json$`.
- **Copy `build-globe-topology.mjs`, not `build-world-topology.mjs`** — the globe
  script has the extracted `writeFileAtomic` **with `rmSync` before
  `renameSync`** (renaming onto an existing path is not reliably atomic on
  Windows, this project's dev platform), it is the only one with report
  emission, and the only one reading a committed sibling asset as a gated input.
  For a 246-file build, take `ingest-cities.mjs`'s PID-suffixed temp path.
- **Timestamp churn.** Both topology scripts stamp `generated` unconditionally.
  For 246 files that makes every rebuild a 246-file diff of noise. Use the
  sharded idiom: per-file payload comparison on **`topology` alone, never the
  envelope**, plus `stampedPayload` for the index. Three preconditions or the
  comparison never matches: field name **`generatedAt`** (full ISO, not the
  topology scripts' date-only `generated`); **deterministic ordering** (sort
  features by `adm1_code`, iterate countries sorted); and **the report takes the
  index's timestamp, not `now`**.
- **Cache header** — a third rule after `/cities/`:

```ts
source: "/provinces/:path+",
headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
```

  `:path+`, not `:path*` (the star form matches bare `/provinces`, which is not a
  file), and not the existing single-segment inline regex, which `/provinces/CN.json`
  would fall through. `lib/cacheHeaders.test.ts` needs four edits, including the
  **disjointness test extended in both directions**.
- **Type stripping.** `build-provinces.mjs` may import `lib/countries.ts` (a leaf,
  already imported by `build-world-topology.mjs`) but **must not** import
  `lib/isoTopology.ts` or any `lib` module importing a sibling `.ts` — an
  extensionless `.ts` → `.ts` import fails with `ERR_MODULE_NOT_FOUND`, and adding
  the extension fails `tsc` with TS5097. Do not add `"type": "module"` to
  `package.json` to silence `MODULE_TYPELESS_PACKAGE_JSON`.

---

## 9. Climate

### 9.1 Source: CHELSA V2.1, CC0

| | |
|---|---|
| Product | CHELSA V2.1 climatologies, 1981–2010, 30 arc-second (~1 km) |
| Variables | `tasmin`, `tasmax`, `pr`, plus **`clt`** (§9.4) |
| Grid | 43200 × 20880, bbox −180..+180 / **−90..+84** (not +90) |
| Encoding | COG, 512×512 LZW tiles, predictor 2, 3,485 tiles/raster |
| Scale | `tasmin`/`tasmax`/`pr` 0.1; `hurs` 0.01. Nodata **65535** |
| TIFF flavour | `tas*`/`pr` classic (magic 42); **`hurs` is BigTIFF (magic 43)** |
| Licence | **CC0 1.0.** Machine-confirmed via EnviDat API. DOI 10.16904/envidat.228 |

**WorldClim is disqualified.** `wc/readme.txt`, shipped in every zip, verbatim:
*"You are not allowed to redistribute these data."* A committed derived artifact
is at minimum arguable redistribution. Widely-repeated claims that WorldClim is
CC BY-NC-SA are wrong — the real terms are stricter, since CC BY-NC-SA at least
permits redistribution.

**CC0 imposes no attribution condition**, and this must be stated so nobody later
hardens it into a contract it does not need. No `ChelsaCredit.tsx`, no new entry
in `contracts.test.ts` C7's token list (C7's tokens select for GeoNames-derived
*city names*; climate rows are keyed by the same ids, so a naive extension would
sweep every temperature consumer into the GeoNames surface set). A courtesy
credit goes in `data/climate-report.md` under a `## Source` heading, deliberately
named differently from `cities-report.md`'s `## Attribution` so the two are not
pattern-matched together later.

Note the licence split: `chelsa-climate.org/models/chelsa` states GPL v3. That
governs the CHELSA *algorithm*, not the data record, and does not reach the
model's output.

**`.gitattributes` gap to close in the same commit:** it pins `data/*.md` and
`data/*.json` to `eol=lf`, but nothing under `public/`. Add
`public/climate/*.json text eol=lf` and `public/provinces/*.json text eol=lf`
— otherwise a fresh Windows clone with
`core.autocrlf=true` fails any byte-comparison for line endings alone, which is
exactly the failure `.gitattributes` was written to stop.

### 9.2 Acquisition: offline rasters, zero API requests

The per-city API route is arithmetically dead. Open-Meteo's call weight,
derived empirically against the documented 600/min bucket, is
`locations × (days/14) × (variables/10)`, floor 1, with a 600-weight cap per
request. For 30-year normals that is **234.8 weight per location**, capping a
request at **2 locations**:

| strategy | points | HTTP requests | wall-clock on the free tier |
|---|---|---|---|
| per-city | 58,746 | 29,373 | **1,379 days** |
| per-admin-1 | 3,843 | 1,922 | 90 days |
| per-country | 246 | 123 | 5.8 days |

Grid binning is rejected on accuracy independently of cost — at 1.0° cells,
mean error 1.17 °C, p99 8.13, max 33.6, with 8.44% of centres on nodata.

And one incidental data point that settles it: during the prototype a *single*
exploratory 13-location request (200 OK, 26.4 MB, 16.5 s) exhausted the entire
10,000/day free tier. Every subsequent call 429'd, including a 7-day
single-variable request costing weight 1.

**Production strategy: whole-object GETs, band-scanned one raster at a time.**
Range reads look attractive at sample scale (2,877 cities touch 107 of 3,485
tiles, a 91% saving) but the full catalog touches **1,016 tiles (29.2%)** and,
because populated tiles are the dense ones, still pulls **60.6% of the bytes** —
at ~36,600 range requests that are not resumable. Whole objects are 36 GETs
within 1.65× the volume, resumable and cacheable.

Dependency: `geotiff@3.0.5`, MIT, 9 packages / 8.0 MB, **no native deps**.

**Refresh: `workflow_dispatch` only, no schedule.** These are decadal WMO
normals; the next revision is a calendar event, not a feed. A nightly job would
pull 5.2 GB/night — 1.9 TB/year — from an academic host to produce a
byte-identical tree. `refresh-cities.yml`'s own header records that back-to-back
upstream workloads on one runner caused two real outages, which is why cities and
facts were split on 2026-08-28: **do not add a third consumer to that workflow.**

### 9.3 Artifact

`public/climate/<CC>.json`, sharded sidecar. Merging into `public/cities/<CC>.json`
puts **45 of 246 shards over the 150,000 B cap**; as a sidecar, **0 of 246**.

`public/`, not `data/` — nothing server-side reads climate, and at 7.32 MB a
bundled artifact would be **91× the country-facts budget** and ship to the
browser on every page that renders a map.

Per city, a positional 36-int tuple, the idiom `cities-index.json` already uses:

```
[ …12 lo (°C int), …12 hi (°C int), …12 precip (mm/month int) ]
```

**`fit` is derived at read time, never stored.** Storing it costs ~700 KB to save
nothing, and would freeze a provisional model into an artifact only a full
re-ingest could revise.

| | measured |
|---|---|
| whole artifact | **7.32 MB raw · 2.16 MB gzipped** |
| shards over cap | **0 of 246** |
| largest | VN, 97,941 B (65% of cap) |
| median | 13,648 B |

The budget test must say in its comment that this cap is **not saturated**,
unlike the city shard's, so a future reader does not assume it is binding.

### 9.4 The fit model, and the four fixes (D4)

Type surface is unchanged: the artifact resolves to the existing
`RegionMonthClimate` and `MonthFit`. **No new band, no `FIT_COLORS` change, no
new legend swatch, no contrast re-audit.** `unknown` already exists as the
absence marker with an audited colour (`#8a939f`, darkened from a 1.61:1
failure).

Four contract requirements, all already pinned for `chinaClimate`: total (never
throws, `hasOwnProperty` not truthiness), fresh objects per call, exactly 12 rows
or `null`, and **integers** — `PlacePopup.tsx:106` interpolates
`{climate.lo}°–{climate.hi}°C` unformatted, so a float renders `8.437°`.

```
penalty = heat(hi) + cold(hi, lo) + mugginess(td) + rain(precip) + cloud(clt)
fit     = great | ok | poor | avoid, banded on penalty
```

Dew point uses the standard Magnus form on `T = (lo+hi)/2` and monthly mean RH.

**The four fixes that must land before fit colours ship:**

1. **`clt` cloud cover**, from the same bucket at the same licence. Without it
   **Lima is `great` in all 12 months**, including the Jun–Sep *garúa* — its
   precipitation is ~3 mm/month year-round, so nothing else distinguishes winter.
2. **Humidity bias correction.** `hurs` runs systematically low in humid climates
   (Iquitos 72% vs ~85% observed), so **Tokyo July is `great`** (penalty 0.41) and
   **338 of 750 Japanese cities are `great` in July**. The mugginess term itself
   works — it fires correctly for Sanya and Shanghai at Td 21 — the input is wrong.
3. **Climate-relative rain knee.** The calibrated knee sits at **140 mm/month**, a
   threshold tuned on China. Kenya is **78.1% `great`** and both rainy seasons
   vanish from the verdict despite being unmistakable in the data (Nairobi:
   Apr 191, Jun–Sep 18–26, Nov 118). A single global threshold cannot serve
   Dunhuang at 1 mm and Iquitos at 330.
4. **Elevation-dependent temperature correction**, using the `elev` field §11
   adds. The bias runs −1.94 °C overall and **−3.62 °C above 2,000 m**, which is
   exactly why **Cusco is never `great` during Jun–Aug, its actual peak season**.

**Calibration protocol, and it must be preserved on any re-tune.** The knobs were
fitted on only the three China regions whose anchors are *not* in the validation
set — East, Northwest, Central — and the four validation regions were never
inspected during tuning. Untuned first-guess parameters scored 25/48 on holdout;
tuned, 35/48. A re-tune that looks at the holdout before reporting a number
produces a meaningless number.

**Hemisphere: rows are calendar-indexed. Index 0 is January. Everywhere.**
`seasonIn` is never applied to this index — a data-derived table is
hemisphere-correct by construction, and passing the month through `seasonIn`
would read Sydney's January at index 6, a double inversion. Verified: peak-warmth
phase by circular vector mean is NO Jul, JP Jul, CN Jul vs **PE Jan, KE Feb**,
with no flip applied anywhere. `seasonIn` and the `Season` union survive
untouched — `Season` is a persisted wizard field, and removing the inversion
would re-break "a June Peru trip previewed summer and saved winter".

### 9.5 China stays authoritative

**The deciding number: 35/48 = 72.9% exact-band agreement on holdout**, 93.8%
within one band; 78.7% across all nine region-anchor pairs. Not high enough to
displace a hand-authored table — and the 27.1% is not random:

```
ok->great  11   <- model too generous
ok->avoid   3   <- ALL THREE are Harbin's Ice Festival months
avoid->poor 1   <- Wuhan July, "furnace city"
avoid->ok   1   <- Wuhan August, "furnace city"
```

Both of the curated table's only two `avoid` cells are missed, because 26/32 °C
at 63% RH is not objectively worse than Sanya's August, which the table calls
`poor`. The discriminator is the city's **nickname**. The table's own internal
evidence says the same without any external data: `North[5]` and `Northwest[5]`
are both `{lo:18, hi:30}` with opposite verdicts, one noted "Best window for
Xinjiang" — an *access* fact. No `f(lo, hi, precip)` produces that.

**And a subtler reason not to trust 72.9% as a licence to replace anything:**

| TMAX correction | holdout exact |
|---|---|
| +0.00 (raw) | **35/48 (72.9%)** |
| +1.94 (measured station bias) | **29/48 (60.4%)** |

Making the temperatures *more accurate* makes China agreement **12.5 points
worse**. The curated values sit close to raw CHELSA (0.55–0.88 °C on matched
anchors) and ~2 °C below WMO station normals, so part of the 72.9% is measuring
"CHELSA agrees with whatever the curated author used".

**Success test: China's rendered output is byte-identical before and after Phase
4.** Any change to a China pin colour or popup line is a regression.

Resolution order at `regionFit` (`mapTypes.ts:54-57`), the one function deciding
every pin and province colour: curated `bestSeasons` → curated `REGION_MONTHS` →
derived worldwide → `unknown`.

### 9.6 The highest-regression-risk edit in the phase

`lib/server/catalog.ts:367` and `:400` stamp **every** catalog-derived and
GeoNames-derived `Destination` worldwide with
`bestSeasons: ["spring","autumn"], seasonNotes: {}`. That literal reaches
`RouteMap.tsx:77` and **`itinerary.ts:92` scoring**, so a Sydney or Reykjavík stop
currently renders `great` in March and October from a hardcoded northern-hemisphere
guess — the exact fabrication this phase exists to remove, and one the new artifact
does **not** remove unless those two literals go with it.

It also produces a live inconsistency today: `MapExplorer`'s catalog `MapPlace`s
carry no `bestSeasons`, so the same city is `unknown` on the picker map and
`great` on the route map.

**Removing it re-ranks every generated plan worldwide.** China's 16 curated
destinations are unaffected; China's *catalog* cities are not. This edit gets its
own PR-internal checkpoint.

### 9.7 Honesty surface

Extend the existing `GapNote` (`role="note"`, takes `string[]` so it drags no data
module into any bundle, renders nothing for an empty array) rather than building a
second honesty surface. Where a place's climate row is derived rather than curated:

> Temperatures are 1981–2010 grid normals sampled at each city, not station
> records. Mountain towns above 2,000 m typically read about 3–4 °C colder than
> they are, and coastal fog and monsoon timing are not modelled.

It must not resolve the climate artifact itself, and it renders nothing for China.

---

## 10. Airports and gateways

### 10.1 Map layer

Toggle in `MapExplorer`, **off by default, ephemeral component state** (D11) —
not a fourth `UserPrefs` field. The prefs path costs `sanitizePrefs`, a
`PrefsSchema` key and a cookie round-trip, and `schemas.ts:329` carries a scar
comment about exactly that path silently discarding a saved value. `large` and
`medium` only, below a zoom threshold.

**Airports are never selectable trip stops.** §2.1 of the roadmap is unamended on
this and the types must enforce it.

### 10.2 "Main airport", not "Nearest" (D12)

`nearestAirports` ranks with `SIZE_BONUS_KM = {large:+15, medium:0, small:-15}`,
so `[0]` can legitimately be 15 km further than the true nearest. A card reading
"Nearest airport: LHR · 23 km" next to a 13 km LCY is the failure. The card reads
**"Main airport: TNA · 30 km"**, which is both honest and what a traveller
actually wants.

### 10.3 Gateways (D3)

`arrivalAirport?: string | null` and `departureAirport?: string | null` — optional
**and** nullable, because absent / null / IATA are three real states, and
`755c8dd` is the bug report for conflating two of them. `TripInput.country`
(commit `0cfd0a9`) is an exact 6-file precedent.

- **No migration.** Trips are a whole-blob JSON/`jsonb` column with an
  `as TripData` cast. `0cfd0a9` is a written argument against bulk-rewriting them.
- **Zod is the load-bearing risk**: schemas are non-strict, so an omitted key is
  silently stripped and the route returns 201 with the data gone. Add an
  `IataSchema` to `TripInputSchema` and a named reader.
- **Server stamps the default at create**, beside the existing
  `initialCurrencySettings` stamp (`app/api/trips/route.ts:60-70`, precedent
  `bdf1915`), computed from `resolveDestinations` coordinates.
- **Saved through a new `/gateways` sub-route, never PATCH `/api/trips/[id]`** —
  PATCH regenerates the plan and calls `clearScheduleChecks`, silently wiping the
  user's ticked schedule.
- **`suggestRoute` gains an optional `start`.** Without it the existing
  order-independent search runs unchanged, so `route.test.ts:85-86` and
  `route.country.test.ts:56-57` survive untouched. Anchoring happens only when the
  user has explicitly chosen a gateway.

---

## 11. Ingest changes

One change to `scripts/ingest-cities.mjs`, which keeps the admin-1 code on every
row at line 221 and discards it at emit, lines 400–411:

```js
a1:  admin1Codes.get(`${country}.${row.admin1Code}`) ?? null,
a1c: row.admin1Code === '' ? null : `${country}.${row.admin1Code}`,
elev: row.elevation ?? null,
```

Forced follow-ons: `lib/cityShard.ts:42` (`CityShardRow` gains two fields; the
docblock's "seven-field record" becomes nine), `:128-137` (row mapping plus a
shape guard `/^[A-Z]{2}\.[A-Za-z0-9]+$/`), `:182,202` — **leave `a1c` out of
`MapCity`** and let the join read `CityShardRow` directly — plus
`cityShard.test.ts:25-29,142-148,257` and
`ingest-cities.test.ts:586,596,606,733,747`. And
`ingest-cities.mjs:536,584,607-613`: `assertSane` counts `admin1Resolved` off `a1`
only, so add a sibling gate or the code can go all-null while `a1` stays green.

**Not forced:** `data/cities-index.json` — `lib/server/cityIndex.ts:88` guards
`tuple.length < 6` and destructures six, so appending is backward-compatible.

Measured cost of `a1c` across all 246 shards: raw 6,720,544 → 7,372,384
(**+9.7%**); gzip 1,528,960 → 1,621,702 (+6.1%); largest shard AR 96,726 →
104,976 against the 150,000 budget — **45,024 B of headroom**. The city-shard
budget test does not move. `elev`'s incremental cost is `UNMEASURED`.

Both artifacts regenerate from an existing daily workflow, so a schema bump is a
re-run, not a migration.

---

## 12. Testing

### 12.1 Placement, per the house split

- **Filename extension is the project selector.** `.test.ts` under `lib/` or
  `scripts/` runs in the fast node project; `.test.tsx` runs in jsdom.
  **`.test.ts` under `components/` runs in NO project** — silently never executed,
  no error, no skip, green suite, zero coverage. Pure logic goes in `lib/`.
- The node project globs only `lib/` and `scripts/`. A test about a root-level
  file lives under `lib/` — which is why `lib/cacheHeaders.test.ts` exists.
- Fixtures shared between two test files live in a plain non-test module
  (`components/map/worldFixture.ts` is the precedent).
- There is **no coverage provider and no coverage threshold** in this repo. Do not
  plan around a coverage gate that does not exist.

### 12.2 The acceptance criterion to add before any geometry work

> **Every city in an open country is reachable by keyboard and by search, and no
> interactive marker is smaller than `--tap-min`.**

Nothing in CI currently checks this. `ci.yml` is `npm ci && npx tsc --noEmit &&
npm test` — no `next build`, no axe pass, no coverage. And
`CountryMap.test.tsx:230-247` pins the 60-chip cap, which is the behaviour PR2
deletes, so that test gets *rewritten* rather than failing. Without this
criterion written down first, nothing in the pipeline sees the regression.

### 12.3 New tests

| File | Proves |
|---|---|
| `scripts/build-provinces.test.ts` | pure functions: payload comparison, coverage gate, property whitelist. Reproduce three properties from `build-globe-topology.test.ts` — `.toThrow(/…/)` asserting the error **names the offending codes**, an explicit "sorts so a rebuild is byte-stable" test, and a **one-way** coverage test |
| `lib/provinceTopology.test.ts` | the committed 246 files as data, guarded by `describe.skipIf(!existsSync(...))` |
| `lib/climateShard.test.ts` | 246 shards, gzip budget, city-id set equal to `public/cities/` **in both directions**, no missing months |
| `lib/climateModel.test.ts` | the four contract requirements; Norway January is never `great`; Kenya shows two rain maxima in the verdict; Lima's winter is not `great` |
| — regression | China adcodes `140000` and `610000` resolve to **different** polygons (§6.3) |
| — regression | China's rendered fit output is byte-identical to pre-Phase-4 (§9.5) |
| `lib/cacheHeaders.test.ts` | four edits including the disjointness test in both directions |

The province coverage gate must be written against the **250-code ISO table in
`lib/countries.ts`**, not against `world-countries.json`'s 235 — the 13 Phase 4
targets are precisely the codes absent from that file, so a gate against it would
reject 13 of the 246 by construction. Keep the count assertion exact
(`toHaveLength(246)`, not `toBeGreaterThan`) so a 247th country forces a human
decision.

### 12.4 CI reality

`ci.yml` does not run `next build`, so a `next.config.ts` change is exercised only
by `cacheHeaders.test.ts` importing the config object directly. Any Phase 4
build-time behaviour gets **zero CI coverage** unless a vitest test calls it.

Also: GitHub does not create workflow runs from pushes authenticated with the
default `GITHUB_TOKEN`, so `ci.yml` never runs on a refresh workflow's commit
while Vercel deploys it regardless. `refresh-climate.yml` therefore keeps the
"verify the artifacts against the repo's own tests" step.

---

## 13. Deliberately out of scope

- **Phase 5 flight data.** Unchanged from the roadmap: it gets a fresh brainstorm.
- **The Wikidata `Q…` / GeoNames `G…` namespace split.** Permanently two
  namespaces, merged client-side, and only China has both. The dedup logic
  (`dropCatalogTwins`, 5 km + folded name) has a documented 631 km counter-example
  for Heshan and 2,852 km for the two Yushus. Phase 4 has no reason to go near it.
- **Insets.** A render-time layout decision, explicitly excluded from the
  projection manifest (§5.4). The two genuine candidates (US, FR) are recorded for
  a later phase.
- **Humidity in the shipped artifact.** `hurs` costs +25% and its bias is the
  thing §9.4 fix 2 has to correct; v1 ships the correction, not the raw field.

---

## 14. Unresolved

Needs a build run to settle — none blocks starting:

1. Feature and byte totals under the 246-country grouping. 4,580 features and the
   8,775,960 / 3,074,772 B totals are `DERIVED`; the first build prints the truth.
2. Individual sizes for the six newly-separated files (CC, CX, BQ, TK, SJ, and the
   five DOMs pulled out of France).
3. The property-set delta from `id = adm1_code` plus `gn_a1_code` — estimated
   +115 KB raw across all files, ~+5.8 KB on GB. `UNMEASURED`.
4. **Whether merged admin-1 tiles each country completely.** D6 assumes the
   `merge()` of a country's admin-1 set is its outline. Nothing measured whether
   admin-1 leaves gaps (large lakes, unclaimed interior, offshore units) that
   would show as holes in the L2 outline. Check this on the first build against
   the 50m admin-0 shape, per country, before PR4 renders anything.
5. **The projection manifest must be rebuilt on the merged-province outlines.**
   The committed 235-entry manifest in §5.4 was measured on the 50m admin-0
   source, and its `scale`/`bounds` values are only valid for that geometry.
   Under D6 the rendered geometry is different (10m, merged, 246 countries), so
   the manifest is regenerated on it and A1/A1b re-verified there. The rule was
   separately run on the 10m source and accepts 12 of 258, but those assertions
   were never run against it and no values exist for the 13 new codes. **The §5.4
   accepted list is therefore the expected shape of the answer, not the answer.**
6. How many of the 2,301 cities outside every polygon the `a1c` fallback recovers.
7. Build-time cost of point-in-polygon over 58,746 cities, and whether it runs in
   `ingest-cities.mjs` or `build-provinces.mjs`. Not timed.
8. Full-catalog climate ingest runtime. Only the 2,877-city figures are real;
   budget "tens of minutes, single-digit GB, sub-500 MB RSS" and record the truth.
9. **Small islands and micro-states in the climate sample.** The prototype
   resolved 58,746/58,746 with zero nodata fallbacks — but across PE, JP, NO, KE,
   CN only. MV, TV, NR and SG were never sampled, and a 1 km grid whose nodata mask
   is coastline-shaped is the obvious place for this to fail.
10. Label correctness for 33 of the 34 single-unit countries. Only FO was checked,
    and it is wrong.

Needs a human decision:

11. **The nine-dash line asymmetry** (§7.3) — the one item most worth overruling.
12. **Siachen and the Spratlys excluded from every outline** (§7.2). Excluding is
    the only non-editorial option ISO leaves, but it is still a choice.
13. Whether `SEARCH_ONLY_REASONS` narrows to "no 50m feature" (this design's
    assumption) or is retired outright once 10m lands.
