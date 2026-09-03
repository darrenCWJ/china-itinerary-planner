# CHELSA climate probe

- Source: `https://os.zhdk.cloud.switch.ch/chelsav2/GLOBAL/climatologies/1981-2010/<var>/CHELSA_<var>_01_1981-2010_V.2.1.tif`
- Licence: CC0 1.0 — CHELSA V2.1 climatologies 1981–2010, DOI 10.16904/envidat.228
- Probed: 2026-09-03T16:04:39.646Z, `node scripts/probe-chelsa.mjs`, Node v24.14.1
- Catalog: the 246 committed shards under `public/cities/`, **58,757 cities**
- Downloaded: **January only**, four variables, 520,135,601 B (`tasmin`
  115,680,174 B, `tasmax` 114,438,763 B, `pr` 229,542,124 B, `clt`
  60,474,540 B)

Every number below came out of that run. Where one contradicts the design spec
(§9.1–§9.3) the contradiction is stated and the measured figure is the one
carried forward. The spec is wrong about the file format in three places and
close to right about the artifact's size.

**The catalog is 58,757 cities, not 58,748.** The plan and
`data/provinces-report.md` say 58,748 and spec §9.2/§9.3 say 58,746; both were
true when they were written. The nightly `Refresh cities` run that landed as
`9b8edc6` rewrote all 246 shards and added nine rows — its parent `96f2d75`
still holds 58,748 — and `fc9fa17` refreshed them again. Every size in
this document was measured against the shards currently committed under
`public/cities/`, so it is the 58,757 figure that the real build must plan for
— and that count will keep drifting, which is the argument for the climate
build reading the shards rather than carrying a hard-coded total.

## What the files actually are

All four are **classic TIFF, little-endian, magic 42**. So is `hurs`, whose
16-byte header was range-read without downloading its 361,353,211 B, and so is
`tas`. §9.1's claim that *"`hurs` is BigTIFF (magic 43)"* is **wrong** — there
is no BigTIFF anywhere in this product, and nothing downstream needs 64-bit
offset arithmetic.

§9.1 describes the storage as *"COG, 512×512 LZW tiles, predictor 2, 3,485
tiles/raster"*. Measured, none of that holds except the predictor:

```
                      tasmin / tasmax / pr        clt
IFDs (overviews)      1 (none)                    1 (none)
tiled                 no — stripped               no — stripped
block                 43200 x 1                   14401 x 1
RowsPerStrip          1                           1
blocks per raster     20880                       7201
Compression           8 (Deflate)                 8 (Deflate)
Predictor             2                           2
BitsPerSample         16, SampleFormat 1          16, SampleFormat 1
```

These are **not** Cloud-Optimised GeoTIFFs. There is one IFD and no overview
pyramid, and the block is a single full-width row rather than a tile. That
retires §9.2's range-read analysis wholesale: *"2,877 cities touch 107 of 3,485
tiles"* counts a tiling that does not exist. The real unit is the row, and the
catalog touches **11,771 of 20,880 rows (56.4%)** in `tasmin`/`tasmax`/`pr` and
**4,511 of 7,201 (62.6%)** in `clt` — a much weaker case for range reads than
the spec assumed, which only strengthens its conclusion to fetch whole objects.

The single-row block is good news for memory. A decoded row is 43,200 uint16 =
86,400 B, so grouping cities by row and reading each touched row once keeps the
working set trivially small (see **Cost**).

## Nodata: the sentinel does not appear

§9.1 says nodata is `65535`. Measured, that is right about the tag on exactly
one of the four files and right about the pixels on none of them.

| variable | GDAL_NODATA tag | cities on 65535 | cells swept | cells at 65535 | observed cell range |
|---|---|---|---|---|---|
| `tasmin` | **-2147483647** | 0 / 58,757 | 508,507,200 | **0** | 2235 – 3015 |
| `tasmax` | **-2147483647** | 0 / 58,757 | 508,507,200 | **0** | 2297 – 3148 |
| `pr` | **-2147483647** | 0 / 58,757 | 508,507,200 | **0** | 0 – 17838 |
| `clt` | **65535** | 0 / 58,757 | 64,962,911 | **0** | 411 – 9328 |

`tasmin`, `tasmax` and `pr` declare a nodata value of **-2147483647**, which a
16-bit unsigned sample cannot hold — the tag is inapplicable, not merely
different. Only `clt` declares 65535, and 65535 occurs in none of the
1,590,484,511 cells the probe decoded across the four rasters.

