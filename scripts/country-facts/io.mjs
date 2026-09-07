/**
 * ingest-country-facts — paths, sources, the retrying fetch, the writers, and
 * the SPARQL property queries.
 *
 * Moved verbatim out of scripts/ingest-country-facts.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `run`, the run guard — is still
 * scripts/ingest-country-facts.mjs.
 *
 * Three of that file's sections in their original order: `Paths, sources,
 * network`, `Writing`, and `Fetching the property queries`. The `Report`
 * section that sat between the second and the third is
 * scripts/country-facts/report.mjs.
 *
 * The one line here that is not verbatim is `ROOT_DIR`: this file sits one
 * directory deeper than the one it came out of, so the walk up from
 * `import.meta.url` takes one more `'..'`.
 *
 * The `Row` typedef below is a byte-identical copy of the one that stayed in
 * scripts/ingest-country-facts.mjs, for the reason its twin in
 * scripts/country-facts/parse.mjs gives.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROPERTIES } from './facts.mjs';
import { parseBindings } from './parse.mjs';

/**
 * One SPARQL result row, already decoded from CSV: column name -> cell text.
 * @typedef {Record<string, string>} Row
 */

// ---------------------------------------------------------------------------
// Paths, sources, network
// ---------------------------------------------------------------------------

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/**
 * Default for `run()`'s `dataDir` — production's real value. Both output paths
 * are derived from whichever `dataDir` `run()` actually receives, never from
 * this constant directly, so a test can point them at a scratch directory and
 * never touch `data/`.
 */
export const DATA_DIR = join(ROOT_DIR, 'data');
export const FACTS_FILE = 'country-facts.json';
export const REPORT_FILE = 'country-facts-report.md';

export const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
/**
 * CC0, a public domain dedication with NO attribution condition — confirmed
 * live from the endpoint's `meta=siteinfo`. This is why nothing here widens
 * components/plan/GeoNamesCredit.tsx or lib/contracts.test.ts's C7 contract;
 * see the header and the report's `## Attribution` section, which are the
 * other two places the same decision is recorded.
 */
export const SOURCE_LICENSE = 'CC0-1.0';
export const SOURCE_NAME = 'Wikidata (CC0)';
const USER_AGENT = 'ChinaItineraryPlanner/1.0 (personal project)';

/**
 * The country universe this ingest asks about: every code the app ships a city
 * shard for under public/cities, sorted. Pinned against that directory by a
 * derived contract in lib/countryFacts.test.ts, so a shard added or removed
 * reddens rather than silently going unqueried.
 *
 * Bounding the query matters. Measured 2026-08-27, an unbounded
 * `?item wdt:P297 ?code` returns 259 codes — the app's 246 are a strict subset,
 * and the 13 extras are AC, AN, AQ, BV, CP, CQ, DD, DG, HM, PC, TA, UM, YU:
 * exceptionally reserved codes, uninhabited territories, and the historical
 * AN (Netherlands Antilles), DD (East Germany) and YU (Yugoslavia). Facts
 * about East Germany would pass every gate in this file, cost bytes in a
 * bundle that reaches the browser, and answer a question no user can ask.
 *
 * It is a literal rather than a `readdirSync` because `run()`'s injectable
 * seams are `fetchBindings` and `dataDir`: reading public/cities inside the
 * run would make every gate test in scripts/ingest-country-facts.test.ts
 * depend on the real shard tree, which is the coupling those tests exist
 * without.
 */
export const COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AR', 'AS', 'AT', 'AU',
  'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ',
  'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BW', 'BY', 'BZ', 'CA',
  'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR',
  'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO',
  'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN',
  'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HN', 'HR', 'HT',
  'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE',
  'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW',
  'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV',
  'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN',
  'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS',
  'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC',
  'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR',
  'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ',
  'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG',
  'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS',
  'XK', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
];

