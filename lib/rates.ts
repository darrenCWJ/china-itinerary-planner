import { z } from "zod";

/** Where a normalised rate table came from — surfaced for diagnostics only; the UI must never branch on it. */
export type RateSource = "er-api" | "cdn";

/**
 * The one shape both providers' payloads normalise into, so nothing above
 * this module needs to know which source answered.
 *
 * `rates` only ever holds a code if the source gave a real, finite number for
 * it. A code the source has no usable value for — missing, `null`, `NaN`, a
 * non-numeric string — is simply absent from the map, never present as `0`.
 * A `0` rate would render a confidently wrong converted total; an absent key
 * is an honest "we don't know", which is what `money.ts`'s `convertedTotals`
 * already treats an unknown rate as (see its `unconverted` bucket).
 */
export interface NormalizedRates {
  /** Uppercase currency code the rates are expressed against. */
  base: string;
  /** Uppercase code → rate. Absent, never 0, for a code with no usable value. */
  rates: Record<string, number>;
  /** ISO 8601 timestamp — both sources' differently-shaped date fields land here. */
  asOf: string;
  source: RateSource;
}

function isUsableRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Every code is upcased and every value is checked for real before it is kept
 * — the one place both providers' "nothing sane for this currency" cases
 * (missing key, `null`, `NaN`, a string) collapse to the same outcome: the
 * key is not in the result. Zod's `z.unknown()` value schema means one bad
 * entry never fails the whole record — only that entry drops.
 */
const RateMapSchema = z.record(z.string(), z.unknown()).transform((raw) => {
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(raw)) {
    if (isUsableRate(value)) rates[code.toUpperCase()] = value;
  }
  return rates;
});

