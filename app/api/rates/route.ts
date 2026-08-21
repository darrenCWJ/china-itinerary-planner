import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { parseCdnRates, parseErApiRates, resolveRates, type NormalizedRates } from "@/lib/rates";

// Upstream refreshes at most daily (`time_next_update_utc` in er-api's own
// payload) — hourly sits well inside their documented throttle guidance and
// is what "you may cache the data" in er-api's terms is asking for.
const REVALIDATE_SECONDS = 3600;
// A hung upstream must count as a failure quickly enough that the CDN
// fallback (and, beyond that, the stale cache) still has time to answer
// within a normal request lifetime — a fetch that never resolves is
// indistinguishable from "down" as far as this route is concerned.
const FETCH_TIMEOUT_MS = 5000;

function erApiUrl(base: string): string {
  return `https://open.er-api.com/v6/latest/${base}`;
}

function cdnUrl(base: string): string {
  return `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${base.toLowerCase()}.json`;
}

/**
 * `null` covers every failure mode the brief lists as a trigger for the next
 * step in the fallback chain: a non-200 status, a network error, a timeout,
 * and a body that isn't valid JSON. None of them are distinguished further —
 * the caller only ever needs to know "did this provider give us something
 * usable," never why it didn't.
 */
async function fetchJsonWithTimeout(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchErApiRates(base: string): Promise<NormalizedRates | null> {
  const json = await fetchJsonWithTimeout(erApiUrl(base));
  return json === null ? null : parseErApiRates(json);
}

async function fetchCdnRates(base: string): Promise<NormalizedRates | null> {
  const json = await fetchJsonWithTimeout(cdnUrl(base));
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

  const result = await resolveRates(base, {
    fetchErApi: () => fetchErApiRates(base),
    fetchCdn: () => fetchCdnRates(base),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  // Only the normalised object goes out — never the raw upstream body. Both
  // providers' terms are more permissive about a derived shape than a
  // verbatim re-serve, and er-api's explicitly forbid redistribution.
  return NextResponse.json(result.data);
}
