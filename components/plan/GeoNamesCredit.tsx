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
 *     rendered as `MapCity.blurb` are Wikipedia intro extracts
 *     (`scripts/enrich-cities.mjs:709-714`, the `prop=extracts&exintro` call
 *     fed through `firstSentences`) — CC BY-SA 4.0, attribution AND
 *     share-alike, a stronger condition than CC BY.
 *
 * Wikidata is deliberately NOT named. It is the FALLBACK description when
 * Wikipedia has no extract (`firstSentences(extract) ?? entity.description`)
 * and the sole source for the runtime path in `lib/server/cityEnrichment.ts`,
 * but its `schema:description` values are CC0 — public domain dedication, no
 * attribution condition to discharge. Naming a CC0 source here would imply the
 * credit is discretionary; every line below is required.
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
      City data from <Deed href="https://www.geonames.org/">GeoNames</Deed>, used under{" "}
      <Deed href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</Deed>. Descriptions
      from <Deed href="https://en.wikipedia.org/">Wikipedia</Deed>, used under{" "}
      <Deed href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</Deed>.
    </p>
  );
}
