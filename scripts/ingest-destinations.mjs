#!/usr/bin/env node
/**
 * ingest-destinations.mjs
 *
 * Builds data/catalog.json (+ data/catalog-report.md) from Wikidata SPARQL and
 * Wikipedia REST summaries: mainland-China cities (municipality / prefecture /
 * county level) and notable tourist attractions.
 *
 * Rerunnable and idempotent: outputs are written atomically (temp file +
 * rename), HTTP calls are retried with backoff, SPARQL queries run
 * sequentially, Wikipedia REST calls run with bounded concurrency.
 *
 * Query strategy: Wikidata's optimizer times out on "class membership + many
 * OPTIONAL joins" in one query, so ingestion is two-phase — (1) fetch member
 * Q-ids per class with a minimal query, (2) fetch labels/coords/images/etc.
 * for those ids in VALUES batches.
 *
 * Usage: node scripts/ingest-destinations.mjs
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT_DIR, 'data');
const CATALOG_PATH = join(DATA_DIR, 'catalog.json');
const REPORT_PATH = join(DATA_DIR, 'catalog-report.md');

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const ENWIKI_ACTION_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'ChinaItineraryPlanner/1.0 (personal project)';

const SPARQL_TIMEOUT_MS = 90_000;
const REST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [2_000, 8_000]; // two retries with backoff
const MAX_RETRY_AFTER_MS = 30_000;
const SPARQL_POLITENESS_DELAY_MS = 400;
const SUMMARY_TITLES_PER_REQUEST = 20; // Action API exlimit maximum
const SUMMARY_POLITENESS_DELAY_MS = 250;
const MEMBER_PAGE_SIZE = 1_000;
const DETAILS_BATCH_SIZE = 120;
const VALUES_BATCH_SIZE = 150;
const MAX_ATTRACTIONS = 4_000;
const NEAREST_CITY_MAX_KM = 150;
const MAX_INTEREST_TAGS = 4;
const MAX_DESCRIPTION_CHARS = 420;
const P131_WALK_MAX_DEPTH = 4;

/**
 * Q-ids verified empirically (2026-08-10) via wbsearchentities + SPARQL label
 * checks; `verifyClassLabels()` re-asserts the English labels on every run so
 * a silently repurposed entity aborts the ingest instead of corrupting data.
 */
const QIDS = {
  CHINA: { id: 'Q148', label: "People's Republic of China" },
  MUNICIPALITY: { id: 'Q1208802', label: 'direct-administered municipality' },
  SUB_PROVINCIAL: { id: 'Q250811', label: 'sub-province-level division' },
  PREFECTURE_CITY: { id: 'Q748149', label: 'prefecture-level city' },
  COUNTY_CITY: { id: 'Q1070990', label: 'county-level city' },
  SUBPREFECTURE_CITY: { id: 'Q1044880', label: 'subprefecture-level city' },
  TOURIST_ATTRACTION: { id: 'Q570116', label: 'tourist attraction' },
  AAAAA: { id: 'Q6838244', label: 'Chinese AAAAA-rated tourist attraction' },
  AAAA: { id: 'Q10925991', label: 'Chinese AAAA-rated tourist attractions' },
  WORLD_HERITAGE: { id: 'Q9259', label: 'World Heritage Site' },
};

/** Must exactly match the app's Interest type. */
const INTEREST_VOCABULARY = [
  'food', 'history', 'nature', 'beach', 'themepark', 'arcade',
  'shopping', 'nightlife', 'museums', 'hiking', 'family',
];

/** Keyword rules, applied in order, over "name + description" text. */
const INTEREST_RULES = [
  { tags: ['history'], re: /\b(ancient|dynast\w*|historic\w*|imperial|heritage|temple|palace|pagoda|tomb|mausoleum|monastery|fortress|city wall|great wall|ruins?|archaeolog\w*|confuci\w*|buddhis\w*|taois\w*|silk road|old town|ancient town|capital|revolution\w*|relic)\b/i },
  { tags: ['museums', 'history'], re: /\b(museum|memorial hall|art gallery|exhibition)\b/i },
  { tags: ['nature', 'hiking'], re: /\b(mountains?|gorge|canyon|valley|waterfall|forest|peak|karst|glacier|trail|trek\w*|hiking)\b/i },
  { tags: ['nature'], re: /\b(lake|scenic|national park|nature reserve|wetland|grassland|hot spring|river delta|geopark|botanical)\b/i },
  { tags: ['beach'], re: /\b(beach\w*|coastal|coastline|coast|seaside|island|bay|tropical|resort city|seaport)\b/i },
  { tags: ['themepark', 'family'], re: /\b(theme park|amusement park|water park|disney\w*|ferris wheel|roller coaster)\b/i },
  { tags: ['family'], re: /\b(zoo|aquarium|panda|safari park|children)\b/i },
  { tags: ['food'], re: /\b(cuisine|culinary|food|gastronom\w*|tea|noodle|hot ?pot|snack)\b/i },
  { tags: ['shopping'], re: /\b(shopping|trade|trading|commercial (?:center|centre|hub)|financial (?:center|centre|hub)|market|port city|metropolis)\b/i },
  { tags: ['nightlife'], re: /\b(nightlife|bar street|entertainment district)\b/i },
  { tags: ['arcade'], re: /\b(arcade)\b/i },
];

