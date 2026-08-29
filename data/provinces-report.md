# Province topologies

- Source: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson
- Licence: Natural Earth (public domain), via nvkelso/natural-earth-vector v5.1.2
- Generated: 2026-08-29T17:22:38.278Z

## Coverage

- Country files: **246**
- Admin-1 units shipped: **4592**
- Selectable units: **4583**
- Units carried for geometry only: **9**
- Countries with exactly one selectable unit: **34**
- Cities placed in a unit: **58270**
- Cities no rule places: **478**
- Admin-1 features no ISO rule and no override reaches: **0**

A country's outline is `merge()` over the very features its picker lists,
so a handful of files hold more units than they offer as choices. The
units below are carried for their geometry alone — they shape the outline
and are never clickable — because ISO 3166-1 governs territorial EXTENT
while ISO 3166-2 governs SUBDIVISION identity. Northern Cyprus, Akrotiri
and Dhekelia are part of CY's shape and none of them is a CY district;
Somaliland is part of SO's and Guantánamo part of CU's; Taiwan, Hong Kong
and Macau are part of CN's and hold files of their own, and CN's fourth is
the nine-dash line, which is a cartographic claim rather than any kind of
subdivision. Anything that counts geometries is therefore not counting
provinces — it must filter on `sel`.

```
CN:4 CU:1 CY:3 SO:1
```

## Size

- Raw: 9988898 B (9755 KB)
- Gzip: 3338327 B (3260 KB)
- Largest: CA, 139477 B gzip / 432755 B raw
- Gzip budget: 150000 B per file; raw tripwire 700000 B