**No city lands on nodata, and there is nowhere for nodata to cluster.** CHELSA
V2.1 is modelled over ocean as well as land: the mid-Pacific at 0°N 150°W reads
2981 (24.85 °C) and 765 (76.5 mm), so there is no coastline mask to fall off.
All **58,757 of 58,757** cities carry all four variables. The real ingest needs
no nearest-valid-cell fallback and no "unknown climate" path for missing
samples — but it should still assert the sentinel is absent rather than assume
it, because that is a property of this release and not of the format.

## Scale and offset: read them from the file

Every raster carries its own scaling in the `GDAL_METADATA` tag, in GDAL's
convention `real = raw * SCALE + OFFSET`. These are measured, not assumed:

```
tasmin   SCALE 0.1    OFFSET -273.15    -> °C
tasmax   SCALE 0.1    OFFSET -273.15    -> °C
pr       SCALE 0.1    OFFSET 0          -> mm/month
clt      SCALE 0.01   OFFSET 0          -> % cloud area fraction
```

§9.1 gives *"`tasmin`/`tasmax`/`pr` 0.1"* and is right about the scale, but it
**omits the -273.15 offset entirely**. A build that applied only the scale
would report Singapore at 298 °C. §9.1's `hurs` 0.01 was not verified here (the
file was not downloaded), but `clt` is 0.01, which the spec does not mention.

Reading the tag rather than hard-coding the constants matters for a second
reason: `GDAL_METADATA` is a *deferred* field in geotiff 3, so
`getFileDirectory().GDAL_METADATA` returns `undefined` in silence and the
synchronous `getValue()` throws. It has to be fetched with
`await directory.loadValue('GDAL_METADATA')`.

Applied to ten cities picked before any values were seen, the file's own
scaling reproduces January:

| city | `tasmin` | `tasmax` | `pr` | `clt` |
|---|---|---|---|---|
| Singapore (SG) | 2980 → **24.85 °C** | 3004 → **27.25 °C** | 2327 → **232.7 mm** | 6161 → **61.6%** |
| Moscow (RU) | 2630 → **-10.15 °C** | 2681 → **-5.05 °C** | 501 → **50.1 mm** | 6934 → **69.3%** |
| Cairo (EG) | 2813 → **8.15 °C** | 2919 → **18.75 °C** | 38 → **3.8 mm** | 2149 → **21.5%** |
| Sydney (AU) | 2931 → **19.95 °C** | 2970 → **23.85 °C** | 881 → **88.1 mm** | 3391 → **33.9%** |
| Reykjavík (IS) | 2680 → **-5.15 °C** | 2735 → **0.35 °C** | 1334 → **133.4 mm** | 5749 → **57.5%** |
| Lima (PE) | 2931 → **19.95 °C** | 2972 → **24.05 °C** | 37 → **3.7 mm** | 6266 → **62.7%** |
| Manaus (BR) | 2971 → **23.95 °C** | 3021 → **28.95 °C** | 2945 → **294.5 mm** | 6360 → **63.6%** |
| Mumbai (IN) | 2935 → **20.35 °C** | 3007 → **27.55 °C** | 10 → **1 mm** | 776 → **7.8%** |
| Yellowknife (CA) | 2453 → **-27.85 °C** | 2505 → **-22.65 °C** | 206 → **20.6 mm** | 4832 → **48.3%** |
| Longyearbyen (SJ) | 2553 → **-17.85 °C** | 2600 → **-13.15 °C** | 401 → **40.1 mm** | 6216 → **62.2%** |

Every one is a January a traveller would recognise: Sydney and Lima in southern
summer, Mumbai bone-dry under 7.8% cloud, Manaus at 294.5 mm, Yellowknife at
-27.85 °C. Nothing needs a hemisphere flip — the rows are calendar-indexed and
come out that way, which is what §9.4 requires.

**Lima is the case §9.4 fix 1 rests on, and it holds.** Lima's January
precipitation is 3.7 mm — indistinguishable from its winter — while its cloud
cover is 62.7%. Precipitation genuinely cannot separate Lima's seasons and
cloud genuinely can, so `clt` earns its place in the artifact on measured
evidence rather than on assertion.

Across all 58,757 cities the January raw ranges are `tasmin` 2271–3006
(-46.05 to 27.45 °C), `tasmax` 2333–3122 (-39.85 to 39.05 °C), `pr` 0–9480
(0 to 948 mm) and `clt` 436–8817 (4.4% to 88.2%).

## Grid geometry: there are two grids, not one

