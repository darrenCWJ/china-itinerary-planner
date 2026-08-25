import { describe, expect, test } from "vitest";
import { DESTINATIONS } from "./data";
import { foldPlaceName } from "./foldPlaceName";
import { curatedPlaceNames } from "./curatedNames";

/**
 * One list, three readers. `lib/server/catalog.ts` filters the Wikidata
 * catalog with it, `PlaceSearch` filters the GeoNames shard with it, and
 * `MapExplorer` filters the map's markers with it — and before this module
 * existed only the first of those did, so a curated card and a bare shard row
 * for the same place could both be offered at once.
 */

describe("curatedPlaceNames", () => {
  test("covers every curated destination's own name, folded", () => {
    const cn = curatedPlaceNames("CN");
    for (const destination of DESTINATIONS) {
      expect(cn.has(foldPlaceName(destination.name))).toBe(true);
    }
  });

  test("covers the places a curated destination plans but does not name", () => {
    // "Guilin & Yangshuo" is one card. Yangshuo has no catalog.json row of its
    // own, so it survives the ingest's dedup and lands in the CN shard — and
    // without this list the picker offers a bare "Yangshuo" chip beside the
    // curated card that already plans three days there.
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
