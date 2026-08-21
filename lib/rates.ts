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
