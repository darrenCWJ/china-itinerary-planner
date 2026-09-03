# Climate normals

- Source: https://os.zhdk.cloud.switch.ch/chelsav2/GLOBAL/climatologies/1981-2010/<var>/CHELSA_<var>_<MM>_1981-2010_V.2.1.tif
- Licence: CC0 1.0 — CHELSA V2.1 climatologies 1981–2010, DOI 10.16904/envidat.228
- Generated: 2026-09-03T19:48:35.466Z
- Built by: `node scripts/ingest-climate.mjs`, Node v24.14.1
- Catalog: the 246 committed shards under `public/cities/`, **58757 cities**

## Layout

Per city, 60 positional integers — five blocks of twelve, **calendar-indexed**
with January at index 0 of every block:

```
[ 0..11]  lo      °C          tasmin
[12..23]  hi      °C          tasmax
[24..35]  precip  mm/month    pr
[36..47]  cloud   %           clt
[48..59]  td      °C          derived
```

`td` is the August–Roche–Magnus dew point on `T = (lo + hi) / 2` and the raw
monthly mean relative humidity from `hurs`, and it is **uncorrected**: spec
§9.4's humidity-bias correction lives in the fit model at read time, where it
can be retuned without re-running this build. `hurs` itself is never written
(§13). Nothing here is hemisphere-flipped — the rasters come out
calendar-ordered and no `seasonIn` is applied on the way in.

The rows join `public/cities/<CC>.json` on the city id. Elevation is not
repeated here; a consumer that needs it reads `elev` from the city row, where
301 of 58757 rows carry `null` and must be treated as "no correction".

## Coverage

- Country shards: **246**
- Cities with a climate row: **58757**
- Cities dropped for an unwritable month: **0**
- Cities no raster could place: **0**
- Samples on the file's declared nodata sentinel: **0** of 3525420

The last three are zero and are expected to stay zero, but none of them is
guaranteed by the format. CHELSA V2.1 is modelled over ocean as well as land,
so there is no coastline to fall off and no sentinel to land on — a property
of this release, not of the product. A future release that changes it would
drop whole cities silently, because 60 positional integers carry no per-month
absence marker: one unwritable month and the city cannot be written at all.
That is why all three are gates and not statistics.

## Rasters

- Variables: tasmin, tasmax, pr, clt, hurs — 12 months each, 60 files
- On disk: 10653609738 B (10.65 GB)
- Downloaded by this run: 0 B (0.00 GB); 60 of 60 files were already cached

| variable | grid | rows touched | bytes | downloaded | sample |
|---|---|---|---|---|---|
| `tasmin` | 43200×20880 @ 0.0083333333° | 11771 of 20880 | 1456659970 B | 0 B | 378.1 s |
| `tasmax` | 43200×20880 @ 0.0083333333° | 11771 of 20880 | 1450131784 B | 0 B | 371.9 s |
| `pr` | 43200×20880 @ 0.0083333333° | 11771 of 20880 | 2877520406 B | 0 B | 380.7 s |
| `clt` | 14401×7201 @ 0.02499999° | 4511 of 7201 | 712735369 B | 0 B | 61.8 s |
| `hurs` | 43200×20880 @ 0.0083333333° | 11771 of 20880 | 4156562209 B | 0 B | 321.4 s |

Two grids, not one: `clt` is a coarser raster on its own origin that reaches
both poles, where the other four stop at +84°. Each file carries its own
transform, scale, offset and sentinel, and this build reads all of them off
the file — §9.1 states the scale and omits the −273.15 offset, which alone
would have reported Singapore at 298 °C.

```
tasmin  scale 0.1   offset -273.15  nodata -2147483647
tasmax  scale 0.1   offset -273.15  nodata -2147483647
pr      scale 0.1   offset 0        nodata -2147483647
clt     scale 0.01  offset 0        nodata 65535
hurs    scale 0.01  offset 0        nodata 65535
```

## Cost

