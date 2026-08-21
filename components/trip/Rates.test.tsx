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

describe("both directions of the headline pair", () => {
  beforeEach(() => {
    stubFetch(200, {
      base: "SGD",
      rates: { CNY: 5, THB: 20 },
      asOf: "2026-08-21T00:02:00.000Z",
      source: "er-api",
      stale: false,
    });
  });

  test("renders the pair and its inverse for a known trip/home currency pair", async () => {
    render(
      <Rates tripCurrency="CNY" homeCurrency="SGD" extraCurrencies={[]} isMember />
    );
    open();

    expect(await screen.findByText(/1 SGD = 5\.00 CNY/)).toBeInTheDocument();
    expect(screen.getByText(/1 CNY = 0\.2000 SGD/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rates?base=SGD",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  test("shows the as-of date plainly and does not imply live-tick data", async () => {
    render(<Rates tripCurrency="CNY" homeCurrency="SGD" extraCurrencies={[]} isMember />);
    open();

    const asOf = await screen.findByText(/as of/i);
    expect(asOf.textContent).toMatch(/21 Aug 2026/);
    expect(asOf.textContent).toMatch(/UTC/);
    // Once a day, not live — the honesty requirement from the brief.
    expect(asOf.textContent?.toLowerCase()).toContain("not live");
  });

  test("lists an additional currency actually present in the trip's expenses (J-C5)", async () => {
    render(
      <Rates tripCurrency="CNY" homeCurrency="SGD" extraCurrencies={["THB"]} isMember />
    );
    open();

    expect(await screen.findByText(/1 SGD = 20\.00 THB/)).toBeInTheDocument();
    expect(screen.getByText(/1 THB = 0\.0500 SGD/)).toBeInTheDocument();
  });

  test("never lists a currency nobody spent in", async () => {
    render(<Rates tripCurrency="CNY" homeCurrency="SGD" extraCurrencies={[]} isMember />);
    open();

    await screen.findByText(/1 SGD = 5\.00 CNY/);
    expect(screen.queryByText(/THB/)).not.toBeInTheDocument();
  });

  test("the required attribution link is present", async () => {
    render(<Rates tripCurrency="CNY" homeCurrency="SGD" extraCurrencies={[]} isMember />);
    open();

    await screen.findByText(/1 SGD = 5\.00 CNY/);
    const link = screen.getByRole("link", { name: /exchange rate api/i });
    expect(link).toHaveAttribute("href", "https://www.exchangerate-api.com");
  });
});

describe("stale-cache notice", () => {
  test("shows a stale notice when the API marks the response stale", async () => {
    stubFetch(200, {
      base: "SGD",
      rates: { CNY: 5 },
      asOf: "2026-08-20T00:02:00.000Z",
      source: "er-api",
      stale: true,
    });
    render(<Rates tripCurrency="CNY" homeCurrency="SGD" extraCurrencies={[]} isMember />);
    open();

    expect(await screen.findByText(/last rates we could reach/i)).toBeInTheDocument();
  });

  test("shows no stale notice when the response is fresh", async () => {
    stubFetch(200, {
      base: "SGD",
      rates: { CNY: 5 },
      asOf: "2026-08-21T00:02:00.000Z",
      source: "er-api",
      stale: false,
    });
    render(<Rates tripCurrency="CNY" homeCurrency="SGD" extraCurrencies={[]} isMember />);
    open();

    await screen.findByText(/1 SGD = 5\.00 CNY/);
    expect(screen.queryByText(/last rates we could reach/i)).not.toBeInTheDocument();
  });
});

describe("empty state — no home currency set", () => {
  test("a member sees an honest message and a link to where they set it", () => {
    render(<Rates tripCurrency="CNY" homeCurrency={null} extraCurrencies={[]} isMember />);
    open();

    expect(screen.getByText(/no home currency/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /set it/i });
    expect(link).toHaveAttribute("href", "#currency-settings");
  });

  test("a non-member sees the same honest message with no dead link", () => {
    render(
      <Rates tripCurrency="CNY" homeCurrency={null} extraCurrencies={[]} isMember={false} />
    );
    open();

    expect(screen.getByText(/no home currency/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /set it/i })).not.toBeInTheDocument();
  });

  test("never calls the rates API when there is no home currency to price against", () => {
    stubFetch(200, { base: "CNY", rates: {}, asOf: "2026-08-21", source: "er-api", stale: false });
    render(<Rates tripCurrency="CNY" homeCurrency={null} extraCurrencies={[]} isMember />);
    open();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("empty state — the trip's country has no researched currency", () => {
  test("shows an honest notice instead of a guessed rate", async () => {
    stubFetch(200, {
      base: "SGD",
      rates: { THB: 20 },
      asOf: "2026-08-21T00:02:00.000Z",
      source: "er-api",
      stale: false,
    });
    render(<Rates tripCurrency={null} homeCurrency="SGD" extraCurrencies={["THB"]} isMember />);
    open();

    expect(await screen.findByText(/haven't researched/i)).toBeInTheDocument();
    // Extras the member actually spent in are still worth showing even though
    // the destination's own currency is unknown.
    expect(screen.getByText(/1 SGD = 20\.00 THB/)).toBeInTheDocument();
  });
});

describe("a currency the app allowed but the rates allowlist rejects (400)", () => {
  test("names the home currency honestly rather than showing a broken table", async () => {
    stubFetch(400, { error: 'Unknown currency code: "ZZZ"' });
    render(<Rates tripCurrency="CNY" homeCurrency="ZZZ" extraCurrencies={[]} isMember />);
    open();

    const message = await screen.findByText(/ZZZ/);
    expect(message.textContent).toMatch(/isn't (on|recognised)|not (on|recognised)/i);
  });
});

describe("both providers down and no cache (502)", () => {
  test("reports rates as temporarily unavailable, not broken", async () => {
    stubFetch(502, { error: "Exchange rates are temporarily unavailable and no cached rates exist yet" });
    render(<Rates tripCurrency="CNY" homeCurrency="SGD" extraCurrencies={[]} isMember />);
    open();

    expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument();
  });
});
