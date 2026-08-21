import { describe, expect, test, vi } from "vitest";
import cdnFixture from "./data/rates-fixtures/cdn-cny.json";
import erApiFixture from "./data/rates-fixtures/er-api-cny.json";
import {
  cdnUrl,
  erApiUrl,
  fetchJsonWithTimeout,
  getLastGoodRates,
  isKnownCurrencyCode,
  parseCdnRates,
  parseErApiRates,
  resolveRates,
  setLastGoodRates,
  type NormalizedRates,
  type RateSource,
} from "./rates";

describe("parseErApiRates", () => {
  test("normalises the real er-api payload", () => {
    const parsed = parseErApiRates(erApiFixture, "CNY");
    expect(parsed).not.toBeNull();
    expect(parsed?.base).toBe("CNY");
    expect(parsed?.source).toBe("er-api");
    expect(parsed?.rates.USD).toBeCloseTo(0.148383);
    expect(parsed?.rates.JPY).toBeCloseTo(23.565029);
    // asOf is normalised to ISO 8601 regardless of the source's RFC-1123
    // string, so the UI only ever has one date format to render.
    expect(parsed?.asOf).toBe(new Date("Fri, 21 Aug 2026 00:02:31 +0000").toISOString());
  });

  test("normalised shape has exactly base/rates/asOf/source — no leaked provider fields", () => {
    const parsed = parseErApiRates(erApiFixture, "CNY");
    expect(Object.keys(parsed ?? {}).sort()).toEqual(["asOf", "base", "rates", "source"]);
  });

  test('rejects a payload whose result is not "success"', () => {
    const failure = { ...erApiFixture, result: "error" };
    expect(parseErApiRates(failure, "CNY")).toBeNull();
  });

  test("rejects a payload with no result field at all — absence is not trusted either", () => {
    const withoutResult = { ...erApiFixture } as Record<string, unknown>;
    delete withoutResult.result;
    expect(parseErApiRates(withoutResult, "CNY")).toBeNull();
  });

  test("a rate missing for a requested code is absent, never 0", () => {
    const parsed = parseErApiRates(erApiFixture, "CNY");
    expect(parsed?.rates.ZZZ).toBeUndefined();
    expect("ZZZ" in (parsed?.rates ?? {})).toBe(false);
  });

  test("a NaN-ish rate (null, NaN, non-numeric string) is dropped, not coerced to 0", () => {
    const broken = {
      ...erApiFixture,
      rates: { ...erApiFixture.rates, USD: Number.NaN, EUR: null, GBP: "n/a" },
    };
    const parsed = parseErApiRates(broken, "CNY");
    expect(parsed).not.toBeNull();
    expect(parsed?.rates.USD).toBeUndefined();
    expect(parsed?.rates.EUR).toBeUndefined();
    expect(parsed?.rates.GBP).toBeUndefined();
    // A sibling that is a real number is unaffected by its neighbours' rot.
    expect(parsed?.rates.JPY).toBeCloseTo(23.565029);
  });

  test("unknown extra top-level keys are ignored, not rejected", () => {
    const withExtra = { ...erApiFixture, someNewFieldTheProviderAdded: 12345 };
    expect(parseErApiRates(withExtra, "CNY")).not.toBeNull();
  });

  test("non-object input returns null instead of throwing", () => {
    expect(parseErApiRates(null, "CNY")).toBeNull();
    expect(parseErApiRates("garbage", "CNY")).toBeNull();
    expect(parseErApiRates(42, "CNY")).toBeNull();
    expect(parseErApiRates([], "CNY")).toBeNull();
  });

  test("accepts when the payload's base_code matches the requested base, case-insensitively", () => {
    expect(parseErApiRates(erApiFixture, "cny")).not.toBeNull();
    expect(parseErApiRates(erApiFixture, " CNY ")?.base).toBe("CNY");
  });

  test("rejects when the payload's base_code doesn't match the requested base", () => {
    // erApiFixture's own base_code is "CNY" (see "normalises the real
    // er-api payload" above). A caller that asked for a different base and
    // received this payload back anyway must not have it trusted silently
    // — a provider bug, a misrouted response, or a proxy serving a cached
    // reply under the wrong key could otherwise hand a EUR request
    // CNY-denominated rates mislabelled as EUR, and — because
    // `setLastGoodRates` keys by the returned `base` while
    // `getLastGoodRates` looks up the *requested* base — silently file the
    // result under a cache key nothing will ever look up again.
    expect(parseErApiRates(erApiFixture, "EUR")).toBeNull();
  });
});

