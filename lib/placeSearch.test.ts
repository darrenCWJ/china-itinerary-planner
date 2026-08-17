import { describe, expect, it } from "vitest";
import { rankPlaces, type SearchableCurated, type SearchableHit } from "./placeSearch";

/**
 * One ranked list from two sources (spec §3.2.2): curated above catalog, prefix
 * above substring, and a terminal "add it yourself" row so a place nobody has
 * heard of is still reachable (§3.2.7).
 */

const curated = (
  id: string,
  name: string,
  extra: Partial<SearchableCurated> = {}
): SearchableCurated => ({ id, name, localName: null, knownFor: [], ...extra });

const hit = (qid: string, name: string, extra: Partial<SearchableHit> = {}): SearchableHit => ({
  qid,
  name,
  localName: null,
  province: null,
  ...extra,
});

describe("rankPlaces", () => {
  it("returns nothing for a blank query", () => {
    // Not even the off-map row: "add '' as its own place" is not an offer.
    expect(rankPlaces("", [curated("a", "Anywhere")], [])).toEqual([]);
    expect(rankPlaces("   ", [curated("a", "Anywhere")], [])).toEqual([]);
  });

  it("puts curated results above catalog results", () => {
    const results = rankPlaces(
      "hang",
      [curated("hangzhou", "Hangzhou")],
      [hit("Q123", "Hangu")]
    );

    expect(results.map((r) => r.kind)).toEqual(["curated", "catalog", "off-map"]);
    expect(results[0].id).toBe("hangzhou");
  });

  it("ranks a prefix match above a substring match", () => {
    // The substring match is deliberately first in the input. With it second,
    // the stable sort would produce the expected order even if prefix and
    // substring scored the same — verified by probe that this ordering is what
    // makes the assertion actually test the scoring.
    const results = rankPlaces(
      "an",
      [curated("xian", "Xi'an"), curated("anshan", "Anshan")],
      []
    );

    expect(results.filter((r) => r.kind === "curated").map((r) => r.id)).toEqual([
      "anshan",
      "xian",
    ]);
  });

  it("matches the local-language name", () => {
    const results = rankPlaces("杭", [curated("hangzhou", "Hangzhou", { localName: "杭州" })], []);

    expect(results[0].id).toBe("hangzhou");
  });

  it("matches what a place is known for, below name matches", () => {
    const results = rankPlaces(
      "panda",
      [curated("chengdu", "Chengdu", { knownFor: ["pandas", "hotpot"] }), curated("panda-town", "Pandaville")],
      []
    );

    // The name match wins: someone typing "panda" who meant the town said so.
    expect(results.filter((r) => r.kind === "curated").map((r) => r.id)).toEqual([
      "panda-town",
      "chengdu",
    ]);
  });

  it("drops a catalog hit that shadows a curated place", () => {
    // The catalog covers every city on Earth, so it also contains the ones that
    // are curated. Showing both offers the same trip twice, and the curated
    // entry is the one with researched days and activities.
    const results = rankPlaces(
      "hangzhou",
      [curated("hangzhou", "Hangzhou")],
      [hit("Q4970", "Hangzhou"), hit("Q999", "Hangzhou Bay")]
    );

    expect(results.filter((r) => r.kind === "catalog").map((r) => r.name)).toEqual([
      "Hangzhou Bay",
    ]);
  });

  it("flags places already selected instead of hiding them", () => {
    // Hiding them makes a place the user just added look like it vanished; the
    // flag lets the UI show it as added and refuse a second add.
    const results = rankPlaces("hang", [curated("hangzhou", "Hangzhou")], [], {
      selectedIds: ["hangzhou"],
    });

    expect(results[0].isSelected).toBe(true);
  });

  it("offers an off-map row last when nothing matches exactly", () => {
    const results = rankPlaces("Grandma's village", [curated("hangzhou", "Hangzhou")], []);

    const last = results[results.length - 1];
    expect(last.kind).toBe("off-map");
    expect(last.name).toBe("Grandma's village");
  });

  it("withholds the off-map row on an exact name match", () => {
    // The place exists and is right there — a second "add it yourself" row for
    // the same name would just create a duplicate.
    const results = rankPlaces("Hangzhou", [curated("hangzhou", "Hangzhou")], []);

    expect(results.some((r) => r.kind === "off-map")).toBe(false);
  });

  it("treats an exact catalog name as exact too", () => {
    const results = rankPlaces("Hangu", [], [hit("Q123", "Hangu")]);

    expect(results.some((r) => r.kind === "off-map")).toBe(false);
  });

  it("is case- and whitespace-insensitive about exactness", () => {
    const results = rankPlaces("  hangZHOU ", [curated("hangzhou", "Hangzhou")], []);

    expect(results[0].id).toBe("hangzhou");
    expect(results.some((r) => r.kind === "off-map")).toBe(false);
  });

  it("ranks stably for equally-scoring places", () => {
    // Same score, so input order decides. Without this the list reshuffles as
    // the user types and the row under their finger changes.
    const places = [curated("b", "Bxx"), curated("a", "Axx"), curated("c", "Cxx")];
    const first = rankPlaces("x", places, []).map((r) => r.id);
    const second = rankPlaces("x", places, []).map((r) => r.id);

    expect(first).toEqual(second);
    expect(first.slice(0, 3)).toEqual(["b", "a", "c"]);
  });

  it("excludes non-matching places entirely", () => {
    const results = rankPlaces("zzz", [curated("hangzhou", "Hangzhou")], [hit("Q1", "Hangu")]);

    expect(results.map((r) => r.kind)).toEqual(["off-map"]);
  });

  it("caps how many catalog hits it returns", () => {
    const many = Array.from({ length: 50 }, (_, i) => hit(`Q${i}`, `Testville ${i}`));
    const results = rankPlaces("testville", [], many);

    expect(results.filter((r) => r.kind === "catalog").length).toBeLessThanOrEqual(10);
  });
});

describe("rankPlaces query normalisation", () => {
  // Found in the browser: typing "xian" matched the catalog's Xiangyang and
  // missed the curated Xi'an entirely, because the apostrophe broke the
  // substring test. Romanised names carry marks the searcher does not type.
  it("matches a name containing an apostrophe", () => {
    const results = rankPlaces("xian", [curated("xian", "Xi'an")], []);

    expect(results[0].id).toBe("xian");
    expect(results.some((r) => r.kind === "off-map")).toBe(false);
  });

  it("matches a name carrying diacritics", () => {
    const results = rankPlaces("urumqi", [curated("urumqi", "Ürümqi")], []);

    expect(results[0].id).toBe("urumqi");
  });

  it("still treats an accented exact name as exact", () => {
    const results = rankPlaces("Ürümqi", [curated("urumqi", "Ürümqi")], []);

    expect(results.some((r) => r.kind === "off-map")).toBe(false);
  });

  it("does not collapse genuinely different names", () => {
    const results = rankPlaces("xian", [curated("xiamen", "Xiamen")], []);

    expect(results.filter((r) => r.kind === "curated")).toHaveLength(0);
  });
});
