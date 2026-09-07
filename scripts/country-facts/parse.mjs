/**
 * ingest-country-facts — the pure parse: RFC 4180 CSV, SPARQL bindings, and
 * the entity-id reader.
 *
 * Moved verbatim out of scripts/ingest-country-facts.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `run`, the run guard — is still
 * scripts/ingest-country-facts.mjs.
 *
 * The `Row` typedef below is a byte-identical copy of the one that stayed in
 * scripts/ingest-country-facts.mjs. Three files annotate with it — that one,
 * this one and scripts/country-facts/io.mjs — and a JSDoc typedef cannot be
 * shared between them without rewriting the annotations that use it, which
 * this move is not allowed to do.
 */

/**
 * One SPARQL result row, already decoded from CSV: column name -> cell text.
 * @typedef {Record<string, string>} Row
 */

// ---------------------------------------------------------------------------
// Pure parse
// ---------------------------------------------------------------------------

/**
 * RFC 4180 CSV, because the endpoint is asked for `text/csv`.
 *
 * Hand-written rather than added as a dependency, for the same reason
 * ingest-cities.mjs walks a ZIP container by hand: every ingest in this repo
 * runs on Node built-ins alone and the nightly workflow has no `npm ci` step
 * as a result.
 *
 * Quoted fields matter here specifically, not theoretically: a P37 language
 * label ("Norwegian Bokmål, Nynorsk") and a P498 currency name both carry
 * commas, and a naive `split(',')` would shift every later column left by one
 * — which reads as a reshaped feed rather than as a parse bug, and is exactly
 * the class of silent corruption the gate cannot attribute.
 */
export function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let quoted = false;
  let started = false;
  const pushField = () => { row.push(field); field = ''; started = false; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && !started) { quoted = true; started = true; continue; }
    if (char === ',') { pushField(); continue; }
    if (char === '\r') continue; // CRLF and bare CR both end the record on the \n
    if (char === '\n') { pushRow(); continue; }
    field += char;
    started = true;
  }
  // A trailing newline leaves nothing pending; anything else is a final record.
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

/**
 * A CSV result set as row objects keyed by the header line.
 *
 * A response with a header and no data rows is a legitimately empty answer and
 * returns `[]`. A response with NO header at all is not: the SPARQL endpoint
 * always emits one, so its absence means the body is an error page, a
 * rate-limit notice or a truncation, and reading that as "Wikidata knows
 * nothing" is the Task 7 shape. It throws, which demotes the property and
 * carries the previous values forward rather than deleting them.
 */
export function parseBindings(text, expectedColumns) {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new Error('empty response body — the endpoint answered with no CSV header at all');
  }
  const header = rows[0].map((name) => name.trim());
  for (const column of expectedColumns ?? []) {
    if (!header.includes(column)) {
      throw new Error(
        `response has no "${column}" column (got ${header.join(', ') || '<nothing>'}) — ` +
        `the query or the endpoint's output format has changed, which is not an empty answer`
      );
    }
  }
  /** @type {Row[]} */
  const out = [];
  for (const cells of rows.slice(1)) {
    if (cells.length === 1 && cells[0] === '') continue; // blank line
    /** @type {Row} */
    const record = {};
    for (const [index, name] of header.entries()) record[name] = cells[index] ?? '';
    out.push(record);
  }
  return out;
}

/** `Q60740126` out of `http://www.wikidata.org/entity/Q60740126`, or out of itself. */
export function entityId(value) {
  const text = String(value ?? '').trim();
  const match = /(Q[1-9][0-9]*)$/.exec(text);
  return match ? match[1] : '';
}

/** Whitespace-collapsed, trimmed text. Everything upstream goes through this. */
export const collapse = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Rows bucketed by their `country` column, which every query selects. */
export function groupByCountry(rows) {
  /** @type {Map<string, Row[]>} */
  const grouped = new Map();
  for (const row of rows ?? []) {
    const code = collapse(row.country);
    if (code === '') continue;
    const bucket = grouped.get(code);
    if (bucket) bucket.push(row);
    else grouped.set(code, [row]);
  }
  return grouped;
}

