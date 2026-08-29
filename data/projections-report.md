# Country projections

- Source: the committed `public/provinces/<CC>.json` outlines, merged with `topojson-client`
- Licence: as the province files — see [provinces-report.md](provinces-report.md)
- Viewport: 860 x 620, read from `lib/mapView.ts`
- Generated: 2026-08-29T19:14:25.970Z

## Coverage

- Entries: **246**
- Countries drawn from more than one polygon: **150**
- Countries rotated off the antimeridian: **5**
- Countries whose fit leaves a polygon out of frame: **9**
- Multi-polygon countries the gates refused to trim: **141**
- Largest hidden area: **0.890%**

The nine trims below are far fewer, and far smaller, than the spec
predicted — and the reason is not cartographic. The spec's headline case
was the Netherlands at 11.51x, hiding Bonaire, Saba and Sint Eustatius;
those three are now `BQ.json`, a country of their own, so there is no
longer a Dutch polygon for a projection to hide. New Zealand went the same
way when Tokelau became `TK.json`. A cartographic workaround was retired
by a data-model decision, and anyone comparing this table against the
spec's should read the difference as the territory policy working rather
than as the rule disagreeing.

## Rotations

Rule 1: everyone else takes `rotate: 0`. These cross the antimeridian,
where an unrotated fit reads a 3-degree-wide country as a 357-degree one
and collapses.

```
FJ -178.1874  KI 171.1295  NZ -174.8857  RU -105.3083  US 130.1797
```

## Trims accepted

Gate A: at most 1% of the country hidden. Gate B: separation at least 0.5,
as centroid distance in degrees over the anchor's own bbox diagonal. Gate
C: the country must draw at least 1.5x bigger for the loss to be worth it.

| code | hides | % area | km2 hidden | scale before | scale after | gain | sep |
|---|---|---|---|---|---|---|---|
| FR | 1 | 0.001% | 5.1 | 414.79 | 2518.21 | 6.07x | 7.50 |
| FJ | 7 | 0.890% | 39.6 / 14.8 / 2.3 / 1.4 / 84 / 9.8 / 17.1 | 3671.62 | 11120.88 | 3.03x | 1.51 |
| PN | 1 | 0.338% | 0.1 | 8246.73 | 20006.43 | 2.43x | 32.92 |
| MU | 1 | 0.697% | 14.1 | 3354.36 | 7959.76 | 2.37x | 13.67 |
| TF | 7 | 0.345% | 2 / 0.3 / 4 / 0 / 0 / 0.1 / 18.5 | 774.84 | 1797.70 | 2.32x | 17.36 |
| ZA | 2 | 0.026% | 275.1 / 43.9 | 1159.74 | 2451.61 | 2.11x | 1.05 |
| AI | 1 | 0.288% | 0.3 | 78001.92 | 146235.93 | 1.87x | 2.36 |
| GQ | 1 | 0.053% | 14.2 | 6765.10 | 12463.37 | 1.84x | 2.33 |
| CR | 1 | 0.031% | 15.8 | 6168.83 | 11028.87 | 1.79x | 1.14 |

## Size

- Raw: 20843 B
- Gzip: 6884 B
- Mean: 84.7 B/entry