- Download: 0 B in 0.0 s
- Sample: 1513.8 s over 619140 row reads
- Wall clock: 1556.7 s (25.9 min)
- Peak RSS: 215924736 B (206 MB)

Spec §14.8 budgeted this run at "tens of minutes, single-digit GB,
sub-500 MB RSS" and asked for the truth. Two of the three hold. **The download
does not**: 10.65 GB, because §9.1's variables row omits `hurs`, and
the fifth variable is the second largest of the five. A runner that provisions
for single-digit GB of scratch disk will not finish.

Memory is a non-issue and stays one. A decoded row is 86 KB on the 1 km grid
and is released before the next is read; the resident cost is the catalog plus
the whole year's decoded samples, which is 28.20 MB of Float64 for
58757 cities. Nothing needs streaming, and nothing needs the 1.8 GB a
whole-raster decode would take.

## Size

- Raw: 11008116 B (11.01 MB)
- Gzip: 2489418 B (2.49 MB)
- Largest shard by raw bytes: ID, 152210 B raw / 36978 B gzip
- Worst shard by gzip bytes: IN, 39490 B gzip / 143489 B raw
- Median shard: SV, 20059 B raw / 4881 B gzip
- Shards over the 150000 B gzip budget: **0 of 246**
- Shards over the 700000 B raw tripwire: **0 of 246**

**The cap is not saturated.** The worst shard uses 26.3% of the
150000 B gzip budget — 73.7% of it goes unused — and the
runners-up are clustered just below it (BR 38792, CO 38789, RU 38443, US 38144, MX 37828),
so the result is not one country's luck. Unlike the city shard's cap, this one
is not binding, and a future reader should not treat it as the constraint that
shaped the layout: the fifth block was added on top of a 48-int layout the
probe had already shown fits, and it still does not come close.

The biggest file and the worst one are different countries (ID by raw, IN by gzip).
Raw bytes follow city count and id lengths; gzip follows how much the twelve
months of a place actually vary. Any budget test must therefore be written
against the maximum over all shards, not against the largest file.

## Against the probe

`data/climate-probe.md` sized this artifact from **January alone**, and never
sampled `hurs` at all — its 60-int figures extrapolate the fifth block from the
cloud column, and its gzip figure treats the twelve months as independent
columns, which real months are not. It said so, and predicted the direction of
its own error. Measured against those predictions:

| | predicted | measured | off by |
|---|---|---|---|
| whole artifact, raw | 11089517 B | 11008116 B | −0.7% |
| whole artifact, gzip | 3480000 B | 2489418 B | −28.5% |
| worst shard, gzip | 55000 B | 39490 B | −28.2% |

Raw came out almost exactly where January said it would; both gzip figures
came in well under, in the direction the probe named — it measured that the
marginal cost of a column FALLS as columns are added, so treating twelve
months as independent could only overstate the total.

The countries moved, as the probe warned they would. §9.3 named VN as the
largest shard and the probe corrected that to ID; measured, it is ID. The
probe named CO as the worst by gzip; measured, it is IN. The leaders are a
few per cent apart because they all sit on the ingest's 750-city-per-country
cap, so which one wins is decided by id lengths and digit widths and will move
between refreshes — nothing should be written that depends on a particular
country being the largest.

## Source

CHELSA V2.1 climatologies 1981–2010, **CC0 1.0**, DOI 10.16904/envidat.228.

CC0 waives the licence conditions, so this section is a courtesy credit and
not a term this project has to meet — deliberately `## Source` rather than the
`## Attribution` heading `data/cities-report.md` uses for GeoNames, whose
CC BY 4.0 credit is enforced by a byte-for-byte contract test. Karger, D.N.,
Conrad, O., Böhner, J., Kawohl, T., Kreft, H., Soria-Auza, R.W., Zimmermann,
N.E., Linder, H.P. & Kessler, M. (2017). Climatologies at high resolution for
the earth's land surface areas. Scientific Data 4, 170122.
