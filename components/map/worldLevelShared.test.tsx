import { describe, expect, test } from "vitest";
import { getCountry } from "@/lib/countries";
import { getCountryName } from "@/lib/countryFacts";
import { countryLabel } from "./worldLevelShared";

/**
 * `countryLabel`'s docblock makes a claim about three modules — "the map, the
 * destination step and the plan all call a country the same thing" — and until
 * this file nothing held it to that. It was false for two countries.
 *
 * The claim is worth a test rather than a comment because the failure is
 * invisible from inside the map. `countryLabel` falls back to the topology's
 * name when `getCountry` hands back the bare code, so the ONE resolver that
 * could detect the gap is the one that hides it: the map read "Antarctica" off
 * Natural Earth and looked correct, while `MapExplorer` and `DestinationStep`
 * — which call `getCountry` directly, with no topology to fall back to —
 * titled the same country **AQ**.
 *
 * lib/isoTopology.test.ts holds the other half, derived from the asset: no code
 * the map DRAWS resolves to its own two letters. This file holds the agreement
 * between the three resolvers for the codes that broke it.
 */
describe("countryLabel", () => {
  test("this app's name beats the topology's", () => {
    // The headline claim, and the reason the function exists at all. Natural
    // Earth says "Turkey" and Wikidata says "People's Republic of China"; the
    // app has said "Türkiye" and "China" everywhere else since CURATED landed.
    expect(countryLabel("TR", "Turkey")).toBe("Türkiye");
    expect(countryLabel("CN", "People's Republic of China")).toBe("China");
  });

  test("an ingested name beats the topology's too, which is the other 222", () => {
    expect(countryLabel("GA", "Gabon")).toBe("Gabon");
    expect(countryLabel("PE", "Peru")).toBe("Peru");
  });

  test("the topology is the fallback only for a code no table knows", () => {
    // Unreachable for the 250 codes ISO_NUMERIC_TO_ALPHA2 carries, and kept for
    // a rebuilt asset that gains a feature keyed to something else: rendering
    // that feature's own name beats rendering two letters.
    expect(countryLabel("ZZ", "Some Future Place")).toBe("Some Future Place");
    // And it degrades rather than throwing when there is nothing to fall back
    // on either, because a map with a nameless node beats a map that crashed.
    expect(countryLabel("ZZ", "")).toBe("");
  });

  test("the three resolvers agree about the countries that broke this", () => {
    // AQ and HM are drawn on the world map (a feature in
    // public/world-countries.json, absent from SEARCH_ONLY) and the facts
    // artifact has no record of either, both being uninhabited. That
    // combination is the whole defect: reachable from the picker, nameless
    // everywhere the picker leads. BV and UM share the nameless state and are
    // search-only, and are named for the same reason — `getCountry` is total
    // and spec §6 makes search the guaranteed path to every country.
    for (const [code, name] of [
      ["AQ", "Antarctica"],
      ["BV", "Bouvet Island"],
      ["HM", "Heard Island and McDonald Islands"],
      ["UM", "United States Minor Outlying Islands"],
    ] as const) {
      // The map, given a topology name it should now ignore...
      expect(countryLabel(code, "IGNORED"), `${code} via countryLabel`).toBe(name);
      // ...the destination step and the map pane...
      expect(getCountry(code).name, `${code} via getCountry`).toBe(name);
      // ...and the plan's sentences.
      expect(getCountryName(code), `${code} via getCountryName`).toBe(name);
    }
  });

  test("HM is no longer called what its geometry file calls it", () => {
    // Natural Earth abbreviates: "Heard I. and McDonald Is.". While the map was
    // deferring to the topology for this code, agreeing with it would have
    // meant agreeing with an abbreviation — so HM was not merely nameless
    // downstream, it was differently named upstream.
    expect(countryLabel("HM", "Heard I. and McDonald Is.")).toBe(
      "Heard Island and McDonald Islands"
    );
  });
});