§9.1 gives one grid for the whole product: *"43200 × 20880, bbox −180..+180 /
−90..+84"*. That is right for `tasmin`, `tasmax` and `pr` and **wrong for
`clt`**, which is a different raster at a different resolution covering a
different latitude range.

```
                tasmin / tasmax / pr              clt
size            43200 x 20880                     14401 x 7201
resolution      0.0083333333 deg (~1 km)          0.02499999 deg (~2.8 km)
origin          -180.00013888885, 83.99986042     -180.02485599, 89.99992800
bbox W..E       -180.00013889 .. 179.99985967     -180.02485599 .. 180.00000000
bbox S..N       -90.00013889 .. 83.99986042       -90.02499999 .. 89.99992800
```

Three consequences for the real build:

- **It must carry each file's own transform.** `GTRasterTypeGeoKey` is **1
  (PixelIsArea)** on both `tasmin` and `clt` — read directly from the cached
  rasters, not assumed — so neither grid is node/point registered. The
  origin tag is the outer edge of pixel (0,0) on both, and
  `floor((lon − originX) / resX)` is the correct pixel index with **no
  half-cell correction**. `clt` still has 14,401 columns for a 14,400-cell
  world, but that extra column is a full-cell overhang in the west (the bbox
  row below shows the same pattern in the south, and a flush edge in the
  east), not a registration difference. The two grids still need separate
  transforms, because their origins and resolutions differ.
- **Neither bbox is the round number, and they are off by different amounts.**
  The 1 km grid is offset by about 1.4 × 10⁻⁴ ° (roughly half an arc-second,
  ~15 m at the equator) from −180/+84 on every edge — outside it in the west
  and south, inside it in the east and north. `clt` overhangs by 0.0249 ° in
  the west and south and is flush in the east and north. So §9.1's
  "−180..+180 / −90..+84"
  is right to four decimals for `tas*`/`pr` and not exact for anything. Read
  the origin and resolution tags; do not reconstruct them from `1/120`, which
  is not what the resolution tag says either (it stores the truncated decimal
  `0.0083333333`, and `clt` stores `0.02499999`).
- **`clt` reaches the poles and the others do not.** The +84 cut applies only to
  the 1 km grid.

**No city falls outside either latitude band: 0 of 58,757, on all four
rasters.** The +84 cut costs nothing because the northernmost catalogued city
is Longyearbyen (SJ) at 78.22334°N, 5.78° south of the edge. The other three
corners are Puerto Williams (CL) at -54.93355°, Labasa (FJ) at 179.36451°E and
Egvekinot (RU) at -179.11838°E; the longitude extremes are comfortably inside
both grids and 0 cities fall outside on longitude.

Sampling is nearest-cell, no interpolation.

## Layout: 36 ints or 48

**Recommendation: 48 ints.** The cloud block costs 28.7% more gzipped bytes and
buys the only input that separates Lima's seasons, and after paying for it the
worst shard still uses 29.7% of its budget.

### How the sizes were measured, and which of them to trust

A shard was serialised for all 246 countries as
`{"country":…,"generatedAt":…,"source":…,"cities":{"G<id>":[…ints…]}}` — one
line of JSON plus a trailing LF, the convention `build-provinces.mjs` uses and
`.gitattributes` already pins `public/climate/*.json` to. Budgets are
`build-provinces.mjs`'s own: **150,000 B gzip** per file, **700,000 B raw**
tripwire.

Only January exists, so the twelve months are one value repeated twelve times.
That has two very different effects, and conflating them would pick the wrong
layout:

- **Raw sizes are usable.** Bytes depend on digit widths, and January's widths
  are measured (below). The widest-token column bounds them from above.
- **Gzip sizes of the repeated shard are an artifact and must not be used.**
  Twelve identical integers compress the way no annual cycle ever will: the
  repeated 36-int artifact totals 541,107 B, which understates the real
  artifact by about four times.

So the gzip figure is instead built from real values with real entropy: shards
holding only January's 3 (or 4) measured values per city, minus the cost of a
shard holding the id keys alone, times twelve. That treats the twelve months as
*independent* columns, which real months are not — and the same run shows the
direction of that error: per-column marginal gzip cost *falls* as columns are
added (55,320 B for each of the first three columns, 52,930 B for the fourth),
so multiplying the first column's cost by twelve is an **upper bound** — the
real artifact, with its real month-to-month correlation, will compress better.

### The numbers

Largest and median are both ranked on 36-int raw size, so the two layouts name
the same countries and can be read against each other.