const REQUIRED_CITY_NAMES = ['Beijing', 'Shanghai', 'Chengdu', 'Sanya', 'Harbin'];
const REQUIRED_ATTRACTION_PATTERNS = [
  { label: 'Forbidden City', re: /forbidden city/i },
  { label: 'Zhangjiajie/Wulingyuan area', re: /zhangjiajie|wulingyuan/i },
];

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, { headers, timeoutMs, label }) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      if (res.status === 404) return null; // caller treats as "no data"
      if (!res.ok) {
        const error = new Error(`HTTP ${res.status} for ${label}: ${(await res.text()).slice(0, 200)}`);
        const retryAfterSeconds = Number(res.headers.get('retry-after'));
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          error.retryAfterMs = Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
        }
        throw error;
      }
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = Math.max(RETRY_DELAYS_MS[attempt], error.retryAfterMs ?? 0);
        console.warn(`  retry ${attempt + 1}/${RETRY_DELAYS_MS.length} for ${label} in ${delay}ms (${error.message.slice(0, 120)})`);
        await sleep(delay);
      }
    }
  }
  throw new Error(`Failed after retries: ${label}: ${lastError?.message}`);
}

async function sparql(query, label) {
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  const json = await fetchWithRetry(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
    timeoutMs: SPARQL_TIMEOUT_MS,
    label: `SPARQL ${label}`,
  });
  await sleep(SPARQL_POLITENESS_DELAY_MS); // be polite between sequential queries
  return json?.results?.bindings ?? [];
}

// ---------------------------------------------------------------------------
// Small parsing utilities
// ---------------------------------------------------------------------------

const qidFromUri = (uri) => uri.split('/').pop();

function parsePoint(wkt) {
  const match = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(wkt ?? '');
  if (!match) return null;
  return { lon: Number(match[1]), lat: Number(match[2]) };
}

function toThumbnailUrl(commonsFilePathUrl) {
  if (!commonsFilePathUrl) return null;
  return `${commonsFilePathUrl.replace(/^http:/, 'https:')}?width=640`;
}

/** Drop "(simplified Chinese: …; pinyin: …)" style parentheticals from extracts. */
function stripLanguageParentheticals(text) {
  if (!text) return text;
  return text.replace(/\s*\((?=[^)]*(?:Chinese|pinyin|romanized|[一-鿿]))[^()]*\)/g, '');
}

