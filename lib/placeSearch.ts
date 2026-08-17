/**
 * Merged place search (spec §3.2.2): one ranked list over the curated set and
 * the all-country catalog, plus a terminal "add it yourself" row (§3.2.7).
 *
 * This is the input that replaces a browsable grid, which stops working the
 * moment the app covers every country — a grid of every city on Earth cannot be
 * rendered. Pure, so the ranking is testable without a component or a fetch.
 */

/** The fields ranking needs from a curated `Destination`. */
export interface SearchableCurated {
  id: string;
  name: string;
  localName: string | null;
  knownFor: string[];
}

/** The fields ranking needs from a `CatalogHit`. */
export interface SearchableHit {
  qid: string;
  name: string;
  localName: string | null;
  province: string | null;
}

export type RankedKind = "curated" | "catalog" | "off-map";

export interface RankedPlace {
  /** Curated id, catalog qid, or the raw query for the off-map row. */
  id: string;
  kind: RankedKind;
  name: string;
  localName: string | null;
  province: string | null;
  /** Already picked: shown as added rather than hidden. */
  isSelected: boolean;
}

export interface RankOptions {
  selectedIds?: readonly string[];
  /**
   * Names of hand-typed places already on the trip.
   *
   * Separate from `selectedIds` because an off-map row has no stable id to match
   * on — this module gives it the raw query, while the caller stores it under
   * whatever key it likes (the wizard uses `offmap:<slug>`). Matching on the
   * normalised name is what actually identifies a hand-typed place, and it keeps
   * this module ignorant of the caller's id convention.
   */
  selectedOffMapNames?: readonly string[];
  /** Catalog results shown at most. The curated set is small; the catalog is not. */
  catalogLimit?: number;
}

const DEFAULT_CATALOG_LIMIT = 10;

/** Higher wins. Gaps left so a field can be inserted without renumbering. */
const SCORE = { namePrefix: 100, nameSubstring: 80, localName: 60, knownFor: 40 } as const;

/**
 * Lowercased, trimmed, and stripped of the punctuation and accents nobody types
 * into a search box.
 *
 * Found in the browser: typing "xian" matched the catalog's Xiangyang and missed
 * the curated Xi'an entirely, because the apostrophe broke the substring test.
 * The same gap hid Ürümqi from "urumqi". Romanised place names are full of marks
 * that are optional to the person searching and mandatory in the data.
 */
const norm = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    // Strips the combining marks NFD leaves behind: "ü" becomes "u", "é"
    // becomes "e". The range is U+0300–U+036F, written literally because it is
    // invisible here — the tests below are what pin it.
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’ʼ`]/g, "");

/**
 * Why a curated place matched, as a score. Null means it did not match, which
 * is what keeps non-matches out of the list rather than at the bottom of it.
 */
function scoreCurated(place: SearchableCurated, q: string): number | null {
  const name = norm(place.name);
  if (name.startsWith(q)) return SCORE.namePrefix;
  if (name.includes(q)) return SCORE.nameSubstring;
  // Local name is matched whole rather than by prefix: the scripts this covers
  // do not tokenise the way a prefix test assumes.
  if (place.localName !== null && norm(place.localName).includes(q)) return SCORE.localName;
  if (place.knownFor.some((term) => norm(term).includes(q))) return SCORE.knownFor;
  return null;
}

function scoreHit(place: SearchableHit, q: string): number | null {
  const name = norm(place.name);
  if (name.startsWith(q)) return SCORE.namePrefix;
  if (name.includes(q)) return SCORE.nameSubstring;
  if (place.localName !== null && norm(place.localName).includes(q)) return SCORE.localName;
  return null;
}

export function rankPlaces(
  query: string,
  curated: readonly SearchableCurated[],
  catalogHits: readonly SearchableHit[],
  options: RankOptions = {}
): RankedPlace[] {
  const q = norm(query);
  // No query, no offer — "add '' as its own place" is not a thing to propose.
  if (q === "") return [];

  const selected = new Set(options.selectedIds ?? []);
  const limit = options.catalogLimit ?? DEFAULT_CATALOG_LIMIT;

  // Index-carrying sort keeps equal scores in input order. Array.prototype.sort
  // is specified stable, but making it explicit means a later change to the
  // comparator cannot quietly reintroduce reshuffling — and a list that
  // reshuffles while the user types moves the row under their finger.
  const byScoreThenInput = <T>(entries: { item: T; score: number; index: number }[]) =>
    entries.sort((a, b) => b.score - a.score || a.index - b.index).map((e) => e.item);

  const curatedRanked = byScoreThenInput(
    curated.flatMap((item, index) => {
      const score = scoreCurated(item, q);
      return score === null ? [] : [{ item, score, index }];
    })
  ).map<RankedPlace>((item) => ({
    id: item.id,
    kind: "curated",
    name: item.name,
    localName: item.localName,
    province: null,
    isSelected: selected.has(item.id),
  }));

  // The catalog contains the curated cities too, so a bare merge offers the same
  // trip twice — and the curated entry is the one with researched days and
  // activities. Matched on name because the two sources share no id space.
  const curatedNames = new Set(curated.map((c) => norm(c.name)));

  const catalogRanked = byScoreThenInput(
    catalogHits.flatMap((item, index) => {
      if (curatedNames.has(norm(item.name))) return [];
      const score = scoreHit(item, q);
      return score === null ? [] : [{ item, score, index }];
    })
  )
    .slice(0, limit)
    .map<RankedPlace>((item) => ({
      id: item.qid,
      kind: "catalog",
      name: item.name,
      localName: item.localName,
      province: item.province,
      isSelected: selected.has(item.qid),
    }));

  const results = [...curatedRanked, ...catalogRanked];

  // The off-map row is withheld on an exact name match: the place is already in
  // the list, and a second row for the same name only makes a duplicate.
  const hasExact = results.some((r) => norm(r.name) === q);
  if (!hasExact) {
    const alreadyAdded = (options.selectedOffMapNames ?? []).some((n) => norm(n) === q);
    results.push({
      id: query.trim(),
      kind: "off-map",
      name: query.trim(),
      localName: null,
      province: null,
      // Flagged rather than hidden, same as the other two kinds: a place the
      // user typed a minute ago must not be re-offered as if it were new.
      isSelected: alreadyAdded,
    });
  }

  return results;
}