| | 36 ints | 48 ints |
|---|---|---|
| whole artifact, raw | 6,871,997 B | **8,980,757 B** |
| whole artifact, gzip (bound) | 2,214,258 B | **2,849,418 B** |
| whole artifact, gzip (repeated — artifact, do not use) | 541,107 B | 633,551 B |
| largest shard (ID, 750 cities), raw | 99,852 B | **126,852 B** |
| largest shard (ID), gzip bound | 32,340 B | **40,884 B** |
| largest shard (ID), raw at widest possible tokens | 144,876 B | 180,876 B |
| median shard (JM, 104 cities), raw | 12,879 B | **16,623 B** |
| median shard (JM), gzip bound | 4,676 B | **5,936 B** |
| **worst shard by gzip bound** | US, 34,519 B | **CO, 44,603 B** |
| shards over the 150,000 B gzip cap | **0 of 246** | **0 of 246** |
| shards over the 700,000 B raw tripwire | **0 of 246** | **0 of 246** |

The cloud block costs **+2,108,760 B raw and +635,160 B gzip** across all 246
shards — +30.7% raw, +28.7% gzip — measured from January's real cloud values.
Cloud is bounded 0–100 and renders at one or two characters in essentially
every month, so the January bias that affects `lo`/`hi`/`precip` is
negligible for this column, not absent.

**The budget is on gzipped bytes, and the biggest file is not the worst one.**
Indonesia writes the most raw bytes (126,852 B at 48 ints) but compresses well;
Colombia writes fewer and compresses worse, and it is Colombia that comes
closest to the cap. Any budget test must be written against the maximum over
all 246 shards, not against the largest file.

The deciding number is therefore **44,603 B gzipped against a 150,000 B cap —
29.7% of budget, at the worst shard, under the more expensive layout.** The
runners-up are clustered just below it (PE 44,043, BR 43,669, US 43,579, ZA
43,272, RU 43,116), so the result is not one country's luck. Even the
pathological case — every one of the 48 integers rendered at the widest token
any month could need (`-100` for temperature, `9999` for precipitation, `100`
for cloud) — is 180,876 B *raw*, and gzip on this data runs 31.7%, so the cap
is not reachable. Nothing about 48 ints is tight.

`clt` is also the cheapest of the four columns: cloud percentages at a city are
one or two characters (541 cities at 1, 58,216 at 2, none at 3, because no city
reaches 100%), where precipitation runs to three.

### Digit widths, so the estimate can be re-derived

Characters per integer including any minus sign, over all 58,757 cities:

```
lo (°C)      1 char 13,497   2 chars 42,120   3 chars  3,140
hi (°C)      1 char 19,760   2 chars 38,147   3 chars    850
precip (mm)  1 char  6,430   2 chars 37,771   3 chars 14,556
cloud (%)    1 char    541   2 chars 58,216   3 chars      0
```

January is the northern winter, so `lo` carries about as many minus signs as it
ever will and `precip` is at a seasonal low across monsoon Asia. The bias runs
in both directions and the widest-token row bounds it; **Task 6 should re-report
these sizes from the real twelve months rather than trusting this table's
absolute values.** Its *relative* conclusion — 48 fits with room to spare — does
not depend on the January assumption.

### Against §9.3's own numbers

§9.3 claims 7.32 MB raw / 2.16 MB gzipped, largest VN 97,941 B, median
13,648 B, 0 of 246 over cap. Measured at 36 ints: 6.87 MB raw, 2.21 MB gzip
bound, largest **ID** 99,852 B, median 12,879 B, 0 over cap. That is a
divergence of 6.1% on raw, 2.3% on gzip, 5.6% on median and 2.0% on largest —
small, and identical in conclusion — so §9.3's size table is sound even
though §9.1's description of the files is not.

The one place it names the wrong country is the largest shard. VN measures
90,722 B raw here, fourteenth; the top six are ID 99,852, BR 98,399, CA 97,940,
RU 97,271, AR 97,076 and MY 96,972. That spread is 3% wide because all of them
sit on the ingest's 750-city-per-country cap, so which one wins is decided by
id lengths and digit widths and will move between refreshes. Nothing should be
written that depends on a particular country being the largest.

### One thing the spec's own model implies that is not in this question

