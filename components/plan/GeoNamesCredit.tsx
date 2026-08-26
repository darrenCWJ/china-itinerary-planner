/**
 * Attribution for the worldwide city catalog.
 *
 * GeoNames is CC BY 4.0 — attribution required. Every other data source this
 * app carries (OurAirports, Natural Earth) is public domain, so this is the
 * first one with a condition attached, and spec §7 calls it the one item in
 * the design with legal weight: the credit has to be **visible in the UI**, not
 * only a line in `data/cities-report.md`.
 *
 * It names TWO sources, verified against what actually ships:
 *
 *   - `public/cities/<CC>.json` stamps `"GeoNames cities500 (CC BY 4.0)"`, and
 *     `data/cities-report.md` repeats it with the https://www.geonames.org/
 *     link. Names, coordinates, admin-1 and timezone are all GeoNames'.
 *   - `public/cities/enrich/<CC>.json` stamps
 *     `"Wikidata (CC0) + Wikipedia (CC BY-SA) summaries"`. The descriptions
 *     rendered as `MapCity.blurb` are mostly Wikipedia intro extracts
 *     (`scripts/enrich-cities.mjs:709-714`, the `prop=extracts&exintro` call
 *     fed through `firstSentences`) — CC BY-SA 4.0, attribution AND
 *     share-alike, a stronger condition than CC BY.
 *
 * BOTH clauses indicate modification, which CC BY 4.0 §3(a)(1)(B) and CC BY-SA
 * 4.0 require just as much as the attribution itself. The data really is
 * modified: `scripts/ingest-cities.mjs` cuts to the top 750 per country,
 * resolves admin-1 codes to human-readable names and drops near-duplicates
 * within 5 km, and `firstSentences()` shortens every description to its opening
 * sentence or two. A credit that named the sources but implied the material was
 * verbatim would be a different licence breach, not a smaller one.
 *
 * Wikidata is deliberately NOT named, for two reasons that point the same way.
 * Its `schema:description` values are CC0 — public domain dedication, no
 * attribution condition to discharge — and naming a CC0 source here would imply
 * the credit is discretionary, when every line below is required. But it IS the
 * description for a measured 437 of the 5,105 committed descriptions (across 96
 * of 246 enrichment shards, classified as bare labels: under 120 characters, no
 * interior sentence punctuation, no copula — provenance is not stored per
 * record, so any count is a classification of the text), and for 100% of the
 * lazy runtime path in `lib/server/cityEnrichment.ts`. So the Wikipedia clause
 * must not claim ALL descriptions: the trailing clause below says the rest are
 * public-domain summaries, which is what makes the notice true rather than
 * merely over-generous. Over-attribution is not a breach; misstating provenance
 * in a legal notice is still wrong.
 *
 * No Wikimedia image credit is needed either: the enrichment carries a P18
 * Commons URL, but `MapCity` has no image field and nothing in `components/`
 * or `app/` reads `enrichment[...].image`, so no Commons file reaches the UI.
 *
 * It carries no `"use client"` of its own because it needs none: no state, no
 * effects, no handlers. That does not make it server-only — four of its five
 * call sites are inside client components, and a component imported by one is
 * compiled into the client bundle regardless of what directive it carries. It
 * is a handful of static elements either way.
 */

/**
 * `noopener noreferrer`, matching every other external link in the app
 * (components/trip/Rates.tsx:242, components/shell/CountryHero.tsx:133,141,
 * components/trip/JournalSection.tsx:217). `noreferrer` alone implies
 * `noopener` in current browsers, but a licence notice is the last place to
 * introduce the app's only inconsistent `rel`.
 */
const REL = "noopener noreferrer";

function Deed({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel={REL}
      className="underline underline-offset-2 hover:text-[var(--ink-0)]"
    >
      {children}
    </a>
  );
}

export function GeoNamesCredit() {
  return (
    <p className="text-[10px] leading-relaxed text-[var(--ink-2)]">
      City data from <Deed href="https://www.geonames.org/">GeoNames</Deed> — a filtered,
      modified subset — used under{" "}
      <Deed href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</Deed>. Descriptions
      adapted from <Deed href="https://en.wikipedia.org/">Wikipedia</Deed> — shortened intro
      extracts — used under{" "}
      <Deed href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</Deed>; some are
      short public-domain summaries instead, which carry no attribution condition.
    </p>
  );
}
