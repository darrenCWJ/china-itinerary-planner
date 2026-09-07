/**
 * ingest-cities — data/cities-report.md.
 *
 * Moved verbatim out of scripts/ingest-cities.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `run`, the run guard — is still
 * scripts/ingest-cities.mjs.
 *
 * `lib/contracts.test.ts` (C7) reads this file by path: it is the generator of
 * data/cities-report.md, and the contract asserts that the generator names
 * `GeoNamesCredit`.
 */

import { CITIES_PER_COUNTRY, DEDUP_RADIUS_KM } from './build.mjs';
import { CITIES_URL, SOURCE_ATTRIBUTION, SOURCE_LICENSE } from './io.mjs';

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * The report describes the CATALOG, never the run.
 *
 * No "N shards changed this run" line, deliberately: that number is 246 on a
 * first run and 0 on a quiet one, which would make this file differ every time
 * the previous run's numbers differed — and this file is committed. It is
 * logged to the console instead, where per-run facts belong. Everything below
 * is a function of the shards alone, so a rebuild with no data change produces
 * a byte-identical report and `git status` stays clean.
 *
 * Exported (unlike the rest of `run()`'s internals) so `data/cities-report.md`
 * can be regenerated from the 246 shard files already on disk — e.g. after a
 * wording-only change to this function — without a full network ingest.
 */
export function buildReport({ shards, total, generatedAt, largest }) {
  const bySize = [...shards.entries()]
    .map(([code, cities]) => [code, cities.length])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15);
  return [
    '# Worldwide city catalog report',
    '',
    `- Generated: ${generatedAt}`,
    `- Source: ${CITIES_URL}`,
    `- Licence: ${SOURCE_LICENSE} — ${SOURCE_ATTRIBUTION}`,
    `- Filter: composite score (alternate names + 2 x log10 population), top ${CITIES_PER_COUNTRY} per country`,
    `- Deduplicated against data/catalog.json within ${DEDUP_RADIUS_KM} km on a folded name match`,
    '',
    `**${total} cities across ${shards.size} countries.**`,
    '',
    `Largest shard: ${largest.code} at ${(largest.bytes / 1024).toFixed(1)} KB raw.`,
    '',
    '## Attribution',
    '',
    'GeoNames data is licensed CC BY 4.0, which requires a visible credit AND an',
    'indication that the material was changed. It was: the filter above cuts each',
    'country to its top scorers, admin-1 codes are resolved to human-readable',
    'names, and near-duplicates of the curated catalog are dropped. Both the credit',
    'and the modification notice are rendered in the UI by',
    '`components/plan/GeoNamesCredit.tsx`, from these files:',
    '',
    '- `app/plan/page.tsx` — the planning wizard, beside the footer rather than',
    '  inside it, because that footer is `print:hidden` and the generated plan is',
    '  meant to be printed',
    '- `components/DestinationStep.tsx` — the destination step, under the search',
    '- `components/TripView.tsx` — twice: the member view and the join-code guest',
    '  view of the shared trip page',
    '- `app/b/[code]/page.tsx` — the bearer-link briefing',
    '- `components/shell/ShareBriefing.tsx` — the briefing behind Share › "View',
    '  briefing". It carries its own credit rather than inheriting one, because',
    '  nothing in its ancestry renders a credit: ShareMenu, then AppShell, then',
    '  the root layout, which wraps every route',
    '- `components/home/TripsDashboard.tsx` — the signed-in home page trip list',
    '',
    '`lib/contracts.test.ts` (C7) fails if one of the files listed above drops it.',
    'That list is not the whole guarantee, because a hardcoded list cannot catch a',
    'surface added later: C7 also derives the set, scanning every `.tsx` under',
    '`app/` and `components/` for the tokens that carry city names and requiring',
    'each match to either render the credit or sit on an explicit allowlist naming',
    'the parent surface that renders it instead.',
    '',
    'This file is NOT the credit and never was — a line in a generated report does',
    'not discharge CC BY 4.0. It records where the credit lives so that deleting',
    'the component is a visible break rather than a silent one.',
    '',
    '## Most cities by country',
    '',
    '| Country | Cities |',
    '| --- | --- |',
    ...bySize.map(([code, n]) => `| ${code} | ${n} |`),
    '',
  ].join('\n');
}

