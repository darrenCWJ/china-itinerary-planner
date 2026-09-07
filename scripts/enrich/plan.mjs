/**
 * enrich-cities — the pure half: the SPARQL query, the binding reader, the
 * merge, the per-country plan, and the five gates that stand between a bad
 * upstream night and a committed, deployed data wipe.
 *
 * Moved verbatim out of scripts/enrich-cities.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the enrichment it
 * describes is unchanged. The entry point — `run`, the run guard — is still
 * scripts/enrich-cities.mjs, and so is the essay that explains WHY THERE ARE
 * FIVE GATES AND NOT TWO.
 *
 * The constants each gate reads came with it. They were declared above the
 * `Pure` banner in the file this was cut from, but nothing outside these
 * functions reads them, and a threshold and the check that applies it are one
 * unit: `MIN_COVERAGE_RATIO`'s docblock is the argument for
 * `assertEnrichmentSane`'s existence.
 */

/**
 * How much of the previous run's coverage may vanish before this is an outage
 * rather than a data change.
 *
 * Chosen from this catalog's real numbers, not guessed. The live run produced
 * 5,118 entries from 6,245 targets, and an immediate re-run was byte-identical
 * — steady-state drift is zero, because the only way an entry disappears is
 * that an item Wikidata already answered for stops carrying P1566, or loses
 * both its image and its description. That is a handful of items a night, not
 * hundreds.
 *
 * 0.95 therefore permits losing 255 of 5,118 — comfortably more than any
 * plausible night of churn, and more than a whole SPARQL batch's worth of it
 * (150 ids = 2.9%) — while refusing anything larger. The value it replaces,
 * 0.5, permitted losing 2,559: half the catalog, 85 countries' worth, in one
 * unattended run.
 *
 * It deliberately does NOT try to catch concentrated damage: 30 targets is the
 * most any one country has, or 0.6% of the total, which no global ratio can
 * see. That is `MIN_COUNTRY_COVERAGE_RATIO`'s job.
 */
const MIN_COVERAGE_RATIO = 0.95;

/**
 * The same question asked per country, which is the scale real damage arrives
 * at: a truncated batch, or a country whose ids all sit in one 150-id window.
 *
 * Per-country COUNTS are far more stable than per-country YIELD, which ranges
 * from 0/1 (VA) to 30/30 across the real catalog — so this compares a country
 * against its own previous file, never against its target count. Ids that
 * fall out of the top 30 are kept by `mergeEnrichment` as out-of-scope
 * entries, so a country's total only moves when an id it already had stops
 * answering. 0.8 lets a 30-entry country lose 6 and a 14-entry country lose 2
 * before this fires; the demonstrated wipe — a country losing all 30 while
 * global coverage read a healthy 83% — trips it at 0.
 */
const MIN_COUNTRY_COVERAGE_RATIO = 0.8;

/**
 * Countries too small for a ratio to mean anything. 25 of the 246 have fewer
 * than 10 targets and several hold 1 or 2 entries, where losing one city is a
 * 50-100% "collapse". Without this a single tiny country could block the whole
 * nightly refresh indefinitely, which is its own kind of outage.
 */
const COUNTRY_COVERAGE_GRACE = 2;

/**
 * What fraction of a batch's ALREADY-ENRICHED ids must come back before the
 * response counts as an answer rather than an outage.
 *
 * Judged against previous coverage rather than against batch size, because
 * batch size says nothing: real per-batch yield across the live run ranged
 * 65-98%, so any fixed fraction of the batch either never fires or fires
 * constantly. Previously-covered ids, by contrast, are ids Wikidata has
 * already answered for at least once; more than 20% of them vanishing inside
 * a single 150-id window is a truncated result set, not editorial churn. On a
 * first run there is no previous coverage and nothing to lose, so any answer
 * is accepted.
 *
 * Calibrated against the failure that was demonstrated: an upstream yielding
 * 55% of the batch scores ~0.67 here and is rejected, and the observed
 * within-batch tail deficit (the last 30 positions of each batch answer about
 * 8 points below the head) scores ~0.9 and is accepted.
 */
const MIN_BATCH_ANSWER_RATIO = 0.8;