§9.4's penalty is `heat(hi) + cold(hi, lo) + mugginess(td) + rain(precip) +
cloud(clt)`, and `td` is derived from monthly mean relative humidity — a
**fifth** variable, `hurs`, which §9.1 mentions in its scale and flavour rows
but not in its variables row. If `hurs` ships, the layout is 60 ints, not 48.
It is a percentage like `clt`, so expect roughly `clt`'s marginal cost again:
about +635 KB gzipped, taking the artifact to ~3.48 MB and the worst shard from
44,603 B to roughly 55,000 B — still under 40% of the cap. That is an
extrapolation from the cloud column, not a measurement; `hurs` was not sampled.

## The `-9999` elevation sentinel

**Confirmed, and already fixed.** `git grep -o` over the tree at `c6fa7f5`
finds **exactly 300** rows carrying `"elev":-9999` across **71 countries**:

```
HK:48 NO:41 FI:17 CV:12 HN:10 IS:10 FM:9 GL:9 SE:8 NZ:6 KY:5 MC:5 MY:5 RU:5
FO:4 GB:4 GI:4 HR:4 MG:4 MU:4 PA:4 PF:4 VN:4 AO:3 AX:3 CA:3 ID:3 MV:3 PH:3
SC:3 BS:2 CO:2 EC:2 ES:2 GQ:2 IE:2 IL:2 MM:2 NC:2 TO:2 TR:2 VE:2 AE:1 AG:1
AU:1 BR:1 CL:1 DO:1 EE:1 EG:1 ER:1 FJ:1 FR:1 GM:1 GP:1 GR:1 GU:1 GW:1 HT:1
IR:1 JP:1 KM:1 LK:1 MO:1 MT:1 NI:1 PG:1 PT:1 ST:1 TH:1 TW:1
```

The shape is what SRTM's coverage predicts — high latitude (NO, FI, IS, GL, SE,
AX, FO) and small islands and coastal strips (HK 48, CV, FM, KY, MV, SC, PF).
Hong Kong alone contributes 48 of the 300, simply because it is where GeoNames
carries the most `dem`-less rows.

The committed shards no longer carry it. `c6fa7f5` nulled it at the ingest and
the nightly refresh rewrote every shard, so the current tree has **0 rows at
-9999 and 301 rows with `elev: null`**, spread over the same 71 countries in the
same proportions. FM went 9 → 10 in the same refresh that took the catalog from
58,748 cities to 58,757.

For §9.4 fix 4 — the elevation-dependent temperature correction — what matters
is that **301 cities have no elevation at all**, not that the sentinel is gone.
The correction must treat `null` as "no correction", and must not reach for
`-9999`, which would warm those towns by roughly 65 °C.

## Cost of the real build

Measured on this run (Windows 11, Node v24.14.1, four rasters, one month):

```
download        520,135,601 B in 108.2 s cold     (4.81 MB/s)
                tasmin 24.0 s   tasmax 24.8 s   pr 42.3 s   clt 17.1 s
sample          214.1 s warm    (tasmin 60.3  tasmax 75.5  pr 66.5  clt 11.7)
                four runs of the same code: 108.6, 150.9, 190.1, 214.1 s
peak RSS        175,403,008 B (167 MB)
wall, warm      222.3 s
```

The sampling figure is noisy — the same code over the same cached bytes ranged
from 108.6 s to 214.1 s across four runs on an otherwise busy laptop — so plan
against the top of that range, not its floor.

Extrapolated to twelve months of four variables — 48 rasters:

- **~6.24 GB downloaded** (12 × 520,135,601 B = 6,241,627,212 B), against the
  plan's 6.4 GB estimate. At the measured 4.81 MB/s that is **~22 minutes**.
- **~22–43 minutes of sampling**, which includes a cost the real ingest does not
  have to pay: the probe sweeps every cell of every decoded row looking for the
  sentinel, 1.59 billion cells in total. Dropping that sweep makes the real
  build faster than this range suggests.
- **Roughly an hour end to end**, and it is not parallel-safe to assume better —
  the host is academic infrastructure and §9.2 is right that this should be
  `workflow_dispatch` only.

**Memory is a non-issue and the sub-500 MB budget is met with room to spare.**
Peak RSS was 167 MB, and almost none of it is raster: a decoded row is 86,400 B,
released before the next is read. The 167 MB is the 58,757-row catalog plus the
per-shard JSON serialisation. Accumulating all twelve months of all four
variables for every city as Int32 would add only 48 × 58,757 × 4 = 11.3 MB, so a
build that holds the whole year in memory and writes 246 shards at the end still
fits inside 200 MB. Nothing needs streaming, and nothing needs the 1.8 GB a
whole-raster decode would take.

Disk: the rasters must be cached outside the repo — this working copy sits in a
OneDrive-synced folder. `scripts/probe-chelsa.mjs` uses `CIP_CHELSA_CACHE` if
set and the OS temp directory otherwise, and skips any file already present at
the advertised byte size.
