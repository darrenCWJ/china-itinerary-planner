import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Rates } from "./Rates";

/**
 * The disclosure defaults closed (mirrors `CurrencySettingsEditor`'s existing
 * pattern in MoneyTab.tsx), so every test opens it first. This also proves
 * the fetch is deferred until a member actually asks to see it — no reason to
 * hit /api/rates on every Money-tab render.
 */
function open() {
  fireEvent.click(screen.getByRole("button"));
}

let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(status: number, body: unknown) {
  fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fetchMock);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Every row this panel renders is priced against `pivot` (Important 2 —
 * see the Props doc on `Rates.tsx`'s `pivot` for the full rationale), so
 * every fixture below returns rates keyed relative to the pivot passed in,
 * never relative to `homeCurrency`.
 */
describe("both directions of the headline pair (home vs pivot)", () => {
  beforeEach(() => {
    stubFetch(200, {
      base: "CNY",
      rates: { SGD: 0.2, THB: 4 },
      asOf: "2026-08-21T00:02:00.000Z",
      source: "er-api",
      stale: false,
    });
  });

  test("renders the pair and its inverse for a known home/pivot pair, fetched against the pivot", async () => {
    render(
      <Rates tripCurrency="CNY" homeCurrency="SGD" pivot="CNY" extraCurrencies={[]} isMember />
    );
    open();

    expect(await screen.findByText(/1 CNY = 0\.2000 SGD/)).toBeInTheDocument();
    expect(screen.getByText(/1 SGD = 5\.00 CNY/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rates?base=CNY",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  test("shows the as-of date plainly and does not imply live-tick data", async () => {
    render(
      <Rates tripCurrency="CNY" homeCurrency="SGD" pivot="CNY" extraCurrencies={[]} isMember />
    );
    open();

    const asOf = await screen.findByText(/as of/i);
    expect(asOf.textContent).toMatch(/21 Aug 2026/);
    expect(asOf.textContent).toMatch(/UTC/);
    // Once a day, not live — the honesty requirement from the brief.
    expect(asOf.textContent?.toLowerCase()).toContain("not live");
  });

  test("lists an additional currency actually present in the trip's expenses (J-C5), priced against the pivot", async () => {
    render(
      <Rates
        tripCurrency="CNY"
        homeCurrency="SGD"
        pivot="CNY"
        extraCurrencies={["THB"]}
        isMember
      />
    );
    open();

    expect(await screen.findByText(/1 CNY = 4\.00 THB/)).toBeInTheDocument();
    expect(screen.getByText(/1 THB = 0\.2500 CNY/)).toBeInTheDocument();
  });

  test("never lists a currency nobody spent in", async () => {
    render(
      <Rates tripCurrency="CNY" homeCurrency="SGD" pivot="CNY" extraCurrencies={[]} isMember />
    );
    open();

    await screen.findByText(/1 CNY = 0\.2000 SGD/);
    expect(screen.queryByText(/THB/)).not.toBeInTheDocument();
  });

  test("the required attribution link is present", async () => {
    render(
      <Rates tripCurrency="CNY" homeCurrency="SGD" pivot="CNY" extraCurrencies={[]} isMember />
    );
    open();

    await screen.findByText(/1 CNY = 0\.2000 SGD/);
    const link = screen.getByRole("link", { name: /exchange rate api/i });
    expect(link).toHaveAttribute("href", "https://www.exchangerate-api.com");
  });
});

describe("Important 2 — an extra currency is priced against the pivot, never the home currency", () => {
  test("copying the extra-currency line into the rate editor gives the editor's own number, not a home-relative one", async () => {
    // home = SGD, pivot = CNY (a trip whose destination/pivot differs from
    // the member's home currency — exactly the J-C5 scenario the finding
    // describes). Rates are fetched and keyed relative to the pivot (CNY):
    // 1 CNY = 4 THB, i.e. 1 THB = 0.25 CNY — the number
    // `CurrencySettingsEditor`'s "1 THB = [___] CNY" row actually wants.
    stubFetch(200, {
      base: "CNY",
      rates: { SGD: 0.2, THB: 4 },
      asOf: "2026-08-21T00:02:00.000Z",
      source: "er-api",
      stale: false,
    });
    render(
      <Rates
        tripCurrency="CNY"
        homeCurrency="SGD"
        pivot="CNY"
        extraCurrencies={["THB"]}
        isMember
      />
    );
    open();

    // The correct, pivot-relative number for the editor.
    expect(await screen.findByText(/1 THB = 0\.2500 CNY/)).toBeInTheDocument();
    // The old, home-relative bug would have shown "1 THB = 0.0500 SGD"
    // instead (THB priced against SGD, off by roughly the SGD/CNY cross
    // rate) — that string must never appear.
    expect(screen.queryByText(/0\.0500/)).not.toBeInTheDocument();
    // And the fetch itself must target the pivot, not the home currency.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rates?base=CNY",
      expect.objectContaining({ cache: "no-store" })
    );
  });
});

describe("home currency equal to the pivot", () => {
  test("shows no redundant self-pair row for the home currency", async () => {
    stubFetch(200, {
      base: "CNY",
      rates: { THB: 4 },
      asOf: "2026-08-21T00:02:00.000Z",
      source: "er-api",
      stale: false,
    });
    render(
      <Rates
        tripCurrency="CNY"
        homeCurrency="CNY"
        pivot="CNY"
        extraCurrencies={["THB"]}
        isMember
      />
    );
    open();

    expect(await screen.findByText(/1 CNY = 4\.00 THB/)).toBeInTheDocument();
    // Only the THB row — no separate, redundant "1 CNY = ... CNY" self-pair
    // for the home currency now that it equals the pivot.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("stale-cache notice", () => {
  test("shows a stale notice when the API marks the response stale", async () => {
    stubFetch(200, {
      base: "CNY",
      rates: { SGD: 0.2 },
      asOf: "2026-08-20T00:02:00.000Z",
      source: "er-api",
      stale: true,
    });
    render(
      <Rates tripCurrency="CNY" homeCurrency="SGD" pivot="CNY" extraCurrencies={[]} isMember />
    );
    open();

    expect(await screen.findByText(/last rates we could reach/i)).toBeInTheDocument();
  });

  test("shows no stale notice when the response is fresh", async () => {
    stubFetch(200, {
      base: "CNY",
      rates: { SGD: 0.2 },
      asOf: "2026-08-21T00:02:00.000Z",
      source: "er-api",
      stale: false,
    });
    render(
      <Rates tripCurrency="CNY" homeCurrency="SGD" pivot="CNY" extraCurrencies={[]} isMember />
    );
    open();

    await screen.findByText(/1 CNY = 0\.2000 SGD/);
    expect(screen.queryByText(/last rates we could reach/i)).not.toBeInTheDocument();
  });
});

describe("empty state — no home currency set", () => {
  test("a member sees an honest message and a link to where they set it", () => {
    render(
      <Rates
        tripCurrency="CNY"
        homeCurrency={null}
        pivot="CNY"
        extraCurrencies={[]}
        isMember
      />
    );
    open();

    expect(screen.getByText(/no home currency/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /set it/i });
    expect(link).toHaveAttribute("href", "#currency-settings");
  });

  test("a non-member sees the same honest message with no dead link", () => {
    render(
      <Rates
        tripCurrency="CNY"
        homeCurrency={null}
        pivot="CNY"
        extraCurrencies={[]}
        isMember={false}
      />
    );
    open();

    expect(screen.getByText(/no home currency/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /set it/i })).not.toBeInTheDocument();
  });

  test("never calls the rates API when there is no home currency to price against", () => {
    stubFetch(200, { base: "CNY", rates: {}, asOf: "2026-08-21", source: "er-api", stale: false });
    render(
      <Rates
        tripCurrency="CNY"
        homeCurrency={null}
        pivot="CNY"
        extraCurrencies={[]}
        isMember
      />
    );
    open();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("empty state — the trip's country has no researched currency", () => {
  test("shows an honest notice instead of a guessed rate, but still prices what it can against the pivot", async () => {
    stubFetch(200, {
      base: "CNY",
      rates: { SGD: 0.2, THB: 4 },
      asOf: "2026-08-21T00:02:00.000Z",
      source: "er-api",
      stale: false,
    });
    render(
      <Rates
        tripCurrency={null}
        homeCurrency="SGD"
        pivot="CNY"
        extraCurrencies={["THB"]}
        isMember
      />
    );
    open();

    expect(await screen.findByText(/haven't researched/i)).toBeInTheDocument();
    // Extras the member actually spent in are still worth showing even though
    // the destination's own currency is unknown — priced against the pivot,
    // which (unlike `tripCurrency`) is never null.
    expect(screen.getByText(/1 CNY = 4\.00 THB/)).toBeInTheDocument();
  });
});

describe("a pivot the app allowed but the rates allowlist rejects (400)", () => {
  test("names the pivot honestly rather than showing a broken table", async () => {
    // The fetch is keyed by `pivot`, not `homeCurrency` (Important 2), so a
    // 400 from the allowlist is about the pivot the request was made with —
    // the message must name that, not the member's home currency.
    stubFetch(400, { error: 'Unknown currency code: "ZZZ"' });
    render(
      <Rates tripCurrency="CNY" homeCurrency="SGD" pivot="ZZZ" extraCurrencies={[]} isMember />
    );
    open();

    const message = await screen.findByText(/ZZZ/);
    expect(message.textContent).toMatch(/isn't (on|recognised)|not (on|recognised)/i);
  });
});

describe("both providers down and no cache (502)", () => {
  test("reports rates as temporarily unavailable, not broken", async () => {
    stubFetch(502, { error: "Exchange rates are temporarily unavailable and no cached rates exist yet" });
    render(
      <Rates tripCurrency="CNY" homeCurrency="SGD" pivot="CNY" extraCurrencies={[]} isMember />
    );
    open();

    expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument();
  });
});
