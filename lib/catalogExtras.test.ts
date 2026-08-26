import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { mergeCatalogHit, shouldFetchEnrichment } from "./catalogExtras";
import type { CatalogHit } from "./tripShared";

/**
 * The merge rule behind `app/plan/page.tsx`'s `extras`.
 *
 * The two hits below are the two real producers, verbatim in shape:
 * `MapExplorer.togglePlace` spreads a `MapCity` and knows everything the
 * catalog knew; `DestinationStep.addPlace` spreads a `RankedPlace` and sends
 * `description: null`, `population: null`, `attractionCount: 0` because a
 * ranked row never held them.
 */
const FROM_MAP: CatalogHit = {
  qid: "G3941584",
  name: "Cusco",
  localName: null,
  province: "Cusco",
  description: "historic city of Peru",
  population: 312_140,
  attractionCount: 7,
};

const FROM_SEARCH: CatalogHit = {
  qid: "G3941584",
  name: "Cusco",
  localName: null,
  province: "Cusco",
  description: null,
  population: null,
  attractionCount: 0,
};

describe("mergeCatalogHit", () => {
  test("is the incoming hit when the id is new", () => {
    expect(mergeCatalogHit(undefined, FROM_SEARCH)).toEqual(FROM_SEARCH);
  });

  test("a search re-pick does not erase what the map already knew", () => {
    // The regression this exists for. Under the old wholesale overwrite this
    // returned FROM_SEARCH, and only `description` ever came back — Task 15's
    // lazy fetch refills that one field and nothing refills the rest.
    expect(mergeCatalogHit(FROM_MAP, FROM_SEARCH)).toEqual(FROM_MAP);
  });

  test("a map pick still fills in what a search pick left empty", () => {
    // The merge must not be "first write wins" either: the map genuinely knows
    // more, and arriving second must not cost the trip that knowledge.
    expect(mergeCatalogHit(FROM_SEARCH, FROM_MAP)).toEqual(FROM_MAP);
  });

  test("a later write may still correct a field the earlier one populated", () => {
    const corrected = { ...FROM_MAP, province: "Cusco Region", population: 428_450 };
    expect(mergeCatalogHit(FROM_MAP, corrected)).toMatchObject({
      province: "Cusco Region",
      population: 428_450,
    });
  });

  test("a population of 0 is a figure and not an absence, whichever side sends it", () => {
    // 4,721 of the 58,742 committed shard rows carry 0 — a place GeoNames has
    // no figure for — and `shardRowToMapCity` passes it through as 0 rather
    // than null on purpose. Only `null` means "this producer does not know".
    const zeroed = { ...FROM_MAP, population: 0 };
    // The assertion that separates `??` from `||`: under `||` the incoming 0 is
    // falsy, so the stale 312,140 survives a write that said otherwise. The
    // reverse direction alone would not catch it — `null || 0` is 0 too.
    expect(mergeCatalogHit(FROM_MAP, zeroed).population).toBe(0);
    expect(mergeCatalogHit(zeroed, FROM_SEARCH).population).toBe(0);
  });

  test("keeps the attraction count the map wrote when a search re-pick sends 0", () => {
    expect(mergeCatalogHit(FROM_MAP, FROM_SEARCH).attractionCount).toBe(7);
  });

  test("no field of a stored hit can be nulled by a later write", () => {
    // The rule stated once over every field, rather than only over the three
    // that diverge today.
    //
    // This pair is deliberately synthetic and the two above are not:
    // `localName` and `province` are the fields the real producers agree on
    // now, because Task 13 stopped `DestinationStep.addPlace` nulling them —
    // and the fixtures above therefore give both sides the same value for
    // both, which is exactly how a fallback goes untested. The pair below is
    // what stops the next producer, or the next field added to `CatalogHit`,
    // from quietly reopening the class of bug the map/search split already
    // produced once for `population` and `description`.
    const full: CatalogHit = {
      qid: "Q956",
      name: "Beijing",
      localName: "北京",
      province: "Beijing",
      description: "capital of China",
      population: 21_542_000,
      attractionCount: 12,
    };
    const empty: CatalogHit = {
      qid: "Q956",
      name: "Beijing",
      localName: null,
      province: null,
      description: null,
      population: null,
      attractionCount: 0,
    };
    expect(mergeCatalogHit(full, empty)).toEqual(full);
  });

  test("does not mutate either side", () => {
    const stored = { ...FROM_MAP };
    const incoming = { ...FROM_SEARCH };
    mergeCatalogHit(stored, incoming);
    expect(stored).toEqual(FROM_MAP);
    expect(incoming).toEqual(FROM_SEARCH);
  });
});