/**
 * How many of the titles sent to the Action API may fall back to Wikidata's
 * terse one-liner before the run is a Wikipedia outage rather than a normal
 * day. The committed artifact puts an upper bound of ~9% on the real rate:
 * 434 of 5,118 descriptions are short and unpunctuated enough to be Wikidata
 * stubs, and that count also includes entities that never had an enwiki title
 * to ask about. 0.2 is more than twice that bound, so routine rate-limiting
 * cannot trip it — the live run took a 429 on roughly 1 batch in 10 and still
 * lost only ~20 titles — while a Wikipedia outage scores ~1.0 and stops the
 * commit.
 */
const MAX_EXTRACT_FALLBACK_RATIO = 0.2;

/** Below this the fallback ratio is noise: `enrich-cities.mjs VA` asks about one title. */
const MIN_EXTRACT_SAMPLE = 50;

/**
 * The explicit ceiling on the query's result set. With DISTINCT, one entity
 * yields one row per combination of its images, its enwiki title and its
 * English description — one row for almost every city, a handful for a city
 * with several P18 values. 50 rows per id is far above anything real and
 * still bounds a join that goes wrong. Truncation at the limit would look
 * exactly like the partial-answer hazard, which is why
 * `isBatchAnswerPlausible` guards it rather than the limit being trusted to
 * be generous enough.
 */
const SPARQL_ROWS_PER_ID = 50;
const MAX_DESCRIPTION_CHARS = 420;

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

/** `G` + digits, the id shape scripts/ingest-cities.mjs emits. */
const GEONAMES_ID = /^G[1-9][0-9]*$/;

/**
 * A VALUES query over Wikidata's P1566 (GeoNames ID).
 *
 * Ids are validated rather than escaped. They come from a generated file, but
 * this string is interpolated straight into a query, and a value carrying a
 * quote would rewrite the WHERE clause. Validation is also what catches the
 * subtler mistake: sending the app's `G`-prefixed id matches nothing, and an
 * empty result is indistinguishable from a genuinely unknown city.
 *
 * DISTINCT and LIMIT are not decoration. Without DISTINCT the three OPTIONALs
 * multiply out into duplicate rows that inflate the response for no extra
 * information; without LIMIT there is no ceiling at all on what a mis-planned
 * join can return, and an oversized result set is exactly what makes an
 * endpoint answer 200 with a body that stops early.
 */
export function buildEnrichmentQuery(geonameIds) {
  const values = geonameIds
    .map((id) => {
      if (!GEONAMES_ID.test(id)) throw new Error(`"${id}" is not a GeoNames id — expected "G" + digits`);
      return `"${id.slice(1)}"`;
    })
    .join(' ');
  return `
SELECT DISTINCT ?gid ?x ?img ?title ?desc WHERE {
  VALUES ?gid { ${values} }
  ?x wdt:P1566 ?gid.
  OPTIONAL { ?x wdt:P18 ?img. }
  OPTIONAL { ?article schema:about ?x; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title. }
  OPTIONAL { ?x schema:description ?desc. FILTER(LANG(?desc) = "en") }
}
LIMIT ${geonameIds.length * SPARQL_ROWS_PER_ID}`;
}

/** P18 arrives as a Commons Special:FilePath URL; Commons resizes server-side. */
export function toThumbnailUrl(commonsFilePathUrl) {
  if (!commonsFilePathUrl) return null;
  return `${commonsFilePathUrl.replace(/^http:/, 'https:')}?width=640`;
}

/**
 * SPARQL's row-per-statement-combination output, collapsed to one entity per
 * id. First non-null binding wins per field — the `??=` idiom
 * ingest-destinations.mjs uses, and the reason the live query returning Cusco
 * three times does not produce three records.
 */
export function readEnrichmentBindings(bindings) {
  const merged = new Map();
  for (const row of bindings) {
    const gid = row?.gid?.value;
    if (!gid) continue;
    const id = `G${gid}`;
    const entity = merged.get(id) ?? { title: null, description: null, image: null };
    entity.title ??= row.title?.value ?? null;
    entity.description ??= row.desc?.value ?? null;
    entity.image ??= toThumbnailUrl(row.img?.value ?? null);
    merged.set(id, entity);
  }
  return merged;
}

