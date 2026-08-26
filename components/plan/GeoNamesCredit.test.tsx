import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { GeoNamesCredit } from "./GeoNamesCredit";

/**
 * GeoNames is CC BY 4.0 — the app's first attribution-required source, and the
 * one item in spec §7 with legal weight. A credit that only exists in
 * data/cities-report.md does not discharge the obligation, so this file tests
 * that it is rendered, that it names the source, and that it links the licence.
 *
 * vitest runs without globals, so testing-library registers no afterEach
 * cleanup of its own — without this every render stacks up in one document.
 */
afterEach(cleanup);

describe("GeoNamesCredit", () => {
  test("names GeoNames and links it", () => {
    render(<GeoNamesCredit />);

    const source = screen.getByRole("link", { name: /GeoNames/ });
    expect(source).toHaveAttribute("href", "https://www.geonames.org/");
  });

  test("names the licence and links its text", () => {
    // "CC BY 4.0" alone is not attribution; the licence has to be reachable.
    render(<GeoNamesCredit />);

    const licence = screen.getByRole("link", { name: "CC BY 4.0" });
    expect(licence).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
  });

  test("names Wikipedia and its share-alike licence too", () => {
    // The build-time descriptions are Wikipedia intro extracts, which are
    // CC BY-SA 4.0 — attribution AND share-alike, a stronger condition than
    // GeoNames'. This component is the app's only attribution surface, so it
    // has to carry both rather than being built for one.
    render(<GeoNamesCredit />);

    expect(screen.getByRole("link", { name: /Wikipedia/ })).toHaveAttribute(
      "href",
      "https://en.wikipedia.org/"
    );
    expect(screen.getByRole("link", { name: "CC BY-SA 4.0" })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by-sa/4.0/"
    );
  });

  test("pairs each source with its OWN licence, in one render", () => {
    /**
     * The three tests above each pass if the component names one source and
     * links the other's deed — which is precisely the failure this task exists
     * to prevent, and precisely the failure nobody would notice by reading it.
     * So: one render, and both (source, deed) pairs asserted as pairs, in the
     * order the sentence reads.
     *
     * `CC BY 4.0` and `CC BY-SA 4.0` must not be swapped either. GeoNames is
     * CC BY (`public/cities/PE.json` → "GeoNames cities500 (CC BY 4.0)"); the
     * Wikipedia extracts are CC BY-SA (`public/cities/enrich/PE.json` →
     * "Wikidata (CC0) + Wikipedia (CC BY-SA) summaries"). Share-alike on the
     * wrong source over-claims; CC BY on the wrong source under-claims, and
     * under-claiming is the licence breach.
     */
    const { container } = render(<GeoNamesCredit />);
    const text = container.textContent ?? "";

    const geonames = text.indexOf("GeoNames");
    const ccby = text.indexOf("CC BY 4.0");
    const wikipedia = text.indexOf("Wikipedia");
    const ccbysa = text.indexOf("CC BY-SA 4.0");

    for (const [label, at] of [
      ["GeoNames", geonames],
      ["CC BY 4.0", ccby],
      ["Wikipedia", wikipedia],
      ["CC BY-SA 4.0", ccbysa],
    ] as const) {
      expect(at, `"${label}" is missing from the credit`).toBeGreaterThanOrEqual(0);
    }

    // GeoNames … CC BY 4.0 … Wikipedia … CC BY-SA 4.0: each deed follows the
    // source it applies to and precedes the next source.
    expect(geonames).toBeLessThan(ccby);
    expect(ccby).toBeLessThan(wikipedia);
    expect(wikipedia).toBeLessThan(ccbysa);

    const href = (name: string | RegExp) =>
      screen.getByRole("link", { name }).getAttribute("href");
    expect(href(/GeoNames/)).toBe("https://www.geonames.org/");
    expect(href("CC BY 4.0")).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect(href(/Wikipedia/)).toBe("https://en.wikipedia.org/");
    expect(href("CC BY-SA 4.0")).toBe("https://creativecommons.org/licenses/by-sa/4.0/");
  });

  test("indicates the material was modified, beside each source it names", () => {
    /**
     * CC BY 4.0 §3(a)(1)(B) and CC BY-SA 4.0 both require an indication that
     * the material was changed, on the same footing as the attribution itself.
     * It unambiguously was: `scripts/ingest-cities.mjs` cuts to the top 750 per
     * country, resolves admin-1 codes to names and drops near-duplicates within
     * 5 km; `firstSentences()` in `scripts/enrich-cities.mjs` shortens every
     * description to its opening sentence or two.
     *
     * Asserted per source rather than per document, because "modified" written
     * once at the end would leave it ambiguous which of the two it applies to —
     * and one clause indicating modification while the other implies verbatim
     * material is still a breach on the verbatim-looking one. The window checked
     * is the text between a source and its OWN deed link, so a later copy edit
     * cannot satisfy this by leaving the word somewhere else in the sentence.
     */
    const MODIFICATION = /\b(?:modified|adapted|filtered|shortened|abridged|subset|excerpt)/i;

    const { container } = render(<GeoNamesCredit />);
    const text = container.textContent ?? "";

    for (const [source, deed] of [
      ["GeoNames", "CC BY 4.0"],
      ["Wikipedia", "CC BY-SA 4.0"],
    ] as const) {
      const from = text.indexOf(source);
      const to = text.indexOf(deed);
      expect(from, `"${source}" is missing from the credit`).toBeGreaterThanOrEqual(0);
      expect(to, `"${deed}" is missing from the credit`).toBeGreaterThan(from);
      expect(
        text.slice(from + source.length, to),
        `the ${source} clause does not indicate the material was modified`
      ).toMatch(MODIFICATION);
    }
  });

  test("does not claim every description is Wikipedia's", () => {
    /**
     * A measured 437 of the 5,105 committed descriptions are Wikidata
     * `schema:description` values rather than Wikipedia extracts — the fallback
     * at `scripts/enrich-cities.mjs:714`, `firstSentences(extract) ??
     * entity.description` — and the entire lazy runtime path in
     * `lib/server/cityEnrichment.ts` returns nothing else. Those are CC0: public
     * domain dedication, no attribution or share-alike condition at all.
     *
     * Over-attribution is not a breach, but a legal notice that misstates
     * provenance is still wrong, so the copy has to leave room for them. The
     * source itself stays unnamed — the test below pins that, and a CC0 source
     * named beside CC BY-SA deeds would imply a condition it does not carry.
     */
    const { container } = render(<GeoNamesCredit />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/public[- ]domain/i);
    // Positioned after the share-alike deed, so it reads as an exception to the
    // Wikipedia clause rather than as a claim about GeoNames.
    expect(text.indexOf("CC BY-SA 4.0")).toBeLessThan(text.search(/public[- ]domain/i));
  });

  test("opens every link safely in a new tab", () => {
    render(<GeoNamesCredit />);

    const links = screen.getAllByRole("link");
    // Iterated rather than counted: the licence list may grow, and a count
    // here would be a second place to remember to update.
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      // Token-wise rather than string-equal: the repo's four other external
      // links all use "noopener noreferrer" and this one matches them, but
      // what actually matters is that both tokens are present.
      const rel = (link.getAttribute("rel") ?? "").split(/\s+/);
      expect(rel, `${link.getAttribute("href")} is missing rel=noreferrer`).toContain("noreferrer");
      expect(rel, `${link.getAttribute("href")} is missing rel=noopener`).toContain("noopener");
    }
  });

  test("is readable text, not an aria-hidden decoration", () => {
    // A credit hidden from the accessibility tree is not a visible credit.
    const { container } = render(<GeoNamesCredit />);
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
    expect(container.textContent).toContain("GeoNames");
  });

  test("does not name a source whose licence it fails to link", () => {
    /**
     * The inverse guard: if someone adds "Wikidata" or "Wikimedia Commons" to
     * the sentence, they have taken on that source's terms too, and this fails
     * until the deed is linked beside it. Wikidata is CC0 today — no
     * attribution condition — which is exactly why it is absent from the copy;
     * a Commons image would be neither CC0 nor uniformly licensed.
     */
    const { container } = render(<GeoNamesCredit />);
    const text = container.textContent ?? "";
    for (const unlicensed of ["Wikidata", "Wikimedia", "Commons", "OpenStreetMap"]) {
      expect(text, `"${unlicensed}" is named without a linked licence`).not.toContain(unlicensed);
    }
  });
});
