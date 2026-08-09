# China Destinations Catalog — Ingestion Report

Generated: 2026-08-09T20:10:08.659Z (runtime 193s)
Source: Wikidata (CC0) via SPARQL + English Wikipedia intro extracts (CC BY-SA, batched Action API).
Regenerate with: `node scripts/ingest-destinations.mjs`

## Verified Q-ids

Each id is re-verified against its English label at the start of every run; the run aborts on mismatch.

| Q-id | English label (verified) | Used as |
|------|--------------------------|---------|
| Q148 | People's Republic of China | country filter (P17), municipality P131 discriminator |
| Q1208802 | direct-administered municipality | city level "municipality" (with P131=Q148 to exclude ROC-era ones, e.g. Nanjing) |
| Q250811 | sub-province-level division | the 15 sub-provincial cities (Harbin, Chengdu, …) → level "prefecture" |
| Q748149 | prefecture-level city | city level "prefecture" |
| Q1070990 | county-level city | city level "county" (enwiki sitelink required) |
| Q1044880 | subprefecture-level city | province-administered county-level cities → level "county" |
| Q570116 | tourist attraction | attraction class (P31/P279*, enwiki required) |
| Q6838244 | Chinese AAAAA-rated tourist attraction | AAAAA scenic areas (enwiki optional) |
| Q10925991 | Chinese AAAA-rated tourist attractions | AAAA attractions (enwiki required) |
| Q9259 | World Heritage Site | via heritage designation P1435 (China's WHS are not P31 instances) |

## Cities

- Total: **695** (municipality: 4, prefecture: 293, county: 398)
- Raw from class "direct-administered municipality": 4
- Raw from class "sub-province-level city": 15
- Raw from class "prefecture-level city": 294
- Raw from class "county-level city": 400
- Raw from class "subprefecture-level city": 24
- Dropped (missing English label or coordinates): 2
- With population: 692 (99.6%)
- With image: 653 (94.0%)
- With description: 695 (100.0%)
- Wikipedia intro extracts fetched (batched Action API) for every city with an enwiki sitelink (0 titles fell back to Wikidata descriptions)

## Attractions

- Total: **426**
- Raw from source "tourist attraction subtree (Q570116, enwiki required)": 316
- Raw from source "AAAAA-rated scenic area (Q6838244)": 246
- Raw from source "AAAA-rated attraction (Q10925991, enwiki required)": 3
- Raw from source "World Heritage Site in China (P1435 = Q9259)": 85
- Dropped (no label/coords or duplicate of a city entity): 1
- Matched to a city (cityQid non-null): 417 (97.9%) — 218 via P131 admin chain, 199 via nearest city ≤ 150 km
- With image: 387 (90.8%)
- With description: 397 (93.2%)

## Sanity checks

- [x] PASS — City present: Beijing
- [x] PASS — City present: Shanghai
- [x] PASS — City present: Chengdu
- [x] PASS — City present: Sanya
- [x] PASS — City present: Harbin
- [x] PASS — Attraction present: Forbidden City
- [x] PASS — Attraction present: Zhangjiajie/Wulingyuan area
- [x] PASS — Total cities in expected range (300–700, got 695)
- [x] PASS — All interest tags within allowed vocabulary

## Notes / caveats

- `province` is the English label of the direct P131 parent; for county-level cities that is usually their prefecture-level city, and for the four municipalities it is set to the city's own name (their P131 is the PRC itself).
- Interests are keyword-derived from name + description against the app vocabulary: food, history, nature, beach, themepark, arcade, shopping, nightlife, museums, hiking, family.
- Population is the latest non-deprecated P1082 statement (preferred rank first, then newest point-in-time).
- Images are Commons `Special:FilePath` URLs with `?width=640`.