/**
 * The previous enrichment file, updated for the ids this run covered.
 *
 * Merged so a lazily-enriched city that has since fallen out of the top 30
 * survives a build that no longer asks about it. Recomputed inside the scope,
 * including deletion, so a city that now yields nothing loses its stale entry.
 * Keys are sorted so a rebuild with no data change is byte-identical and the
 * daily workflow has nothing to commit.
 */
export function mergeEnrichment(previous, fresh, scope) {
  const out = { ...previous };
  for (const id of scope) delete out[id];
  for (const id of scope) {
    const entity = fresh.get(id);
    if (!entity) continue;
    const description = entity.description ?? null;
    const image = entity.image ?? null;
    if (description === null && image === null) continue;
    out[id] = { description, image };
  }
  /**
   * Annotated, not inferred. `allowJs` with `checkJs` off still lets
   * TypeScript infer this module's exported types, and an object literal
   * populated only through a computed key infers as `{}` — which makes
   * `merged.G2` in scripts/enrich-cities.test.ts a hard `tsc --noEmit` error
   * (`TS2339: Property 'G2' does not exist on type '{}'`), and the pre-merge
   * gate is exactly `npx tsc --noEmit` then `npm test`. Reproduced and the fix
   * verified against this repo's own TypeScript 7.0.2.
   *
   * @type {Record<string, { description: string | null; image: string | null }>}
   */
  const ordered = {};
  for (const key of Object.keys(out).sort()) ordered[key] = out[key];
  return ordered;
}

/**
 * One country's whole delete-and-re-add decision, as a pure function.
 *
 * This is a unit because the scope narrowing — the single `.filter` below — is
 * the guard that makes a failed batch cost nothing, and while it lived inline
 * in the run loop no test could reach it. Deleting the filter left the entire
 * suite green while letting one failed batch delete a whole country's
 * enrichment, commit it, and exit 0.
 *
 * The dispositions are the other half of the reason. The live run yielded
 * 5,118 of 6,245 and recorded nothing about WHY the other 1,127 missed, so the
 * shortfall was explained by inspection and explained wrong. Every target id
 * now lands in exactly one bucket.
 */
export function planCountry(previousCities, entities, scope, answered) {
  // Only ids whose batch returned. An unasked id is not recomputed, so it
  // keeps whatever the last successful run gave it.
  const scoped = scope.filter((id) => answered.has(id));
  const cities = mergeEnrichment(previousCities, entities, scoped);
  const dispositions = { asked: 0, unasked: 0, found: 0, noMatch: 0, droppedEmpty: 0 };
  for (const id of scope) {
    if (!answered.has(id)) {
      dispositions.unasked++;
      continue;
    }
    dispositions.asked++;
    if (Object.hasOwn(cities, id)) dispositions.found++;
    else if (entities.has(id)) dispositions.droppedEmpty++;
    else dispositions.noMatch++;
  }
  return {
    scoped,
    cities,
    dispositions,
    previousCount: Object.keys(previousCities).length,
    nextCount: Object.keys(cities).length,
  };
}

/**
 * Did this batch ANSWER, or did it merely respond?
 *
 * The distinction the earlier design could not make. `mergeEnrichment` deletes
 * every id in scope, so an id may only enter scope if Wikidata genuinely had
 * its say about it. A response carrying rows for far fewer ids than already
 * had enrichment is a truncated result set, a rate-limit page that parsed as
 * JSON, or a query-plan bailout — all of which arrive as HTTP 200 and all of
 * which the throw/no-throw signal reads as a successful, empty answer.
 *
 * Rejecting a batch is cheap and safe: its ids stay unasked and keep the
 * enrichment the last good run gave them. Accepting a partial one is not.
 */
export function isBatchAnswerPlausible(matchedCount, previouslyCoveredCount) {
  if (previouslyCoveredCount === 0) return true; // nothing to lose
  return matchedCount >= previouslyCoveredCount * MIN_BATCH_ANSWER_RATIO;
}