/**
 * `app/plan/page.tsx` is the sole call site and no test may render it —
 * `vitest.config.mts` includes only lib/, scripts/ and components/. Without
 * this, the page could be reverted to the wholesale overwrite, or lose the
 * lazy-enrichment fetch entirely, with the whole suite green. Blunt on
 * purpose, in the manner of lib/contracts.test.ts.
 */
describe("app/plan/page.tsx wiring", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "app", "plan", "page.tsx"), "utf8");

  test("folds a catalog pick through mergeCatalogHit rather than overwriting", () => {
    expect(source).toContain('from "@/lib/catalogExtras"');
    expect(source).toContain("mergeCatalogHit(prev[hit.qid], hit)");
    // The overwrite this replaced.
    expect(source).not.toContain("[hit.qid]: hit");
  });

  test("asks the enrich route for a description the pick arrived without", () => {
    expect(source).toContain("/api/cities/enrich?ids=");
  });

  test("gates that fetch on shouldFetchEnrichment and records the id it asked about", () => {
    // The guard and the ref are tested above as logic; this is the wiring
    // that makes them run. Without it the page could keep the bare
    // `merged.description !== null` check — which is false on every first
    // search pick, Q-ids included — with the whole suite green.
    expect(source).toContain("shouldFetchEnrichment(merged, enrichRequested.current)");
    expect(source).toContain("enrichRequested.current.add(hit.qid)");
    expect(source).not.toContain("if (merged.description !== null) return;");
  });
});

/**
 * The fetch decision itself. It sits in lib/ for the same reason the merge
 * does — `vitest.config.mts` includes only lib/, scripts/ and components/, so
 * a guard written inline in `app/plan/page.tsx` is a guard no test can reach.
 */
describe("shouldFetchEnrichment", () => {
  const NONE = new Set<string>();
  /** A first search pick: `RankedPlace` holds no blurb, so this is every one. */
  const fromSearch: CatalogHit = { ...FROM_SEARCH };

  test("fetches for a GeoNames city that arrived without a description", () => {
    expect(shouldFetchEnrichment(fromSearch, NONE)).toBe(true);
  });

  test("does not fetch when the merge already has a description", () => {
    // The map's hit carries one, and so does a hit an earlier fetch filled in.
    expect(shouldFetchEnrichment(FROM_MAP, NONE)).toBe(false);
  });

  test("does not fetch for a Wikidata id, which the endpoint cannot answer", () => {
    // The refusal the `description !== null` guard alone never made:
    // `DestinationStep.addPlace` hard-codes `description: null` for every
    // search pick, so that guard is false on every first pick — including
    // `Q…` ids, which /api/cities/enrich queries by wdt:P1566 and can never
    // match. Every one of those was a round trip that could not answer.
    expect(shouldFetchEnrichment({ ...fromSearch, qid: "Q956" }, NONE)).toBe(false);
    // And a curated id, which reaches `addCatalog` by the same path.
    expect(shouldFetchEnrichment({ ...fromSearch, qid: "hangzhou" }, NONE)).toBe(false);
  });

  test("does not re-ask about an id it has already asked about", () => {
    // A cached miss comes back with no description, so the first guard stays
    // false forever for a city Wikidata has never heard of. Without this,
    // re-picking it re-queries on every pick for the life of the session.
    expect(shouldFetchEnrichment(fromSearch, new Set([fromSearch.qid]))).toBe(false);
  });

  test("an unrelated id in the set does not suppress the fetch", () => {
    // The membership test must be on this hit's id, not on the set being
    // non-empty — one earlier pick would otherwise disable enrichment for the
    // whole session.
    expect(shouldFetchEnrichment(fromSearch, new Set(["G999"]))).toBe(true);
  });
});