function firstSentences(text, maxSentences = 2) {
  if (!text) return null;
  const clean = stripLanguageParentheticals(text).replace(/\s+/g, ' ').trim();
  const sentences = clean.split(/(?<=[.!?])\s+(?=["'“(]?[A-Z0-9])/);
  let result = sentences.slice(0, maxSentences).join(' ');
  if (result.length > MAX_DESCRIPTION_CHARS && sentences.length > 1) result = sentences[0];
  if (result.length > MAX_DESCRIPTION_CHARS) result = `${result.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`;
  return result || null;
}

function deriveInterests(...textParts) {
  const text = textParts.filter(Boolean).join('. ');
  const tags = [];
  for (const rule of INTEREST_RULES) {
    if (!rule.re.test(text)) continue;
    for (const tag of rule.tags) {
      if (!tags.includes(tag)) tags.push(tag);
    }
  }
  return tags.slice(0, MAX_INTEREST_TAGS);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

function writeFileAtomic(path, content) {
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

// ---------------------------------------------------------------------------
// Step 1: verify class Q-ids against their expected English labels
// ---------------------------------------------------------------------------

async function verifyClassLabels() {
  console.log('Verifying class Q-ids against expected English labels…');
  const ids = Object.values(QIDS).map((q) => `wd:${q.id}`).join(' ');
  const rows = await sparql(
    `SELECT ?e ?label WHERE { VALUES ?e { ${ids} } ?e rdfs:label ?label. FILTER(LANG(?label) = "en") }`,
    'verify class labels',
  );
  const actual = new Map(rows.map((row) => [qidFromUri(row.e.value), row.label.value]));
  const failures = [];
  for (const { id, label } of Object.values(QIDS)) {
    const found = actual.get(id);
    if (found !== label) failures.push(`${id}: expected "${label}", got "${found ?? 'MISSING'}"`);
    else console.log(`  ok ${id} = ${found}`);
  }
  if (failures.length > 0) {
    throw new Error(`Q-id verification failed — aborting ingest:\n${failures.join('\n')}`);
  }
}

// ---------------------------------------------------------------------------
// Phase helpers: member queries + batched detail queries
// ---------------------------------------------------------------------------

const ENWIKI_LINK = '?article schema:about ?x; schema:isPartOf <https://en.wikipedia.org/>.';

function classMemberWhere(classQid, { requireSitelink = false, extraWhere = '' } = {}) {
  return `
    ?x p:P31 ?st. ?st ps:P31 wd:${classQid}.
    FILTER NOT EXISTS { ?st pq:P582 ?ended }
    FILTER NOT EXISTS { ?x wdt:P576 ?dissolved }
    ?x wdt:P17 wd:${QIDS.CHINA.id}.
    ${extraWhere}
    ${requireSitelink ? ENWIKI_LINK : ''}`;
}

/** Fetch all member Q-ids for a WHERE clause, paged to avoid timeouts. */
async function fetchMemberQids(where, label) {
  const qids = new Set();
  let offset = 0;
  for (;;) {
    const rows = await sparql(
      `SELECT DISTINCT ?x WHERE { ${where} } ORDER BY ?x LIMIT ${MEMBER_PAGE_SIZE} OFFSET ${offset}`,
      `${label} offset ${offset}`,
    );
    for (const row of rows) qids.add(qidFromUri(row.x.value));
    if (rows.length < MEMBER_PAGE_SIZE) break;
    offset += MEMBER_PAGE_SIZE;
  }
  return [...qids];
}

function buildDetailsQuery(qids) {
  const values = qids.map((qid) => `wd:${qid}`).join(' ');
  return `
SELECT ?x ?en ?zh ?coord ?img ?adminQ ?admin ?desc ?title WHERE {
  VALUES ?x { ${values} }
  OPTIONAL { ?x rdfs:label ?en. FILTER(LANG(?en) = "en") }
  OPTIONAL { ?x rdfs:label ?zh. FILTER(LANG(?zh) = "zh") }
  OPTIONAL { ?x wdt:P625 ?coord. }
  OPTIONAL { ?x wdt:P18 ?img. }
  OPTIONAL { ?x wdt:P131 ?adminQ. OPTIONAL { ?adminQ rdfs:label ?admin. FILTER(LANG(?admin) = "en") } }
  OPTIONAL { ?article schema:about ?x; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title. }
  OPTIONAL { ?x schema:description ?desc. FILTER(LANG(?desc) = "en") }
}`;
}

/**
 * Fetch labels/coords/images/admin/sitelink/description for the given Q-ids.
 * Returns Map<qid, entity>; first non-null binding wins per field.
 */
async function fetchDetailsMap(qids, label) {
  const details = new Map();
  const batches = chunk(qids, DETAILS_BATCH_SIZE);
  for (const [index, batch] of batches.entries()) {
    const rows = await sparql(buildDetailsQuery(batch), `${label} details ${index + 1}/${batches.length}`);
    for (const row of rows) {
      const qid = qidFromUri(row.x.value);
      const entity = details.get(qid) ?? {
        qid, name: null, chineseName: null, coord: null, image: null,
        adminQid: null, adminLabel: null, wikiTitle: null, wikidataDescription: null,
      };
      entity.name ??= row.en?.value ?? null;
      entity.chineseName ??= row.zh?.value ?? null;
      entity.coord ??= parsePoint(row.coord?.value);
      entity.image ??= toThumbnailUrl(row.img?.value);
      entity.adminQid ??= row.adminQ ? qidFromUri(row.adminQ.value) : null;
      entity.adminLabel ??= row.admin?.value ?? null;
      entity.wikiTitle ??= row.title?.value ?? null;
      entity.wikidataDescription ??= row.desc?.value ?? null;
      details.set(qid, entity);
    }
    if (batches.length > 1) console.log(`  details ${index + 1}/${batches.length} (${details.size} entities)`);
  }
  return details;
}

// ---------------------------------------------------------------------------
// Step 2: cities
// ---------------------------------------------------------------------------

const CITY_LEVEL_PRIORITY = { municipality: 0, prefecture: 1, county: 2 };

async function ingestCities() {
  const sources = [
    { name: 'direct-administered municipality', level: 'municipality',
      // P131 = PRC distinguishes the 4 current municipalities from ROC-era ones (e.g. Nanjing)
      where: classMemberWhere(QIDS.MUNICIPALITY.id, { extraWhere: `?x wdt:P131 wd:${QIDS.CHINA.id}.` }) },
    { name: 'sub-province-level city', level: 'prefecture',
      where: classMemberWhere(QIDS.SUB_PROVINCIAL.id) },
    { name: 'prefecture-level city', level: 'prefecture',
      where: classMemberWhere(QIDS.PREFECTURE_CITY.id) },
    { name: 'county-level city', level: 'county',
      where: classMemberWhere(QIDS.COUNTY_CITY.id, { requireSitelink: true }) },
    { name: 'subprefecture-level city', level: 'county',
      where: classMemberWhere(QIDS.SUBPREFECTURE_CITY.id, { requireSitelink: true }) },
  ];

  const levelByQid = new Map();
  const countsByClass = {};
  for (const source of sources) {
    console.log(`Fetching city members: ${source.name}…`);
    const memberQids = await fetchMemberQids(source.where, source.name);
    countsByClass[source.name] = memberQids.length;
    for (const qid of memberQids) {
      const existing = levelByQid.get(qid);
      if (!existing || CITY_LEVEL_PRIORITY[source.level] < CITY_LEVEL_PRIORITY[existing]) {
        levelByQid.set(qid, source.level);
      }
    }
    console.log(`  ${memberQids.length} members (running unique total ${levelByQid.size})`);
  }

  console.log(`Fetching details for ${levelByQid.size} cities…`);
  const details = await fetchDetailsMap([...levelByQid.keys()], 'cities');

  const cities = new Map();
  let droppedCount = 0;
  for (const [qid, level] of levelByQid) {
    const entity = details.get(qid);
    if (!entity?.name || !entity?.coord) { droppedCount += 1; continue; }
    // Municipalities are their own province-level unit; their P131 is the PRC.
    const province = entity.adminQid === QIDS.CHINA.id ? entity.name : entity.adminLabel;
    cities.set(qid, { ...entity, level, province });
  }
  if (droppedCount > 0) console.log(`  dropped ${droppedCount} cities without English label or coordinates`);
  return { cities, countsByClass, droppedCount };
}

async function fetchPopulations(cityQids) {
  console.log(`Fetching populations for ${cityQids.length} cities…`);
  const best = new Map(); // qid -> { value, date, preferred }
  for (const [index, batch] of chunk(cityQids, VALUES_BATCH_SIZE).entries()) {
    const values = batch.map((qid) => `wd:${qid}`).join(' ');
    const rows = await sparql(`
SELECT ?city ?pop ?date ?rank WHERE {
  VALUES ?city { ${values} }
  ?city p:P1082 ?st. ?st ps:P1082 ?pop; wikibase:rank ?rank.
  FILTER(?rank != wikibase:DeprecatedRank)
  OPTIONAL { ?st pq:P585 ?date. }
}`, `population batch ${index + 1}`);
    for (const row of rows) {
      const qid = qidFromUri(row.city.value);
      const candidate = {
        value: Math.round(Number(row.pop.value)),
        date: row.date?.value ?? '',
        preferred: row.rank.value.endsWith('PreferredRank'),
      };
      if (!Number.isFinite(candidate.value)) continue;
      const current = best.get(qid);
      if (!current || isBetterPopulation(candidate, current)) best.set(qid, candidate);
    }
  }
  console.log(`  populations found for ${best.size} cities`);
  return new Map([...best].map(([qid, entry]) => [qid, entry.value]));
}

function isBetterPopulation(candidate, current) {
  if (candidate.preferred !== current.preferred) return candidate.preferred;
  if (candidate.date !== current.date) return candidate.date > current.date;
  return candidate.value > current.value;
}

/**
 * Fetch intro extracts via the MediaWiki Action API, 20 titles per request
 * (sequential + politeness delay). The per-page REST summary endpoint
 * rate-limits hard at ~700 requests; this needs ~35 requests instead.
 */
async function fetchWikipediaSummaries(cities) {
  const citiesByTitle = new Map();
  for (const city of cities.values()) {
    if (!city.wikiTitle) continue;
    const list = citiesByTitle.get(city.wikiTitle) ?? [];
    list.push(city);
    citiesByTitle.set(city.wikiTitle, list);
  }
  const batches = chunk([...citiesByTitle.keys()], SUMMARY_TITLES_PER_REQUEST);
  console.log(`Fetching Wikipedia intro extracts for ${citiesByTitle.size} titles (${batches.length} batched Action API calls)…`);

  let failures = 0;
  for (const [index, batch] of batches.entries()) {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2',
      prop: 'extracts', exintro: '1', explaintext: '1', exlimit: 'max',
      redirects: '1', titles: batch.join('|'),
    });
    try {
      const json = await fetchWithRetry(`${ENWIKI_ACTION_API}?${params.toString()}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        timeoutMs: REST_TIMEOUT_MS,
        label: `extracts batch ${index + 1}/${batches.length}`,
      });
      const normalized = new Map((json?.query?.normalized ?? []).map((n) => [n.from, n.to]));
      const redirected = new Map((json?.query?.redirects ?? []).map((r) => [r.from, r.to]));
      const extractByTitle = new Map((json?.query?.pages ?? []).map((p) => [p.title, p.extract ?? null]));
      for (const requestedTitle of batch) {
        const normalTitle = normalized.get(requestedTitle) ?? requestedTitle;
        const finalTitle = redirected.get(normalTitle) ?? normalTitle;
        const extract = extractByTitle.get(finalTitle) ?? null;
        for (const city of citiesByTitle.get(requestedTitle)) city.summaryExtract = extract;
      }
    } catch (error) {
      failures += batch.length; // these cities fall back to Wikidata descriptions
      console.warn(`  extract batch ${index + 1} failed (${error.message.slice(0, 120)})`);
    }
    if ((index + 1) % 10 === 0 || index === batches.length - 1) {
      console.log(`  extract batches: ${index + 1}/${batches.length}`);
    }
    await sleep(SUMMARY_POLITENESS_DELAY_MS);
  }
  console.log(`  extracts done (${failures} titles fell back to Wikidata descriptions)`);
  return failures;
}

// ---------------------------------------------------------------------------
// Step 3: attractions
// ---------------------------------------------------------------------------

async function ingestAttractions(cityQidSet) {
  const sources = [
    { name: `tourist attraction subtree (${QIDS.TOURIST_ATTRACTION.id}, enwiki required)`,
      where: `?x wdt:P31/wdt:P279* wd:${QIDS.TOURIST_ATTRACTION.id}; wdt:P17 wd:${QIDS.CHINA.id}; wdt:P625 ?anyCoord. ${ENWIKI_LINK}` },
    { name: `AAAAA-rated scenic area (${QIDS.AAAAA.id})`,
      where: `?x wdt:P31 wd:${QIDS.AAAAA.id}; wdt:P625 ?anyCoord.` },
    { name: `AAAA-rated attraction (${QIDS.AAAA.id}, enwiki required)`,
      where: `?x wdt:P31 wd:${QIDS.AAAA.id}; wdt:P625 ?anyCoord. ${ENWIKI_LINK}` },
    { name: `World Heritage Site in China (P1435 = ${QIDS.WORLD_HERITAGE.id})`,
      where: `?x wdt:P1435 wd:${QIDS.WORLD_HERITAGE.id}; wdt:P17 wd:${QIDS.CHINA.id}; wdt:P625 ?anyCoord.` },
  ];

  const memberQids = new Set();
  const countsBySource = {};
  for (const source of sources) {
    console.log(`Fetching attraction members: ${source.name}…`);
    const qids = await fetchMemberQids(source.where, source.name);
    countsBySource[source.name] = qids.length;
    for (const qid of qids) memberQids.add(qid);
    console.log(`  ${qids.length} members (running unique total ${memberQids.size})`);
  }

  let droppedCount = 0;
  for (const qid of [...memberQids]) {
    if (cityQidSet.has(qid)) { memberQids.delete(qid); droppedCount += 1; }
  }

  console.log(`Fetching details for ${memberQids.size} attractions…`);
  const details = await fetchDetailsMap([...memberQids], 'attractions');

  const attractions = new Map();
  for (const qid of memberQids) {
    const entity = details.get(qid);
    if (!entity?.name || !entity?.coord) { droppedCount += 1; continue; }
    attractions.set(qid, { ...entity, description: entity.wikidataDescription });
  }
  console.log(`  kept ${attractions.size} attractions (dropped ${droppedCount}: no label/coords, or entity is an ingested city)`);
  return { attractions, countsBySource, droppedCount };
}

/**
 * Resolve each attraction's city by walking its P131 chain upward (batched
 * SPARQL, max depth 4) until it hits an ingested city.
 */
async function resolveCityByAdminChain(attractions, cityQidSet) {
  let frontier = new Set();
  for (const attraction of attractions.values()) {
    if (attraction.adminQid) frontier.add(attraction.adminQid);
  }
  const parentOf = new Map();

  for (let depth = 0; depth < P131_WALK_MAX_DEPTH && frontier.size > 0; depth++) {
    const unknown = [...frontier].filter((qid) => !cityQidSet.has(qid) && !parentOf.has(qid));
    frontier = new Set();
    if (unknown.length === 0) break;
    console.log(`P131 walk depth ${depth + 1}: resolving ${unknown.length} admin entities…`);
    for (const [index, batch] of chunk(unknown, VALUES_BATCH_SIZE).entries()) {
      const values = batch.map((qid) => `wd:${qid}`).join(' ');
      const rows = await sparql(
        `SELECT ?a ?p WHERE { VALUES ?a { ${values} } ?a wdt:P131 ?p. }`,
        `P131 walk depth ${depth + 1} batch ${index + 1}`,
      );
      for (const row of rows) {
        const admin = qidFromUri(row.a.value);
        const parent = qidFromUri(row.p.value);
        if (!parentOf.has(admin)) parentOf.set(admin, []);
        parentOf.get(admin).push(parent);
        frontier.add(parent);
      }
    }
  }

  const findCity = (startQid) => {
    const queue = [startQid];
    const seen = new Set(queue);
    while (queue.length > 0) {
      const qid = queue.shift();
      if (cityQidSet.has(qid)) return qid;
      for (const parent of parentOf.get(qid) ?? []) {
        if (!seen.has(parent)) { seen.add(parent); queue.push(parent); }
      }
    }
    return null;
  };

  let matched = 0;
  for (const attraction of attractions.values()) {
    attraction.cityQid = attraction.adminQid ? findCity(attraction.adminQid) : null;
    if (attraction.cityQid) matched += 1;
  }
  console.log(`  admin-chain matched ${matched}/${attractions.size} attractions to a city`);
  return matched;
}

function resolveCityByDistance(attractions, cityList) {
  let matched = 0;
  for (const attraction of attractions.values()) {
    if (attraction.cityQid) continue;
    let bestQid = null;
    let bestKm = Infinity;
    for (const city of cityList) {
      const km = haversineKm(attraction.coord.lat, attraction.coord.lon, city.lat, city.lon);
      if (km < bestKm) { bestKm = km; bestQid = city.qid; }
    }
    if (bestQid && bestKm <= NEAREST_CITY_MAX_KM) {
      attraction.cityQid = bestQid;
      matched += 1;
    }
  }
  console.log(`  nearest-city fallback matched ${matched} more attractions (within ${NEAREST_CITY_MAX_KM} km)`);
  return matched;
}

// ---------------------------------------------------------------------------
// Step 4: assemble, sanity-check, write
// ---------------------------------------------------------------------------

function buildCityRecords(cities, populations) {
  const records = [...cities.values()].map((city) => {
    const description = firstSentences(city.summaryExtract) ?? city.wikidataDescription ?? null;
    return {
      qid: city.qid,
      name: city.name,
      chineseName: city.chineseName,
      province: city.province,
      lat: city.coord.lat,
      lon: city.coord.lon,
      population: populations.get(city.qid) ?? null,
      description,
      interests: deriveInterests(city.name, description),
      image: city.image,
      level: city.level,
    };
  });
  records.sort((a, b) => (b.population ?? -1) - (a.population ?? -1) || a.name.localeCompare(b.name, 'en'));
  return records;
}

function buildAttractionRecords(attractions) {
  let records = [...attractions.values()].map((attraction) => ({
    qid: attraction.qid,
    name: attraction.name,
    chineseName: attraction.chineseName,
    cityQid: attraction.cityQid ?? null,
    lat: attraction.coord.lat,
    lon: attraction.coord.lon,
    description: attraction.description,
    interests: deriveInterests(attraction.name, attraction.description),
    image: attraction.image,
  }));
  if (records.length > MAX_ATTRACTIONS) {
    const richness = (record) => (record.image ? 2 : 0) + (record.description ? 1 : 0);
    records.sort((a, b) => richness(b) - richness(a));
    records = records.slice(0, MAX_ATTRACTIONS);
  }
  records.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return records;
}

function runSanityChecks(cityRecords, attractionRecords) {
  const checks = [];
  const cityNames = new Set(cityRecords.map((city) => city.name));
  for (const name of REQUIRED_CITY_NAMES) {
    checks.push({ name: `City present: ${name}`, pass: cityNames.has(name), required: true });
  }
  for (const { label, re } of REQUIRED_ATTRACTION_PATTERNS) {
    const pass = attractionRecords.some((a) => re.test(a.name) || re.test(a.description ?? ''));
    checks.push({ name: `Attraction present: ${label}`, pass, required: true });
  }
  checks.push({
    name: `Total cities in expected range (300–700, got ${cityRecords.length})`,
    pass: cityRecords.length >= 300 && cityRecords.length <= 700,
    required: false,
  });
  const vocab = new Set(INTEREST_VOCABULARY);
  const badTags = new Set();
  for (const record of [...cityRecords, ...attractionRecords]) {
    for (const tag of record.interests) if (!vocab.has(tag)) badTags.add(tag);
  }
  checks.push({
    name: `All interest tags within allowed vocabulary${badTags.size > 0 ? ` (bad: ${[...badTags].join(', ')})` : ''}`,
    pass: badTags.size === 0,
    required: true,
  });
  return checks;
}

const percent = (part, whole) => (whole === 0 ? '0.0' : ((100 * part) / whole).toFixed(1));

function buildReport({ cityRecords, attractionRecords, checks, stats, elapsedSeconds }) {
  const cityLevels = { municipality: 0, prefecture: 0, county: 0 };
  for (const city of cityRecords) cityLevels[city.level] += 1;
  const citiesWithPop = cityRecords.filter((c) => c.population != null).length;
  const citiesWithImage = cityRecords.filter((c) => c.image).length;
  const citiesWithDesc = cityRecords.filter((c) => c.description).length;
  const attractionsWithImage = attractionRecords.filter((a) => a.image).length;
  const attractionsWithDesc = attractionRecords.filter((a) => a.description).length;
  const attractionsWithCity = attractionRecords.filter((a) => a.cityQid).length;

  const lines = [
    '# China Destinations Catalog — Ingestion Report',
    '',
    `Generated: ${new Date().toISOString()} (runtime ${elapsedSeconds}s)`,
    'Source: Wikidata (CC0) via SPARQL + English Wikipedia intro extracts (CC BY-SA, batched Action API).',
    'Regenerate with: `node scripts/ingest-destinations.mjs`',
    '',
    '## Verified Q-ids',
    '',
    'Each id is re-verified against its English label at the start of every run; the run aborts on mismatch.',
    '',
    '| Q-id | English label (verified) | Used as |',
    '|------|--------------------------|---------|',
    `| ${QIDS.CHINA.id} | ${QIDS.CHINA.label} | country filter (P17), municipality P131 discriminator |`,
    `| ${QIDS.MUNICIPALITY.id} | ${QIDS.MUNICIPALITY.label} | city level "municipality" (with P131=${QIDS.CHINA.id} to exclude ROC-era ones, e.g. Nanjing) |`,
    `| ${QIDS.SUB_PROVINCIAL.id} | ${QIDS.SUB_PROVINCIAL.label} | the 15 sub-provincial cities (Harbin, Chengdu, …) → level "prefecture" |`,
    `| ${QIDS.PREFECTURE_CITY.id} | ${QIDS.PREFECTURE_CITY.label} | city level "prefecture" |`,
    `| ${QIDS.COUNTY_CITY.id} | ${QIDS.COUNTY_CITY.label} | city level "county" (enwiki sitelink required) |`,
    `| ${QIDS.SUBPREFECTURE_CITY.id} | ${QIDS.SUBPREFECTURE_CITY.label} | province-administered county-level cities → level "county" |`,
    `| ${QIDS.TOURIST_ATTRACTION.id} | ${QIDS.TOURIST_ATTRACTION.label} | attraction class (P31/P279*, enwiki required) |`,
    `| ${QIDS.AAAAA.id} | ${QIDS.AAAAA.label} | AAAAA scenic areas (enwiki optional) |`,
    `| ${QIDS.AAAA.id} | ${QIDS.AAAA.label} | AAAA attractions (enwiki required) |`,
    `| ${QIDS.WORLD_HERITAGE.id} | ${QIDS.WORLD_HERITAGE.label} | via heritage designation P1435 (China's WHS are not P31 instances) |`,
    '',
    '## Cities',
    '',
    `- Total: **${cityRecords.length}** (municipality: ${cityLevels.municipality}, prefecture: ${cityLevels.prefecture}, county: ${cityLevels.county})`,
    ...Object.entries(stats.cityCountsByClass).map(([name, count]) => `- Raw from class "${name}": ${count}`),
    `- Dropped (missing English label or coordinates): ${stats.cityDropped}`,
    `- With population: ${citiesWithPop} (${percent(citiesWithPop, cityRecords.length)}%)`,
    `- With image: ${citiesWithImage} (${percent(citiesWithImage, cityRecords.length)}%)`,
    `- With description: ${citiesWithDesc} (${percent(citiesWithDesc, cityRecords.length)}%)`,
    `- Wikipedia intro extracts fetched (batched Action API) for every city with an enwiki sitelink (${stats.summaryFailures} titles fell back to Wikidata descriptions)`,
    '',
    '## Attractions',
    '',
    `- Total: **${attractionRecords.length}**`,
    ...Object.entries(stats.attractionCountsBySource).map(([name, count]) => `- Raw from source "${name}": ${count}`),
    `- Dropped (no label/coords or duplicate of a city entity): ${stats.attractionDropped}`,
    `- Matched to a city (cityQid non-null): ${attractionsWithCity} (${percent(attractionsWithCity, attractionRecords.length)}%) — ${stats.adminMatched} via P131 admin chain, ${stats.distanceMatched} via nearest city ≤ ${NEAREST_CITY_MAX_KM} km`,
    `- With image: ${attractionsWithImage} (${percent(attractionsWithImage, attractionRecords.length)}%)`,
    `- With description: ${attractionsWithDesc} (${percent(attractionsWithDesc, attractionRecords.length)}%)`,
    '',
    '## Sanity checks',
    '',
    ...checks.map((check) => `- [${check.pass ? 'x' : ' '}] ${check.pass ? 'PASS' : (check.required ? 'FAIL' : 'WARN')} — ${check.name}`),
    '',
    '## Notes / caveats',
    '',
    '- `province` is the English label of the direct P131 parent; for county-level cities that is usually their prefecture-level city, and for the four municipalities it is set to the city\'s own name (their P131 is the PRC itself).',
    '- Interests are keyword-derived from name + description against the app vocabulary: ' + INTEREST_VOCABULARY.join(', ') + '.',
    '- Population is the latest non-deprecated P1082 statement (preferred rank first, then newest point-in-time).',
    '- Images are Commons `Special:FilePath` URLs with `?width=640`.',
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = Date.now();
  mkdirSync(DATA_DIR, { recursive: true });

  await verifyClassLabels();

  const { cities, countsByClass: cityCountsByClass, droppedCount: cityDropped } = await ingestCities();
  const populations = await fetchPopulations([...cities.keys()]);
  const summaryFailures = await fetchWikipediaSummaries(cities);

  const cityQidSet = new Set(cities.keys());
  const { attractions, countsBySource: attractionCountsBySource, droppedCount: attractionDropped } =
    await ingestAttractions(cityQidSet);

  const adminMatched = await resolveCityByAdminChain(attractions, cityQidSet);
  const cityList = [...cities.values()].map((city) => ({ qid: city.qid, lat: city.coord.lat, lon: city.coord.lon }));
  const distanceMatched = resolveCityByDistance(attractions, cityList);

  const cityRecords = buildCityRecords(cities, populations);
  const attractionRecords = buildAttractionRecords(attractions);
  const checks = runSanityChecks(cityRecords, attractionRecords);

  const catalog = {
    generatedAt: new Date().toISOString(),
    source: 'Wikidata (CC0) + Wikipedia (CC BY-SA) summaries',
    cities: cityRecords,
    attractions: attractionRecords,
  };
  writeFileAtomic(CATALOG_PATH, JSON.stringify(catalog, null, 1));
  console.log(`Wrote ${CATALOG_PATH} (${cityRecords.length} cities, ${attractionRecords.length} attractions)`);

  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
  const report = buildReport({
    cityRecords, attractionRecords, checks, elapsedSeconds,
    stats: {
      cityCountsByClass, cityDropped, summaryFailures,
      attractionCountsBySource, attractionDropped, adminMatched, distanceMatched,
    },
  });
  writeFileAtomic(REPORT_PATH, report);
  console.log(`Wrote ${REPORT_PATH}`);

  for (const check of checks) {
    console.log(`${check.pass ? 'PASS' : (check.required ? 'FAIL' : 'WARN')} — ${check.name}`);
  }
  const hardFailures = checks.filter((check) => check.required && !check.pass);
  if (hardFailures.length > 0) {
    console.error(`\n${hardFailures.length} required sanity check(s) failed — outputs were still written for inspection.`);
    process.exitCode = 1;
  } else {
    console.log(`\nDone in ${elapsedSeconds}s.`);
  }
}

main().catch((error) => {
  console.error(`\nIngestion failed: ${error.message}`);
  console.error('If this is a network error, Wikidata/Wikipedia may be unreachable — rerun later; outputs were not modified.');
  process.exit(1);
});