describe("parseCdnRates", () => {
  test("normalises the real CDN payload and upcases every code", () => {
    const parsed = parseCdnRates(cdnFixture, "cny");
    expect(parsed).not.toBeNull();
    expect(parsed?.base).toBe("CNY");
    expect(parsed?.source).toBe("cdn");
    expect(parsed?.rates.USD).toBeCloseTo(0.14875538);
    expect(Object.keys(parsed?.rates ?? {})).not.toContain("usd");
    expect(parsed?.asOf).toBe(new Date("2026-08-21").toISOString());
  });

  test("normalised shape has exactly base/rates/asOf/source", () => {
    const parsed = parseCdnRates(cdnFixture, "cny");
    expect(Object.keys(parsed ?? {}).sort()).toEqual(["asOf", "base", "rates", "source"]);
  });

  test("real non-fiat extra keys (crypto tickers the app never asks for) don't break parsing", () => {
    // The trimmed fixture keeps two real crypto entries (1inch, aave) exactly
    // as fawazahmed0 sent them — proof a provider carrying currencies this
    // app doesn't recognise can't take the page down.
    const parsed = parseCdnRates(cdnFixture, "cny");
    expect(parsed).not.toBeNull();
    expect(parsed?.rates["1INCH"]).toBeCloseTo(1.67311696);
  });

  test("a rate missing for a requested code is absent, never 0", () => {
    const parsed = parseCdnRates(cdnFixture, "cny");
    expect(parsed?.rates.ZZZ).toBeUndefined();
  });

  test("rejects when the requested base's rates object isn't in the payload", () => {
    expect(parseCdnRates(cdnFixture, "usd")).toBeNull();
  });

  test("rejects a payload missing the date field", () => {
    const withoutDate = { ...cdnFixture } as Record<string, unknown>;
    delete withoutDate.date;
    expect(parseCdnRates(withoutDate, "cny")).toBeNull();
  });

  test("a NaN-ish rate (null, non-numeric string) is dropped, not coerced to 0", () => {
    const broken = {
      ...cdnFixture,
      cny: { ...cdnFixture.cny, usd: null, eur: "n/a" },
    };
    const parsed = parseCdnRates(broken, "cny");
    expect(parsed).not.toBeNull();
    expect(parsed?.rates.USD).toBeUndefined();
    expect(parsed?.rates.EUR).toBeUndefined();
    expect(parsed?.rates.JPY).toBeCloseTo(23.64561762);
  });

  test("non-object input returns null instead of throwing", () => {
    expect(parseCdnRates(null, "cny")).toBeNull();
    expect(parseCdnRates("garbage", "cny")).toBeNull();
    expect(parseCdnRates([], "cny")).toBeNull();
  });

  test("an empty or blank requested base returns null rather than guessing a key", () => {
    expect(parseCdnRates(cdnFixture, "")).toBeNull();
    expect(parseCdnRates(cdnFixture, "   ")).toBeNull();
  });
});

describe("isKnownCurrencyCode", () => {
  test("accepts real ISO codes regardless of case or surrounding whitespace", () => {
    expect(isKnownCurrencyCode("CNY")).toBe(true);
    expect(isKnownCurrencyCode("usd")).toBe(true);
    expect(isKnownCurrencyCode(" eur ")).toBe(true);
  });

  test("rejects a well-formed but unknown three-letter code", () => {
    // The exact case a "does this look like a currency code" regex would
    // wrongly let through — this is why the check is set membership, not a
    // shape check.
    expect(isKnownCurrencyCode("ZZZ")).toBe(false);
    expect(isKnownCurrencyCode("XXX")).toBe(false);
  });

  test("rejects input that isn't even the right shape", () => {
    expect(isKnownCurrencyCode("")).toBe(false);
    expect(isKnownCurrencyCode("US")).toBe(false);
    expect(isKnownCurrencyCode("USDD")).toBe(false);
    expect(isKnownCurrencyCode("1; DROP TABLE")).toBe(false);
  });
});

describe("getLastGoodRates / setLastGoodRates", () => {
  const sample = (base: string): NormalizedRates => ({
    base,
    rates: { USD: 0.14 },
    asOf: new Date("2026-08-21").toISOString(),
    source: "er-api",
  });

  test("returns null for a base nothing has ever been cached for", () => {
    // AWG is not touched by any other test in this file.
    expect(getLastGoodRates("AWG")).toBeNull();
  });

  test("returns what was stored, looked up case-insensitively", () => {
    setLastGoodRates(sample("AUD"));
    expect(getLastGoodRates("AUD")).toEqual(sample("AUD"));
    expect(getLastGoodRates("aud")).toEqual(sample("AUD"));
  });
});