/**
 * The gate between a Wikidata outage and a committed, deployed data wipe.
 *
 * `mergeEnrichment` deletes every id in its scope before re-adding what came
 * back, and `planCountry` already narrows the scope to batches that answered —
 * but narrowing cannot catch the case where every batch answers plausibly and
 * returns nothing usable, which is what a renamed property or a schema change
 * looks like. Then the merge is legitimately empty and all 6,244 records would
 * be deleted, written, committed and deployed at exit 0.
 *
 * Throwing here fails the workflow's enrich step, which skips the commit step
 * entirely: the cost of a bad upstream day is one skipped refresh, not the
 * catalog's whole descriptive layer.
 */
export function assertEnrichmentSane(previousTotal, nextTotal) {
  if (previousTotal === 0) return; // a first run has nothing to lose
  const ratio = nextTotal / previousTotal;
  if (ratio < MIN_COVERAGE_RATIO) {
    throw new Error(
      `enrichment coverage fell to ${nextTotal}/${previousTotal} ` +
      `(${(ratio * 100).toFixed(1)}%), under the ${MIN_COVERAGE_RATIO * 100}% floor — ` +
      `writing now would delete the enrichment this run failed to refetch`
    );
  }
}

/**
 * The same gate at the scale damage actually arrives at.
 *
 * A global floor is blind to concentrated loss: the biggest country holds 30
 * of 5,118 entries, so zeroing one costs 0.6% and any global floor worth
 * having sits far above that. A country's ids also tend to share a SPARQL
 * batch, which is exactly the unit an upstream truncates.
 */
export function assertCountryCoverageSane(countryCounts) {
  const collapsed = countryCounts.filter(
    ({ previousCount, nextCount }) =>
      previousCount > 0 &&
      previousCount - nextCount > COUNTRY_COVERAGE_GRACE &&
      nextCount < previousCount * MIN_COUNTRY_COVERAGE_RATIO
  );
  if (collapsed.length > 0) {
    const detail = collapsed
      .slice(0, 10)
      .map(({ country, previousCount, nextCount }) => `${country} ${nextCount}/${previousCount}`)
      .join(', ');
    throw new Error(
      `${collapsed.length} country/countries lost more than ` +
      `${(1 - MIN_COUNTRY_COVERAGE_RATIO) * 100}% of their enrichment (${detail}) — ` +
      `a global coverage ratio cannot see one country being emptied, so this refuses the write`
    );
  }
}

/**
 * The gate that counts QUALITY rather than records.
 *
 * With Wikidata healthy and the Action API down, every description falls back
 * to `entity.description` — Wikidata's terse one-liner — and the record count
 * does not move by one, so every count-based gate reports a perfect run. The
 * descriptions a traveller reads are the product; replacing all of them with
 * stubs and deploying it is a regression the other gates are structurally
 * unable to notice.
 */
export function assertExtractQualitySane(fallbackCount, requestedCount) {
  if (requestedCount < MIN_EXTRACT_SAMPLE) return;
  const ratio = fallbackCount / requestedCount;
  if (ratio > MAX_EXTRACT_FALLBACK_RATIO) {
    throw new Error(
      `${fallbackCount}/${requestedCount} descriptions (${(ratio * 100).toFixed(1)}%) fell back ` +
      `to the Wikidata one-liner, over the ${MAX_EXTRACT_FALLBACK_RATIO * 100}% ceiling — ` +
      `Wikipedia's extract API is degraded, and writing now would commit a silent ` +
      `downgrade of every description with the record count unchanged`
    );
  }
}

/** Drop "(simplified Chinese: …; pinyin: …)" style parentheticals from extracts. */
function stripLanguageParentheticals(text) {
  if (!text) return text;
  return text.replace(/\s*\((?=[^)]*(?:pinyin|romanized|Chinese))[^()]*\)/g, '');
}

export function firstSentences(text, maxSentences = 2) {
  if (!text) return null;
  const clean = stripLanguageParentheticals(text).replace(/\s+/g, ' ').trim();
  // The optional opener before a capital is a straight quote, an apostrophe or
  // a bracket. (An earlier draft listed `"` twice, which was a no-op.)
  const sentences = clean.split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])/);
  let result = sentences.slice(0, maxSentences).join(' ');
  if (result.length > MAX_DESCRIPTION_CHARS && sentences.length > 1) result = sentences[0];
  if (result.length > MAX_DESCRIPTION_CHARS) {
    result = `${result.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`;
  }
  return result || null;
}

export function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

