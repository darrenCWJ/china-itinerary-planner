# Country facts report

- Generated: 2026-08-27T07:40:53.049Z
- Source: https://query.wikidata.org/sparql (Wikidata (CC0))
- Licence: CC0-1.0
- Contents: structured scalars only. Never prose, never a sentence.

**246 countries carry at least one fact.**

A country with none is absent from the artifact entirely and falls through to
`lib/countryProfile.ts`'s neutral profile, which is the honest default. A field
with no supporting data is ABSENT from its record — never an empty string, never
an empty array, never a placeholder — and the template that would render it
simply does not run.

## Coverage by field

| Field | Countries | Share |
| --- | --- | --- |
| `currencyCode` | 239 | 97.2% |
| `currencyName` | 239 | 97.2% |
| `plugs` | 207 | 84.1% |
| `voltageV` | 221 | 89.8% |
| `drivingSide` | 245 | 99.6% |
| `emergency` | 221 | 89.8% |
| `officialLanguages` | 243 | 98.8% |
| `callingCode` | 237 | 96.3% |
| `lat` | 246 | 100.0% |

## Countries by rendered-field count

Of the seven fields that reach a traveller. A country lower down this table is
not a country we got wrong — it is one whose gap note names, per field, exactly
what we do not have.

| Rendered fields | Countries |
| --- | --- |
| 7 of 7 | 187 |
| 6 of 7 | 31 |
| 5 of 7 | 12 |
| 4 of 7 | 10 |
| 3 of 7 | 6 |

## Thinnest records

| Country | Facts |
| --- | --- |
| SH | 4 |
| IO | 4 |
| TF | 5 |
| SJ | 5 |
| CX | 5 |
| CC | 5 |
| WF | 6 |
| TK | 6 |
| SX | 6 |
| PN | 6 |
| NF | 6 |
| NA | 6 |
| MP | 6 |
| LS | 6 |
| IM | 6 |

## Not derivable

Recorded so it is not re-litigated. Each of these was measured, not assumed.

- **Rail speed outside China.** Wikidata's "high-speed railway line" class returns
  lines for Peru, Panama, Ecuador, Bangladesh, Venezuela, Colombia, Australia and
  the Philippines. Either that or the World Bank's route-kilometre series would
  tell the app Peru is high-speed-rail friendly. Rail speed for a new country is a
  hand-written, cited entry in `lib/countryData/`.
- **Public holidays.** The open dataset with the best coverage reaches 204 of 246
  and misses IN, TH, MY, LK, NP, PK, MM, LA, IL, AE, SA, QA, KW, OM, JO, LB, TW,
  MO, MU, MV, FJ, UZ, IR, AZ and 18 more — disproportionately where holiday
  crowding matters most. It returns single dates rather than travel-impact bands.
  Wikidata's own holiday property reaches 73 of 246.
- **Per-month crowd pressure.** No open per-country per-month tourism seasonality
  source exists at this granularity.
- **Climate normals.** These need station data of a different order of size, and
  they are the highest-value future addition — climate is what actually answers
  "when should I go".
- **Payment apps, connectivity, booking channels, tipping, tap water, visa rules.**
  No structured source. Visa rules also depend on the traveller's passport, which
  the app does not know.
- **Plug letters for the fifteen BS 546 countries.** Measured 2026-08-27: the whole
  distinct P2853 value set across these countries is fourteen items, thirteen
  standards plus one Wikipedia article. One of the thirteen, `BS 546`, is a single
  Wikidata item covering both of its sizes — the 5 A variant is IEC type D and the
  15 A variant is type M — and the statement carries nothing that separates them.
  Guessing D would publish "South Africa uses type C/D/N" when South Africa's
  round-pin sockets are the 15 A type M, and a traveller who buys a type D adapter
  on that sentence finds it does not fit. So the whole plug field is withheld for
  MO, BT, MZ, PK, IL, PS, ZA, IN, BW, LK, NP, SZ, NG, NA and LS, and the gap note
  names it. Splitting the item upstream, or a qualifier that gives the current
  rating, is what would fix this.
- **Anything about a country the app has no city shard for.** The query is bounded
  to the 246 codes under `public/cities`. Measured 2026-08-27, an unbounded P297
  query answers with 259: the extra thirteen are AC, AN, AQ, BV, CP, CQ, DD, DG,
  HM, PC, TA, UM and YU — exceptionally reserved codes, uninhabited territories,
  and the historical Netherlands Antilles, East Germany and Yugoslavia. Facts about
  East Germany would pass every gate in the ingest and answer a question no user
  can ask.

## Attribution

Wikidata's main and property namespaces are CC0 — a public domain dedication with
NO attribution condition to discharge. **No UI credit is added for this source,
and that is a decision rather than an oversight.**

`components/plan/GeoNamesCredit.tsx` already argues this exact case for this exact
source in its own doc-comment: naming a CC0 source inside a legal notice would
imply the credits beside it are discretionary, when every one of them is required.
Adding one here would weaken the notice.

This file is therefore deliberately outside the C7 derived contract in
`lib/contracts.test.ts`, which names `data/cities-report.md` specifically. If a
future task adds a source that DOES carry an attribution condition, that task owns,
in a single commit: the clause in `GeoNamesCredit.tsx`, the C7 token-list widening,
and the enumerated-surface update in `data/cities-report.md`.