/**
 * Deliberately ABOVE the server's own ceiling, not below it.
 *
 * Blazegraph gives itself 60 s and then answers `upstream request timeout` —
 * an HTTP 200 whose body has no CSV header, which `parseBindings` refuses to
 * read as an empty answer. A client timeout under 60 s would abort requests
 * the server was about to answer or about to refuse in a way this ingest can
 * attribute, and turn a diagnosable refusal into an undiagnosable abort.
 *
 * Headroom, measured 2026-08-27 by the shipping queries over all 246 codes in
 * ONE request each (the batches below are smaller still): 252 ms for the
 * fastest (P474) and 746 ms for the slowest (P2884). 90 s is ~120x the
 * measured worst case and 1.5x the server's ceiling.
 */
const SPARQL_TIMEOUT_MS = 90_000;
const RETRY_DELAYS_MS = [2_000, 8_000];

/**
 * The longest a `Retry-After` may park this run.
 *
 * The header is honoured because ignoring it is how a polite client becomes an
 * abusive one, but it is upstream-controlled input and is treated as such: a
 * misconfigured or hostile `Retry-After: 86400` must not hold the nightly
 * workflow's runner open for a day. Past this, the run fails, nothing is
 * written, the previous artifact stands and the job goes red — which is the
 * correct outcome for "Wikidata has asked us to come back much later".
 *
 * RAISED 60s -> 300s on 2026-08-28, because 60s was defending against the
 * wrong number. WDQS asked for **120s** twice in one day, and both times this
 * ceiling threw the work away rather than wait two minutes:
 *   - run 33169438833 lost `drivingSide` (survivable — one property demotes)
 *   - run 33185808379 lost the whole run, because the 429 landed on the
 *     `codes` (P297) query, the one query whose failure is fatal
 * Neither was Wikidata being unhealthy: it answered in 0.47s minutes later.
 * `enrich-cities.mjs` had just spent 30 UNBROKEN MINUTES on SPARQL in the step
 * immediately before, so the runner's own rate budget was spent — the two
 * heavy Wikidata workloads share one job, and the second pays for the first.
 *
 * 300s keeps the defence this constant exists for (86400 is still refused, and
 * its test still proves it) while accepting the pause a real WDQS asks for.
 * The cost is bounded and worth naming: a query may now park up to
 * 2 x 300s = 10 minutes before failing, against ~16s before. That is inside
 * the workflow's own `timeout-minutes: 60`, which stays the real backstop —
 * the header there already accepts that a degraded day is a fast red.
 */
const MAX_RETRY_AFTER_MS = 300_000;

/**
 * One second between requests, serially, never concurrently.
 *
 * WDQS asks clients to keep concurrency low rather than to hit a published
 * quota, so the politeness rule here is one request in flight at a time with a
 * full second between them. Measured cost on 2026-08-27: 24 requests for a
 * whole build (1 codes + 2 name + 2 + 3 + 2 + 2 + 5 + 3 + 2 + 2), so the delay
 * adds about 23 s to a run whose queries themselves total well under a minute.
 * That is a price worth paying nightly for a free public endpoint.
 */
const POLITENESS_DELAY_MS = 1_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `Retry-After` in milliseconds, or null when there is nothing usable to
 * honour. Both RFC 9110 forms are accepted: delta-seconds and an HTTP-date.
 *
 * Clamped to `MAX_RETRY_AFTER_MS` by the caller, not here, so the raw value
 * stays visible in the log line — "asked for 3600 s, waiting 60 s" is
 * diagnosable and "waiting 60 s" is not.
 */
