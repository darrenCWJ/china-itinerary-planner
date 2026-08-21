import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import {
  cdnUrl,
  erApiUrl,
  fetchJsonWithTimeout,
  parseCdnRates,
  parseErApiRates,
  resolveRates,
  type NormalizedRates,
} from "@/lib/rates";

// Upstream refreshes at most daily (`time_next_update_utc` in er-api's own
// payload) — hourly sits well inside their documented throttle guidance and
// is what "you may cache the data" in er-api's terms is asking for.
const REVALIDATE_SECONDS = 3600;
// A hung upstream must count as a failure quickly enough that the CDN
// fallback (and, beyond that, the stale cache) still has time to answer
// within a user-facing time budget — a fetch that never resolves is
// indistinguishable from "down" as far as this route is concerned. The two
// fetches run in series, so a both-providers-hanging outage — precisely
// the case the stale cache exists for — costs up to 2x this value before
// that branch is reached. The previous 5s-per-fetch budget meant a full
// outage cost 10s before showing a cached rate; 3s+3s halves that to a
// still-generous 6s worst case (real upstream responses land in well under
// a second) without materially reducing the odds of a legitimately slow
// provider getting a fair chance to answer.
const FETCH_TIMEOUT_MS = 3000;

// Fetch is cheap to retry and there is no per-request work to resume, so an
// explicit, comfortably-above-worst-case budget documents the route's
// actual time contract rather than relying on the platform's default
// function-execution ceiling (which can be far larger than anything this
// route should ever need).
export const maxDuration = 10;

// The Next.js fetch-cache option belongs to this route's caching policy,
// not to the generic "fetch JSON with a timeout" helper — so it's applied
// here, by wrapping `fetch` before handing it to `fetchJsonWithTimeout`,
// rather than baked into that helper.
const fetchWithRevalidate: typeof fetch = (input, init) =>
  fetch(input, { ...init, next: { revalidate: REVALIDATE_SECONDS } });

async function fetchErApiRates(base: string): Promise<NormalizedRates | null> {
  const json = await fetchJsonWithTimeout(erApiUrl(base), {
    timeoutMs: FETCH_TIMEOUT_MS,
    fetchImpl: fetchWithRevalidate,
  });
  return json === null ? null : parseErApiRates(json, base);
}

async function fetchCdnRates(base: string): Promise<NormalizedRates | null> {
  const json = await fetchJsonWithTimeout(cdnUrl(base), {
    timeoutMs: FETCH_TIMEOUT_MS,
    fetchImpl: fetchWithRevalidate,
  });
  return json === null ? null : parseCdnRates(json, base);
}

/**
 * GET /api/rates?base=XXX — a normalised, cached, provider-redundant rate
 * table for display only (see J-C2: fetched rates never feed
 * `convertedTotals` or a stored amount). Gated on a session exactly like
 * `app/api/me/prefs/route.ts` — this endpoint isn't trip-scoped, so there is
 * no member to resolve, just "is someone signed in." The wall (`proxy.ts`)
 * passes every `/api/*` path through untouched ("routes self-enforce"), so
 * this check is the only gate this route has, deliberately.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Sign in to see live exchange rates" }, { status: 401 });
  }

  // Upcased before both the allowlist check and the fetch calls below, so
  // whatever case the caller sent, `resolveRates` and the fetchers agree on
  // the same string.
  const base = (req.nextUrl.searchParams.get("base") ?? "").trim().toUpperCase();

  // `fetchErApiRates`/`fetchCdnRates` are passed directly, not wrapped in a
  // closure over `base` — `resolveRates` calls them with the base it just
  // validated, so that validated string is structurally what reaches the
  // URL builders, not merely "the same local a closure happened to capture."
  const result = await resolveRates(base, {
    fetchErApi: fetchErApiRates,
    fetchCdn: fetchCdnRates,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  // Only the normalised object goes out — never the raw upstream body. Both
  // providers' terms are more permissive about a derived shape than a
  // verbatim re-serve, and er-api's explicitly forbid redistribution.
  return NextResponse.json(result.data);
}