/** `null` when the source's date field doesn't parse to a real instant. */
function toIsoAsOf(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const ErApiSchema = z.object({
  // Rejected, not trusted: the provider is telling us this payload isn't a
  // rate table, so anything else it says (including `rates`) goes unread.
  result: z.literal("success"),
  base_code: z.string().trim().min(1),
  rates: RateMapSchema,
  time_last_update_utc: z.string().trim().min(1),
});

/**
 * er-api's shape: `{ result: "success", base_code, rates: { USD: 0.148, ... },
 * time_last_update_utc, ... }`, uppercase codes already. Unknown top-level
 * fields (`provider`, `documentation`, a field a future response adds) are
 * dropped by zod's default strip-unknown-keys behaviour rather than failing
 * the parse — a provider adding a field must not break the page.
 */
export function parseErApiRates(json: unknown): NormalizedRates | null {
  const parsed = ErApiSchema.safeParse(json);
  if (!parsed.success) return null;
  const asOf = toIsoAsOf(parsed.data.time_last_update_utc);
  if (asOf === null) return null;
  return {
    base: parsed.data.base_code.toUpperCase(),
    rates: parsed.data.rates,
    asOf,
    source: "er-api",
  };
}

/**
 * CDN fallback's shape: `{ date, <base>: { usd: 0.148, ... } }` — the rates
 * live under the base currency's own lowercase code rather than a fixed field
 * name, so the caller states which base it requested (it built the request
 * URL from that same value, so it already knows) instead of this module
 * guessing which top-level key looks rate-shaped.
 */
export function parseCdnRates(json: unknown, requestedBase: string): NormalizedRates | null {
  const key = requestedBase.trim().toLowerCase();
  if (key.length === 0) return null;
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;

  const date = z.string().trim().min(1).safeParse(obj.date);
  if (!date.success) return null;
  const rates = RateMapSchema.safeParse(obj[key]);
  if (!rates.success) return null;

  const asOf = toIsoAsOf(date.data);
  if (asOf === null) return null;
  return {
    base: key.toUpperCase(),
    rates: rates.data,
    asOf,
    source: "cdn",
  };
}

/**
 * ISO 4217 active currency codes this app is willing to ask an upstream
 * rates provider about. `base` arrives from a request's query string and is
 * interpolated straight into a fetch URL (see `app/api/rates/route.ts`) — an
 * unvalidated value there is a request-forgery primitive, since whatever
 * string a caller sends becomes part of a URL this server fetches. Checking
 * set membership here, rather than a regex that merely looks like a
 * currency code (three letters matches `ZZZ` and `XXX` just as happily as
 * `USD`), is what actually closes that off.
 *
 * Deliberately excludes the non-fiat ISO 4217 entries (precious metals
 * XAU/XAG, the IMF's XDR) — neither upstream provider quotes them, so
 * letting them through the allowlist would only widen the fetch surface
 * without adding anything either provider can answer.
 */
const KNOWN_CURRENCY_CODES: ReadonlySet<string> = new Set([
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
  "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL",
  "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY",
  "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP",
  "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD",
  "GNF", "GTQ", "GYD", "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR",
  "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF",
  "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL",
  "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR",
  "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR",
  "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR",
  "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD",
  "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SYP", "SZL", "THB", "TJS",
  "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD",
  "UYU", "UZS", "VES", "VND", "VUV", "WST", "XAF", "XCD", "XOF", "XPF",
  "YER", "ZAR", "ZMW", "ZWL",
]);

/**
 * Trims and upcases before checking, mirroring the normalisation
 * `lib/server/schemas.ts`'s `CurrencyCodeSchema` already applies — but
 * unlike that regex-based schema (which only checks "three letters" for a
 * value headed into storage), this checks real-code membership, because
 * this value's destination is a fetch URL, not a stored field.
 */
export function isKnownCurrencyCode(code: string): boolean {
  return KNOWN_CURRENCY_CODES.has(code.trim().toUpperCase());
}

/**
 * The one place a fetched rate table survives between requests: an
 * in-memory, per-process map from base code to the last table either
 * provider successfully returned for it. Deliberately not the database —
 * J-C2 keeps fetched rates read-only and display-only, never touching
 * stored trip data, and this cache exists solely so "both providers just
 * failed" can answer with something better than an error. It starts empty
 * on every cold start (a fresh serverless instance, or the dev server
 * restarting), so a cold start with both providers down has nothing to fall
 * back to — `resolveRates` below returns its no-cache error in that case.
 */
const lastGoodByBase = new Map<string, NormalizedRates>();

/** Null when nothing has ever been cached for this base on this instance. */
export function getLastGoodRates(base: string): NormalizedRates | null {
  return lastGoodByBase.get(base.trim().toUpperCase()) ?? null;
}

export function setLastGoodRates(rates: NormalizedRates): void {
  lastGoodByBase.set(rates.base, rates);
}

/** A normalised rate table plus whether it's a fresh answer or a carried-over one. */
export interface RatesResult extends NormalizedRates {
  stale: boolean;
}

/**
 * The two upstream calls, injected rather than made directly, so the
 * fallback ordering below is testable without a network or a route-test
 * harness (this repo has neither) — a fetcher returns the parsed rates on
 * success or `null` for anything that should trigger the next step: a
 * non-200, a `result !== "success"`, a timeout, or a body that doesn't
 * parse. Each fetcher already knows which base it's fetching for (it built
 * the request URL from it), so `resolveRates` never has to pass it through.
 */
export interface RatesFetchers {
  fetchErApi: () => Promise<NormalizedRates | null>;
  fetchCdn: () => Promise<NormalizedRates | null>;
}

export type ResolveRatesResult =
  | { ok: true; data: RatesResult }
  | { ok: false; status: 400 | 502; error: string };

/**
 * The fallback chain, as one pure decision over injected fetchers: er-api,
 * then the CDN, then the last good cached value (marked stale), then an
 * error — stopping at the first that produces something. `base` is checked
 * against the known-code allowlist before either fetcher is ever invoked,
 * so an unknown code never reaches a network call — the one invariant a
 * route test can't verify without a harness this repo doesn't have, so it's
 * proven here instead, against fake fetchers.
 */
export async function resolveRates(
  base: string,
  fetchers: RatesFetchers
): Promise<ResolveRatesResult> {
  const normalizedBase = base.trim().toUpperCase();
  if (!isKnownCurrencyCode(normalizedBase)) {
    return { ok: false, status: 400, error: `Unknown currency code: "${base}"` };
  }

  const primary = await fetchers.fetchErApi();
  if (primary) {
    setLastGoodRates(primary);
    return { ok: true, data: { ...primary, stale: false } };
  }

  const fallback = await fetchers.fetchCdn();
  if (fallback) {
    setLastGoodRates(fallback);
    return { ok: true, data: { ...fallback, stale: false } };
  }

  const cached = getLastGoodRates(normalizedBase);
  if (cached) {
    return { ok: true, data: { ...cached, stale: true } };
  }

  return {
    ok: false,
    status: 502,
    error: "Exchange rates are temporarily unavailable and no cached rates exist yet",
  };
}