describe("resolveRates", () => {
  const makeRates = (base: string, source: RateSource): NormalizedRates => ({
    base,
    rates: { USD: 0.14 },
    asOf: new Date("2026-08-21").toISOString(),
    source,
  });

  test("primary success skips the fallback entirely", async () => {
    const erApiResult = makeRates("GBP", "er-api");
    const fetchErApi = vi.fn().mockResolvedValue(erApiResult);
    const fetchCdn = vi.fn();

    const result = await resolveRates("GBP", { fetchErApi, fetchCdn });

    expect(fetchCdn).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: { ...erApiResult, stale: false } });
  });

  test("primary failure falls back to the CDN", async () => {
    const cdnResult = makeRates("JPY", "cdn");
    const fetchErApi = vi.fn().mockResolvedValue(null);
    const fetchCdn = vi.fn().mockResolvedValue(cdnResult);

    const result = await resolveRates("JPY", { fetchErApi, fetchCdn });

    expect(fetchErApi).toHaveBeenCalledTimes(1);
    expect(fetchCdn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, data: { ...cdnResult, stale: false } });
  });

  test("both providers failing returns the last good cached value, marked stale", async () => {
    // Prime the cache the same way a real prior request would: a successful
    // resolveRates call for this base.
    const primed = makeRates("KRW", "er-api");
    await resolveRates("KRW", {
      fetchErApi: vi.fn().mockResolvedValue(primed),
      fetchCdn: vi.fn(),
    });

    const fetchErApi = vi.fn().mockResolvedValue(null);
    const fetchCdn = vi.fn().mockResolvedValue(null);
    const result = await resolveRates("KRW", { fetchErApi, fetchCdn });

    expect(result).toEqual({ ok: true, data: { ...primed, stale: true } });
  });

  test("both providers failing with nothing cached yet is an error, not a throw", async () => {
    // NOK is not primed by any other test in this file.
    const fetchErApi = vi.fn().mockResolvedValue(null);
    const fetchCdn = vi.fn().mockResolvedValue(null);

    const result = await resolveRates("NOK", { fetchErApi, fetchCdn });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(502);
  });

  test("an invalid base is rejected before either fetcher is ever called", async () => {
    const fetchErApi = vi.fn();
    const fetchCdn = vi.fn();

    const result = await resolveRates("ZZZ", { fetchErApi, fetchCdn });

    expect(fetchErApi).not.toHaveBeenCalled();
    expect(fetchCdn).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  test("validation happens before any fetch — proven by fetchers that would throw if reached", async () => {
    // Belt-and-braces on the ordering claim above: if validation were ever
    // moved after the fetch calls, these rejections would fail the test
    // instead of the assertions quietly passing on an uncalled mock.
    const fetchErApi = vi.fn().mockRejectedValue(new Error("must not be called"));
    const fetchCdn = vi.fn().mockRejectedValue(new Error("must not be called"));

    await expect(
      resolveRates("NOTACODE", { fetchErApi, fetchCdn })
    ).resolves.toMatchObject({ ok: false, status: 400 });
  });

  test("passes the validated, normalised base into both fetchers — not the raw caller input", async () => {
    // `RatesFetchers` takes a `(base: string)` parameter specifically so
    // this is structurally guaranteed rather than true only by convention
    // (a route wrapper closing over the same local it validated). Both
    // fetchers are exercised: er-api is called unconditionally, and the CDN
    // fetcher only gets a turn once er-api has already failed.
    const fetchErApi = vi.fn().mockResolvedValue(null);
    const fetchCdn = vi.fn().mockResolvedValue(null);

    await resolveRates("  sek ", { fetchErApi, fetchCdn });

    expect(fetchErApi).toHaveBeenCalledWith("SEK");
    expect(fetchCdn).toHaveBeenCalledWith("SEK");
  });
});

describe("erApiUrl / cdnUrl", () => {
  test("erApiUrl builds the request URL from exactly the code it's given", () => {
    expect(erApiUrl("CNY")).toBe("https://open.er-api.com/v6/latest/CNY");
  });

  test("cdnUrl lowercases the code for the CDN's URL convention", () => {
    expect(cdnUrl("CNY")).toBe(
      "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.json"
    );
  });
});

describe("fetchJsonWithTimeout", () => {
  test("returns null for a non-200 response without reading the body", () => {
    const readBody = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, json: readBody }) as unknown as typeof fetch;

    return fetchJsonWithTimeout("https://example.test/x", { timeoutMs: 50, fetchImpl }).then(
      (result) => {
        expect(result).toBeNull();
        expect(readBody).not.toHaveBeenCalled();
      }
    );
  });

  test("returns null when the request is aborted (a hung provider)", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError"))
        );
      })) as unknown as typeof fetch;

    const result = await fetchJsonWithTimeout("https://example.test/x", {
      timeoutMs: 5,
      fetchImpl,
    });
    expect(result).toBeNull();
  });

  test("returns null when the body isn't valid JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    }) as unknown as typeof fetch;

    const result = await fetchJsonWithTimeout("https://example.test/x", {
      timeoutMs: 50,
      fetchImpl,
    });
    expect(result).toBeNull();
  });

  test("returns the parsed body on a real 200 response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ hello: "world" }),
    }) as unknown as typeof fetch;

    const result = await fetchJsonWithTimeout("https://example.test/x", {
      timeoutMs: 50,
      fetchImpl,
    });
    expect(result).toEqual({ hello: "world" });
  });
});