export function parseRetryAfter(header, now = Date.now()) {
  const raw = String(header ?? '').trim();
  if (raw === '') return null;
  if (/^[0-9]+$/.test(raw)) return Number(raw) * 1_000;
  // Every RFC 9110 date form starts with a day name, and requiring one is not
  // pedantry: `Date.parse` is lenient enough to read "12.5" as a DATE, so a
  // malformed delta-seconds value would otherwise come back as "wait until
  // some day in the year 2012", clamp to 0, and turn a rate-limit into a
  // hot retry loop against the endpoint that just asked us to slow down.
  if (!/^[A-Za-z]{3}/.test(raw)) return null;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/**
 * One retrying fetch, returning the response text.
 *
 * Global `fetch` plus `AbortSignal.timeout`, the same shape as
 * ingest-cities.mjs and ingest-airports.mjs — no node-fetch, no undici import,
 * nothing from node_modules at all, which is what lets the workflow skip
 * `npm ci`.
 *
 * `notFoundIsEmpty: false` is not offered as an option here because there is
 * only one endpoint and the answer for it is fixed: a 404 from SPARQL means
 * the endpoint moved, which is an outage. Laundering that into "Wikidata knows
 * nothing about 246 countries" is the exact reading that feeds a destructive
 * merge, and it is not worth retrying either — a moved endpoint will still be
 * moved in ten seconds.
 */
export async function fetchWithRetry(url, { body, accept }) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    /** Set when the server itself told us how long to wait; overrides the backoff. */
    let requested = null;
    /** Set when the answer is one no amount of waiting will change. */
    let fatal = false;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: accept,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(SPARQL_TIMEOUT_MS),
        redirect: 'follow',
      });
      if (res.status === 404) {
        fatal = true;
        throw new Error(
          `HTTP 404 — the SPARQL endpoint moved or the query path changed; that is an outage, ` +
          `not an empty result`
        );
      }
      if (!res.ok) {
        requested = parseRetryAfter(res.headers.get('retry-after'));
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } catch (error) {
      lastError = error;
      // A moved endpoint will still be moved in ten seconds, and the retry
      // budget here is ten seconds. Retrying it would buy nothing and would
      // triple the time the nightly job takes to report a real outage.
      if (fatal) throw error;
      if (requested !== null && requested > MAX_RETRY_AFTER_MS) {
        // Not a retry decision: the server has asked for longer than this run
        // is willing to hold a CI runner open, so stop and let the property be
        // demoted with its previous values carried forward.
        throw new Error(
          `${error.message}; Retry-After asked for ${Math.round(requested / 1_000)}s, over the ` +
          `${MAX_RETRY_AFTER_MS / 1_000}s ceiling — giving up rather than parking the run`
        );
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = requested === null ? RETRY_DELAYS_MS[attempt] : Math.max(requested, RETRY_DELAYS_MS[attempt]);
        console.warn(
          `  retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${delay}ms (${error.message}` +
          `${requested === null ? '' : `, Retry-After ${Math.round(requested / 1_000)}s`})`
        );
        await sleep(delay);
      }
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message}`);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * The fourth verbatim copy in this repo, acknowledged rather than shared:
 * build-time logic may not live in lib/, and a scripts/ helper module would be
 * a fifth import edge for three lines of filesystem work.
 */
export function writeFileAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}`;
  writeFileSync(tempPath, content, 'utf8');
  try {
    rmSync(path, { force: true }); // Windows rename does not overwrite reliably
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

/**
 * Missing and unreadable are NOT the same answer.
 *
 * scripts/enrich-cities.mjs's version, deliberately, never
 * scripts/ingest-cities.mjs's swallow. Returning null for both would make a
 * corrupt previous artifact — a partial checkout, an interrupted write, a bad
 * merge — read as "there is no previous artifact", which is precisely the
 * input that makes `assertFactsSane`'s `if (!previous) return;` skip every
 * drift check. That combination is what this repo has already paid for once:
 * corrupt the committed file, hand the run an empty upstream answer, and it
 * rewrites everything at exit 0. A file that exists and does not parse is a
 * reason to stop, never a reason to proceed as though it were absent.
 */
export function readJson(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${path} exists but is not valid JSON (${error.message}) — refusing to continue: ` +
      `an unreadable previous state reads as "nothing to lose", and every drift check below ` +
      `would then wave this run straight through`
    );
  }
}

/**
 * The artifact's contents, with its timestamp preserved when nothing moved.
 *
 * Verbatim from scripts/ingest-cities.mjs, and for the same reason: this file
 * is inside the nightly workflow's commit-guard paths, so stamping
 * `new Date()` on it unconditionally turns a commit-on-change job into a
 * commit-every-day job, and every commit is a production deploy plus a CI run.
 *
 * Compared on the PAYLOAD, never on the envelope — comparing the whole
 * previous object would compare the timestamp against itself and never match.
 *
 * `generatedAt` is spread first so the emitted key order matches what the
 * previous file had, which is what keeps the byte comparison above meaningful.
 */
export function stampedPayload(previous, body, now) {
  const unchanged =
    previous !== null &&
    JSON.stringify({ ...previous, generatedAt: undefined }) ===
      JSON.stringify({ ...body, generatedAt: undefined });
  return { generatedAt: unchanged ? previous.generatedAt : now, ...body };
}

// ---------------------------------------------------------------------------
// Fetching the property queries
// ---------------------------------------------------------------------------

/**
 * An English label with Wikidata's `mul` fallback, as a deterministic COALESCE.
 *
 * This is not defensive boilerplate — it is the single most expensive thing
 * measured on 2026-08-27. Wikidata has been migrating item labels to the `mul`
 * ("default for all languages") pseudo-language, and Q4916, the EURO, now has
 * NO English label at all: 207 label languages, `en` not among them, `mul` =
 * "euro". An `en`-only currency query therefore silently drops every eurozone
 * country — measured 209 countries with `en` alone against 244 with this
 * fallback, and DE, IT, AT, GR, ES, IE, FI, EE, LT, LV, LU, MC, ME and more
 * simply absent. That is a 35-country hole that looks exactly like thin data.
 *
 * COALESCE rather than `FILTER(LANG(?x) IN ("en","mul"))`, because an item
 * carrying both would emit two rows and the pickers take first-seen — which
 * makes the artifact depend on result order and rewrites it on nights when
 * nothing changed.
 */
const labelWithMulFallback = (subject, out) =>
  `OPTIONAL { ${subject} rdfs:label ?${out}En . FILTER(LANG(?${out}En) = "en") }\n` +
  `    OPTIONAL { ${subject} rdfs:label ?${out}Mul . FILTER(LANG(?${out}Mul) = "mul") }\n` +
  `    BIND(COALESCE(?${out}En, ?${out}Mul) AS ?${out})`;

/** `VALUES ?country { "AD" "AE" … }` for one batch. */
const valuesClause = (variable, codes) => `VALUES ?${variable} { ${codes.map((code) => `"${code}"`).join(' ')} }`;

/**
 * The shipping query for one property over one batch of country codes.
 *
 * Every one of these is anchored on `?c wdt:P297 ?country` — the ISO code is
 * the join key AND the country universe, so a query can only ever speak about
 * codes this build asked for. `wdt:` is truthy-only, which is what keeps
 * Germany's normal-rank Deutsche Mark and France's livre tournois out of the
 * currency answer while their preferred-rank euro stays in.
 *
 * Two queries need statement-level access and say why in place. The rest are
 * one triple plus a label.
 *
 * Investigation 3's warning is the reason each of these was measured
 * individually before shipping: the same emergency-number question returned 0,
 * then 84, then the correct 155 rows depending on `BIND` and `OPTIONAL`
 * scoping inside Blazegraph. A query here is a measured artefact, not a
 * detail.
 *
 * @param {{ name: string, property: string, fields: string[], columns: string[], batch: number }} property
 * @param {string[]} codes
 * @returns {string}
 */
export function buildQuery(property, codes) {
  switch (property.name) {
    // The universe. Bounded by `VALUES` rather than left as an unbounded
    // `?item wdt:P297 ?code`, because unbounded returns 259 codes including
    // the historical DD (East Germany), YU (Yugoslavia) and AN (Netherlands
    // Antilles) and the uninhabited AQ/BV/HM — measured 2026-08-27, and the
    // app ships a city shard for none of them. Bounded, the answer is the
    // intersection, and a code Wikidata has stopped coding drops out where the
    // count band sees it.
    //
    // The FILTER is not a stylistic choice and must not be "simplified" back
    // into `?item wdt:P297 ?code`. Measured against the live endpoint on
    // 2026-08-27, that direct form returns HTTP 200 with a CSV header and ZERO
    // rows for the same 246 codes this form answers in full — Blazegraph binds
    // the VALUES set straight into the object position and the join misses,
    // while every other query here escapes it only because it carries further
    // triples on `?c`. This is Investigation 3's `BIND`/`OPTIONAL` scoping
    // hazard, in the one place where a wrong answer is a total wipe rather
    // than a thin field, and it was caught by the count band throwing "5
    // countries carry facts, expected 246" on the first real run rather than
    // by reading the query.
    case 'codes':
      return `SELECT DISTINCT ?code WHERE {
  ${valuesClause('code', codes)}
  ?item wdt:P297 ?isoCode .
  FILTER(?isoCode = ?code)
}`;

    // The country's own label. One triple and a label, and the label is the
    // whole point: `?c` here is the item whose P297 is the ISO code, so the
    // name is the name of the exact entity every other query in this file
    // joins through - NL's is "Kingdom of the Netherlands" for the same reason
    // its P38 answers EUR/USD/AWG/XCG, and that consistency is worth more than
    // a prettier name from a second item nothing else here speaks about.
    case 'name':
      return `SELECT DISTINCT ?country ?value WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ${labelWithMulFallback('?c', 'value')}
}`;

    // P38 -> P498. The name is the currency item's own label, so `EUR` and
    // "euro" always come from one item and can never be paired across two.
    case 'currency':
      return `SELECT DISTINCT ?country ?code ?name WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c wdt:P38 ?currency .
  ?currency wdt:P498 ?code .
  ${labelWithMulFallback('?currency', 'name')}
}`;

    // `?item` is selected as well as its label because `DROPPED_PLUG_ITEMS`
    // acts on the Q-id: dropping the Wikipedia article by id survives an
    // upstream label edit, and dropping it by label would not.
    case 'plugs':
      return `SELECT DISTINCT ?country ?item ?itemLabel WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c wdt:P2853 ?item .
  ${labelWithMulFallback('?item', 'itemLabel')}
}`;

    case 'voltage':
      return `SELECT DISTINCT ?country ?value WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c wdt:P2884 ?value .
}`;

    // P1622's values are items whose labels are the bare words "left" and
    // "right" — measured 2026-08-27, 170 right / 77 left over 246 countries.
    // The 247th row is AR, which carries both because Argentina drove on the
    // left until 1945; `pickDrivingSide` withholds it, and that is the whole
    // of the design's unexplained 246 -> 245.
    case 'drivingSide':
      return `SELECT DISTINCT ?country ?value WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c wdt:P1622 ?side .
  ${labelWithMulFallback('?side', 'value')}
}`;

    // Statement-level, because the ROLE is a P366 qualifier on the statement
    // and `wdt:` throws qualifiers away. `?st a wikibase:BestRank` is the
    // truthy filter a `wdt:` path would have given for free — without it,
    // superseded emergency numbers come back as current ones.
    //
    // The OPTIONAL wraps the qualifier AND its label together, so a role whose
    // item has no label leaves `?role` unbound rather than dropping the number
    // — a number with no role still reaches `pickEmergency`, which is what
    // keeps the 67 single-number countries publishable.
    case 'emergency':
      return `SELECT DISTINCT ?country ?number ?role WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c p:P2852 ?st .
  ?st a wikibase:BestRank .
  ?st ps:P2852 ?num .
  ${labelWithMulFallback('?num', 'number')}
  OPTIONAL {
    ?st pq:P366 ?use .
    ${labelWithMulFallback('?use', 'role')}
  }
}`;

    // Statement-level, and NOT `wdt:P37`, because the thing that makes a P37
    // value publishable is a QUALIFIER and `wdt:` throws qualifiers away.
    // `P518 applies to part` is upstream saying, on the statement itself, that
    // this is not a claim about the whole country: every truthy P37 statement
    // the United States carries is scoped to a territory, so the `wdt:` form
    // published "Carolinian, Chamorro, Hawaiian, Samoan and Spanish are
    // official languages" about the US. `?scoped` carries that fact out to
    // `pickLanguages`, which withholds the whole field — the withhold decision
    // stays in reviewed JavaScript where the diagnostics and the gate can see
    // it, rather than disappearing into a FILTER whose effect nothing can
    // count.
    //
    // `?st a wikibase:BestRank` is the truthy filter `wdt:` would have given
    // for free, and it matters here beyond tidiness: US English is DEPRECATED
    // rank ("wrong property", disputed by the Constitution, subject of
    // Executive Order 14224), so it is absent from both forms and no rule in
    // this file may pretend otherwise.
    //
    // `P1001 applies to jurisdiction` is the other qualifier that would mean
    // the same thing. Measured 2026-08-27 across all 246 codes, it appears on
    // ZERO P37 statements, so it deliberately gets no clause — see
    // `PLUG_LETTERS` on the dead `Type D`/`Type M` rows.
    //
    // `?item` is selected as well as its label for `pickPlugs`'s reason:
    // `DROPPED_LANGUAGE_ITEMS` acts on the Q-id, so dropping Guinea's
    // "languages of Guinea" meta-item, or Norway's two written forms, survives
    // an upstream label edit while dropping them by label would not.
    //
    // Measured 2026-08-27: this form returns 451 rows over 243 countries, the
    // same as the `wdt:` form it replaces, so the batch density in
    // `PROPERTIES` is unchanged.
    case 'languages':
      return `SELECT DISTINCT ?country ?item ?value ?scoped WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c p:P37 ?st .
  ?st a wikibase:BestRank .
  ?st ps:P37 ?item .
  ${labelWithMulFallback('?item', 'value')}
  BIND(EXISTS { ?st pq:P518 ?part } AS ?scoped)
}`;

    case 'callingCode':
      return `SELECT DISTINCT ?country ?value WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c wdt:P474 ?value .
}`;

    // Statement-level again, for the value NODE: `wdt:P625` hands back a WKT
    // point that would have to be parsed by hand, while `psv:` exposes the
    // latitude Wikidata already decomposed. `a wikibase:BestRank` keeps
    // superseded centroids out, which is what makes every country's answer
    // single-valued — `pickLatitude` withholds on anything else.
    case 'coordinate':
      return `SELECT DISTINCT ?country ?lat WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c p:P625 ?st .
  ?st a wikibase:BestRank .
  ?st psv:P625 ?node .
  ?node wikibase:geoLatitude ?lat .
}`;

    default:
      throw new Error(`no SPARQL query is defined for property "${property.name}"`);
  }
}

/** `codes` split into `size`-long batches, in order. */
export function batchCodes(codes, size) {
  const batches = [];
  for (let i = 0; i < codes.length; i += Math.max(1, size)) batches.push(codes.slice(i, i + Math.max(1, size)));
  return batches;
}

/**
 * One property's rows, in batches.
 *
 * One request per property rather than one joined query, because that is the
 * granularity demotion needs: a single joined query makes one property's
 * bail-out indistinguishable from every property failing, and the whole
 * carry-forward defence rests on being able to tell them apart.
 *
 * A batch that fails THROWS the whole property rather than returning what the
 * other batches managed. Partial rows are the Task 7 shape at a smaller scale:
 * they would arrive as an ordinary answer covering four fifths of the world,
 * and `isPropertyAnswerPlausible` would wave through anything above 80%.
 * Failing the property routes it to demotion and carry-forward instead, which
 * loses one night's freshness rather than a field.
 *
 * @param {string} name
 * @param {string[]} codes
 * @returns {Promise<Row[]>}
 */
export async function fetchPropertyRows(name, codes) {
  const property = PROPERTIES.find((entry) => entry.name === name);
  if (!property) throw new Error(`unknown property query "${name}"`);
  const batches = batchCodes(codes, property.batch);
  /** @type {Row[]} */
  const rows = [];
  for (const [index, batch] of batches.entries()) {
    if (rows.length > 0 || index > 0) await sleep(POLITENESS_DELAY_MS);
    const started = Date.now();
    const text = await fetchWithRetry(SPARQL_ENDPOINT, {
      body: `query=${encodeURIComponent(buildQuery(property, batch))}`,
      accept: 'text/csv',
    });
    const parsed = parseBindings(text, property.columns);
    rows.push(...parsed);
    console.log(
      `  ${property.property} ${name} batch ${index + 1}/${batches.length} ` +
      `(${batch.length} codes): ${parsed.length} rows in ${Date.now() - started}ms`
    );
  }
  return rows;
}

