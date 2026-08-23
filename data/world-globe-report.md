# World globe topology

- Source: https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json
- Licence: Public domain (Natural Earth 1:110m, via world-atlas@2)
- Generated: 2026-08-23

## Coverage

- Polygons drawn at 110m: **174**
- Point-layer countries: **77**
- Reachable codes (polygons union points): **235**
- Codes the 50m flat map draws: **235**
- Codes 110m omits, carried as points: **61**

The globe reaches every country the flat map does, but gets there
differently: 110m carries no feature at all for the codes below, so their
point is the only thing that makes them selectable. On the flat map every
point-layer country also has a polygon underneath it; on the globe most do
not. That is why `lib/globeTopology.ts` exists rather than reusing
`lib/isoTopology.ts`, whose contract asserts the opposite.

```
AD AG AI AS AW AX BB BH BL BM CK CV CW DM FM FO GD GG GS GU HK HM IM IO JE KI KM KN KY LC LI MC MF MH MO MP MS MT MU MV NF NR NU PF PM PN PW SC SG SH SM ST SX TC TO VA VC VG VI WF WS
```

## Size

- Raw: 108 KB
