import { describe, expect, test } from "vitest";
import { DESTINATIONS } from "./data";
import { foldPlaceName } from "./foldPlaceName";
import { curatedPlaceNames } from "./curatedNames";

/**
 * One list, written for three readers. `lib/server/catalog.ts` filters the
 * Wikidata catalog with it today; `PlaceSearch` (the GeoNames shard) and
 * `MapExplorer` (the map's markers) are still to be switched over. Before this
 * module existed the list was private to the first of those, so a curated card
 * and a bare shard row for the same place could both be offered at once.
 */

describe("curatedPlaceNames", () => {
  test("covers every curated destination's own name, folded", () => {
    const cn = curatedPlaceNames("CN");
    for (const destination of DESTINATIONS) {
      expect(cn.has(foldPlaceName(destination.name))).toBe(true);
    }
  });

  test("covers the places a curated destination plans but does not name", () => {
    // "Guilin & Yangshuo" is one card, so a shard row spelled plainly
    // "Yangshuo" would be offered as a second chip beside it. Of these six,
    // only "Dali" is in the committed public/cities/CN.json today — the rest
    // are forward defence against a nightly re-ingest that promotes one of
    // them into China's cut. See lib/curatedNames.ts for the measurement.
    for (const name of ["Guilin", "Yangshuo", "Kunming", "Dali", "Lijiang", "Zhangjiajie"]) {
      expect(curatedPlaceNames("CN").has(foldPlaceName(name))).toBe(true);
    }
  });

  test("is keyed by country, so another country's Dali is still reachable", () => {
    expect(curatedPlaceNames("PE").has(foldPlaceName("Dali"))).toBe(false);
    expect(curatedPlaceNames("PE").size).toBe(0);
  });

  test("normalises the country and answers an empty set for a malformed one", () => {
    expect(curatedPlaceNames(" cn ").size).toBeGreaterThan(0);
    expect(curatedPlaceNames("").size).toBe(0);
    expect(curatedPlaceNames("CHN").size).toBe(0);
  });
});
