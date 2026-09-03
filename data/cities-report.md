# Worldwide city catalog report

- Generated: 2026-09-03T09:27:18.747Z
- Source: https://download.geonames.org/export/dump/cities500.zip
- Licence: GeoNames cities500 (CC BY 4.0) — https://www.geonames.org/ — CC BY 4.0
- Filter: composite score (alternate names + 2 x log10 population), top 750 per country
- Deduplicated against data/catalog.json within 5 km on a folded name match

**58757 cities across 246 countries.**

Largest shard: AR at 112.5 KB raw.

## Attribution

GeoNames data is licensed CC BY 4.0, which requires a visible credit AND an
indication that the material was changed. It was: the filter above cuts each
country to its top scorers, admin-1 codes are resolved to human-readable
names, and near-duplicates of the curated catalog are dropped. Both the credit
and the modification notice are rendered in the UI by
`components/plan/GeoNamesCredit.tsx`, from these files:

- `app/plan/page.tsx` — the planning wizard, beside the footer rather than
  inside it, because that footer is `print:hidden` and the generated plan is
  meant to be printed
- `components/DestinationStep.tsx` — the destination step, under the search
- `components/TripView.tsx` — twice: the member view and the join-code guest
  view of the shared trip page
- `app/b/[code]/page.tsx` — the bearer-link briefing
- `components/shell/ShareBriefing.tsx` — the briefing behind Share › "View
  briefing". It carries its own credit rather than inheriting one, because
  nothing in its ancestry renders a credit: ShareMenu, then AppShell, then
  the root layout, which wraps every route
- `components/home/TripsDashboard.tsx` — the signed-in home page trip list

`lib/contracts.test.ts` (C7) fails if one of the files listed above drops it.
That list is not the whole guarantee, because a hardcoded list cannot catch a
surface added later: C7 also derives the set, scanning every `.tsx` under
`app/` and `components/` for the tokens that carry city names and requiring
each match to either render the credit or sit on an explicit allowlist naming
the parent surface that renders it instead.

This file is NOT the credit and never was — a line in a generated report does
not discharge CC BY 4.0. It records where the credit lives so that deleting
the component is a visible break rather than a silent one.

## Most cities by country

| Country | Cities |
| --- | --- |
| AR | 750 |
| AT | 750 |
| AU | 750 |
| BE | 750 |
| BR | 750 |
| CA | 750 |
| CH | 750 |
| CI | 750 |
| CO | 750 |
| CZ | 750 |
| DE | 750 |
| ES | 750 |
| FI | 750 |
| FR | 750 |
| GB | 750 |
