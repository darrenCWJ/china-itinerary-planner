import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SearchableCurated } from "@/lib/placeSearch";
import { PlaceSearch, SHARD_CANDIDATES, type PickedPlace } from "./PlaceSearch";

/**
 * The plan declines a test here; the ruling reinstates one, because the
 * acceptance criteria it names are behaviour: "↓↑ moves active option, Enter
 * adds, Esc clears, input keeps focus", plus `aria-activedescendant` listbox
 * semantics — the a11y path spec §9 requires.
 *
 * Nothing below asserts on appearance. The catalog fetch is stubbed: the
 * debounce and abort logic is CatalogSearch's proven pattern, and what matters
 * here is the keyboard.
 */

const CURATED: SearchableCurated[] = [
  { id: "hangzhou", name: "Hangzhou", localName: "杭州", knownFor: ["tea"] },
  { id: "harbin", name: "Harbin", localName: null, knownFor: [] },
];

function setup(selected: PickedPlace[] = []) {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  render(
    <PlaceSearch
      curated={CURATED}
      coordsFor={(id) => (id === "hangzhou" ? { lat: 30.25, lon: 120.16 } : null)}
      selected={selected}
      country="CN"
      onAdd={onAdd}
      onRemove={onRemove}
    />
  );
  const input = screen.getByRole("combobox");
  return { input, onAdd, onRemove };
}

/** Comfortably past the component's 300ms debounce, on a real clock. */
const PAST_DEBOUNCE_MS = 400;

/**
 * Waits out the debounce with the timer *and* the fetch it starts inside `act`.
 *
 * The debounced callback awaits the response before calling `setHits`, so that
 * update lands long after the `fireEvent.change` that set the query. A bare
 * `await new Promise(setTimeout)` leaves React no act scope to attribute it to,
 * and the hits it writes land after the assertion below has already run.
 */
const pastDebounce = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, PAST_DEBOUNCE_MS));
  });

/** Options in listbox order, as a keyboard user would traverse them. */
const optionTexts = () => screen.getAllByRole("option").map((o) => o.textContent ?? "");

const activeOptionText = () => {
  const input = screen.getByRole("combobox");
  const id = input.getAttribute("aria-activedescendant");
  if (id === null) return null;
  return document.getElementById(id)?.textContent ?? null;
};

describe("PlaceSearch keyboard path", () => {
  beforeEach(() => {
    /**
     * Fake timers so the 300ms debounce cannot fire while a test is running.
     *
     * Every test here drives the keyboard synchronously over the curated set
     * and none of them wants the catalog request, but typing leaves the
     * debounce armed. It stays harmless today for two separate reasons, both
     * incidental rather than designed: the bodies finish well inside 300ms, so
     * `cleanup` unmounts and the effect clears the timer before it can fire;
     * and the stub answers with no results, so the update would change nothing
     * even if it did.
     *
     * Lose either — a body that outlives 300ms because the machine is loaded,
     * or a stub that grows a hit matching the typed query — and `setHits`
     * lands outside `act`. Probed with both together, which produces exactly
     * the warning this file is otherwise clean of; neither on its own does.
     *
     * Freezing the clock removes the arming, rather than leaving the file
     * resting on two coincidences that nothing here states or checks.
     */
    vi.useFakeTimers();
    // No network in these tests; ranking over the curated set plus the off-map
    // row is enough to exercise every key.
    //
    // `PlaceSearch` now fetches /cities/<CC>.json on mount, and the stub this
    // replaced had no `ok` — so `fetchCityShard` would read `undefined`, throw,
    // and land a `setShard` in a microtask outside `act`: exactly the warning
    // the block above says this file is otherwise clean of. A 404 is also the
    // honest answer for a test that wants no network.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url).startsWith("/cities/")
          ? Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
          : Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ available: true, results: [] }),
            })
      )
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("stays silent until something is typed", () => {
    setup();

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
  });

  test("opens a listbox and points aria-activedescendant at the first option", () => {
    const { input } = setup();

    fireEvent.change(input, { target: { value: "ha" } });

    expect(input).toHaveAttribute("aria-expanded", "true");
    // Two curated matches plus the off-map row.
    expect(optionTexts()).toHaveLength(3);
    expect(activeOptionText()).toContain("Hangzhou");
  });

  test("ArrowDown and ArrowUp move the active option", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "ha" } });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeOptionText()).toContain("Harbin");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(activeOptionText()).toContain("Hangzhou");
  });

  test("ArrowUp from the first option wraps to the last", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "ha" } });

    fireEvent.keyDown(input, { key: "ArrowUp" });

    // The last row is always the off-map offer.
    expect(activeOptionText()).toContain("as its own place");
  });

  test("Enter adds the active place and clears the query", () => {
    const { input, onAdd } = setup();
    fireEvent.change(input, { target: { value: "ha" } });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({ id: "harbin", name: "Harbin", kind: "curated" });
    expect(input).toHaveValue("");
  });

  test("returns focus to the input after adding by mouse", () => {
    // Asserted on the mouse path, not the Enter path: pressing Enter never moves
    // focus in the first place, so asserting it there passes even with the
    // focus() call deleted — verified by probe. Clicking is where the call earns
    // its place, and it is what lets someone alternate mouse and keyboard.
    const { input, onAdd } = setup();
    fireEvent.change(input, { target: { value: "ha" } });
    input.blur();
    expect(input).not.toHaveFocus();

    fireEvent.mouseDown(screen.getAllByRole("option")[0]);

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(input).toHaveFocus();
  });

  test("carries coordinates for a curated pick and null for an off-map one", () => {
    const { input, onAdd } = setup();

    fireEvent.change(input, { target: { value: "hangzhou" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd.mock.calls[0][0]).toMatchObject({ lat: 30.25, lon: 120.16, country: "CN" });

    fireEvent.change(input, { target: { value: "Grandma's village" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Spec §5.6: hand-typed places have no location attached.
    expect(onAdd.mock.calls[1][0]).toMatchObject({
      kind: "off-map",
      name: "Grandma's village",
      lat: null,
      lon: null,
    });
  });

  test("Escape clears the query without adding anything", () => {
    const { input, onAdd } = setup();
    fireEvent.change(input, { target: { value: "ha" } });

    fireEvent.keyDown(input, { key: "Escape" });

    expect(input).toHaveValue("");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(onAdd).not.toHaveBeenCalled();
  });

  test("refuses to add a place that is already selected", () => {
    const { input, onAdd } = setup([
      { id: "hangzhou", name: "Hangzhou", kind: "curated", lat: 30.25, lon: 120.16, localName: "杭州", province: null, description: null, country: "CN" },
    ]);
    fireEvent.change(input, { target: { value: "hangzhou" } });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).not.toHaveBeenCalled();
    // Flagged, not hidden — a place that vanished on being added reads as a bug.
    expect(optionTexts()[0]).toContain("added");
  });

  test("removes a selected place through its own control", () => {
    const { onRemove } = setup([
      { id: "harbin", name: "Harbin", kind: "curated", lat: 45.8, lon: 126.5, localName: null, province: null, description: null, country: "CN" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Harbin" }));

    expect(onRemove).toHaveBeenCalledWith("harbin");
  });

  test("Enter with no results does nothing", () => {
    const { input, onAdd } = setup();

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe("PlaceSearch country scoping", () => {
  const NANJING = { qid: "Q16666", name: "Nanjing", localName: "南京", province: "Jiangsu" };

  /** Two real rows, lifted verbatim from the committed public/cities/PE.json. */
  const PE_SHARD = {
    country: "PE",
    generatedAt: "2026-08-25",
    source: "GeoNames cities500 (CC BY 4.0)",
    cities: [
      { id: "G3936456", n: "Lima", lat: -12.04318, lon: -77.02824, a1: "Lima Province", p: 7_737_002, tz: "America/Lima" },
      { id: "G3941584", n: "Cusco", lat: -13.53188, lon: -71.96701, a1: "Cuzco Department", p: 428_450, tz: "America/Lima" },
    ],
  };

  /**
   * The same city as both legs hold it: `data/catalog.json`'s Q57947 and
   * `public/cities/CN.json`'s G1799722, verbatim. Same folded name, same
   * province label, 5.4 km apart — one city, two rows.
   */
  const NANTONG_HIT = { qid: "Q57947", name: "Nantong", localName: "南通市", province: "Jiangsu" };
  const CN_NANTONG_SHARD = {
    country: "CN",
    generatedAt: "2026-08-25",
    source: "GeoNames cities500 (CC BY 4.0)",
    cities: [
      { id: "G1799722", n: "Nantong", lat: 32.03028, lon: 120.87472, a1: "Jiangsu", p: 2_273_326, tz: "Asia/Shanghai" },
    ],
  };

  /**
   * Two different cities that share a name, likewise verbatim from both
   * sources: Q1022251 sits in Changchun and G1281105 in Qinghai, 2,852 km
   * apart. The name matches; the province is what tells them apart.
   */
  const YUSHU_HIT = { qid: "Q1022251", name: "Yushu", localName: "榆树市", province: "Changchun" };
  const CN_YUSHU_SHARD = {
    country: "CN",
    generatedAt: "2026-08-25",
    source: "GeoNames cities500 (CC BY 4.0)",
    cities: [
      { id: "G1281105", n: "Yushu", lat: 33.00118, lon: 97.00893, a1: "Qinghai", p: 141_308, tz: "Asia/Shanghai" },
    ],
  };

  /** Likewise from public/cities/JP.json — the second country in the switch test. */
  const JP_SHARD = {
    country: "JP",
    generatedAt: "2026-08-25",
    source: "GeoNames cities500 (CC BY 4.0)",
    cities: [
      { id: "G1857910", n: "Kyoto", lat: 35.02107, lon: 135.75385, a1: "Kyoto", p: 1_463_723, tz: "Asia/Tokyo" },
    ],
  };

  /**
   * Dispatches on the URL, because the component now has two legs — the
   * country-scoped API call and the static shard — and a single-answer mock
   * would let either one masquerade as the other.
   *
   * Fixture invariant (spec §6), and it is enforced rather than asserted in
   * prose: the shard states `country: "PE"` and `fetchCityShard` passes the
   * requested country into `parseCityShard`, so a fixture whose envelope
   * disagreed with its URL would throw here rather than quietly draw the wrong
   * country's cities.
   */
  function stubFetch(shard: unknown, results: unknown[] = [NANJING]) {
    const mock = vi.fn((url: string) =>
      String(url).startsWith("/cities/")
        ? Promise.resolve({ ok: true, status: 200, json: async () => shard })
        : Promise.resolve({ ok: true, status: 200, json: async () => ({ available: true, results }) })
    );
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("asks the catalog route for whichever country is open", async () => {
    const mock = stubFetch(PE_SHARD, []);
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="PE" onAdd={vi.fn()} onRemove={vi.fn()} />
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cusc" } });
    await pastDebounce();

    // The whole URL, not merely "a fetch happened". `searchCities` fails
    // *closed* on a missing country, so dropping `&country=` would still
    // answer 200 with an empty result set — indistinguishable from a country
    // that genuinely has no catalog cities, with no error anywhere.
    const urls = mock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u === "/api/destinations?q=cusc&country=PE")).toBe(true);
  });

  test("fetches the open country's shard once, not per keystroke", async () => {
    // Keyed on the country, not the query: the rows arrive once and every
    // keystroke searches them in memory.
    const mock = stubFetch(PE_SHARD, []);
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="PE" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cu" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cus" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cusc" } });
    await pastDebounce();

    const shardCalls = mock.mock.calls.filter((c) => String(c[0]) === "/cities/PE.json");
    expect(shardCalls).toHaveLength(1);
  });

  test("offers a Peruvian city while planning Peru", async () => {
    // The gate this task deletes: with the China-only allowlist in place,
    // planning anywhere but China offered nothing but the off-map row.
    stubFetch(PE_SHARD, []);
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="PE" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cusc" } });
    await pastDebounce();

    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Cusco");
    // Carried straight off the shard row, so a cross-wired field is visible:
    // Cusco's admin-1 is "Cuzco Department" and Lima's is "Lima Province".
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Cuzco Department");
  });

  test("adds a shard city under its GeoNames id", async () => {
    // The id is what `/api/destinations/resolve` receives, and the G prefix is
    // the whole of what keeps it out of Wikidata's namespace (§3.3).
    stubFetch(PE_SHARD, []);
    const onAdd = vi.fn();
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="PE" onAdd={onAdd} onRemove={vi.fn()} />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cusc" } });
    await pastDebounce();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      id: "G3941584",
      name: "Cusco",
      kind: "catalog",
      country: "PE",
      // The admin-1 the row displayed, carried into the pick rather than
      // dropped. `app/plan/page.tsx` keys `extras` by qid with last-write-wins
      // and `MapExplorer.togglePlace` writes the same city with its province
      // filled in, so nulling it here made the same Cusco two different shapes
      // depending on which surface added it — and let a re-pick through search
      // silently downgrade what the map had stored. Cusco's is "Cuzco
      // Department" and Lima's is "Lima Province", so a cross-wire is visible.
      localName: null,
      province: "Cuzco Department",
    });
  });

  test("offers one row, not two, for a city both catalog legs answer with", async () => {
    // China is the only country where both legs answer, and they overlap:
    // measured against the committed data/catalog.json and
    // public/cities/CN.json, 54 shard rows carry a name the catalog also has.
    // `rankPlaces` dedupes catalog-against-curated and never
    // catalog-against-catalog, so nothing but `shardHits` catches this.
    //
    // Both rows are real and verbatim: Q57947 from data/catalog.json and
    // G1799722 from public/cities/CN.json, 5.4 km apart under one province
    // label. A duplicate here is not a display wart — app/plan/page.tsx
    // dedupes `selected` by id, and data/cities-index.json resolves
    // G1799722, so a trip can carry Nantong twice with two day allocations.
    stubFetch(CN_NANTONG_SHARD, [NANTONG_HIT]);
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="CN" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "nant" } });
    await pastDebounce();

    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options.filter((t) => t.includes("Nantong"))).toHaveLength(1);
    // And it is the Wikidata row that survives — the one carrying a local
    // name, a researched description and an attraction count.
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("南通市");
  });

  test("keeps two same-name cities that sit in different provinces", async () => {
    // The overcorrection this guards against. Deduping on the folded name
    // alone would hide one of these: measured, the collisions above make 55
    // name-pairs and 40 of them are genuinely different Chinese cities, 32
    // more than 100 km apart. Both rows here are real — Q1022251 (Yushu,
    // Changchun) and G1281105 (Yushu, Qinghai) — and they are 2,852 km apart,
    // the widest pair in the data.
    //
    // This also carries the ordering assertion the duplicate test above used
    // to hold: `rankPlaces` breaks a score tie by input index, and the
    // Wikidata leg goes in first.
    stubFetch(CN_YUSHU_SHARD, [YUSHU_HIT]);
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="CN" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "yush" } });
    await pastDebounce();

    const options = screen.getAllByRole("option");
    expect(options.filter((o) => (o.textContent ?? "").includes("Yushu"))).toHaveLength(2);
    // Pinned from both ends: the shard row is second, and it is second because
    // it went in second — not because the Wikidata leg answered with nothing.
    expect(options[0]).toHaveTextContent("榆树市");
    expect(options[1]).toHaveTextContent("Qinghai");
    expect(options[1]).not.toHaveTextContent("榆树市");
  });

  test("drops the previous country's cities the moment the country changes", async () => {
    // Cleared up front rather than on arrival, the same reason MapExplorer's
    // airports effect clears first: for the interim between a country switch
    // and the new shard landing, the old country's cities are wrong answers,
    // not stale ones.
    stubFetch(PE_SHARD, []);
    const { rerender } = render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="PE" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cusc" } });
    await pastDebounce();
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Cusco");

    stubFetch(JP_SHARD, []);
    rerender(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="JP" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    // Only the off-map row survives: Peru's city is gone even though the query
    // still spells it.
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("as its own place");

    // The other direction, and the reason the JP fixture holds a real city
    // rather than an empty array: an assertion that only the off-map row
    // survives passes just as well when the shard leg has died altogether.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "kyot" } });
    await pastDebounce();
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Kyoto");
  });

  test("clears the previous country's cities before the new shard lands", async () => {
    // The `clear()` at the top of the shard effect, not the one in `catch`.
    // The test above cannot reach it: there the JP shard answers, so the
    // assignment on arrival hides whether anything cleared first. Probed —
    // deleting the up-front clear leaves every other test in this file green.
    //
    // With the second shard still in flight there is a real window in which
    // the component holds Peru's rows under a Japan scope, and in that window
    // they are wrong answers rather than stale ones.
    stubFetch(PE_SHARD, []);
    const { rerender } = render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="PE" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cusc" } });
    await pastDebounce();
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Cusco");

    // A shard request that never answers, so the switch is observed mid-flight.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url).startsWith("/cities/")
          ? new Promise(() => {})
          : Promise.resolve({ ok: true, status: 200, json: async () => ({ available: true, results: [] }) })
      )
    );
    rerender(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="JP" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("as its own place");
  });

  test("clears the previous country's Wikidata hits the instant the country changes", async () => {
    // The `hits` counterpart of the test above, and the gap Task 13 opened:
    // the deleted China-only allowlist cleared `hits` synchronously on any
    // switch away from CN, and nothing replaced it. Every catalog row is
    // Chinese (`LEGACY_CATALOG_COUNTRY`), so a surviving hit under a Japanese
    // scope is always a Chinese city offered for a Japanese trip — first in
    // the list and keyboard-addable.
    //
    // Nanjing is deliberately not Beijing: `searchCities` filters curated
    // names out of the catalog leg, so a curated city could never be here.
    // The CN shard holds Nantong, which does not match "nanj" — whatever this
    // asserts is about `hits` and not about the shard.
    stubFetch(CN_NANTONG_SHARD, [NANJING]);
    const { rerender } = render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="CN" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "nanj" } });
    await pastDebounce();
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("南京");

    // Both legs hang, so the switch is observed mid-flight — the same shape as
    // the shard test above. A user who never gets an answer must still not be
    // left holding the previous country's cities.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    rerender(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="JP" onAdd={vi.fn()} onRemove={vi.fn()} />
    );

    // Asserted before `pastDebounce()`: the clear has to be synchronous with
    // the switch, not something the next response happens to overwrite.
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("as its own place");
  });

  test("ignores a one-character query rather than filling the list from the shard", async () => {
    // `MIN_QUERY` guards the shard filter as well as the API call, and every
    // other test in this file types at least two characters, so deleting that
    // guard left the suite green. Peru's committed shard has 750 rows and 393
    // of them fold-match "c"; the picker would answer a single keystroke with
    // ten cities ordered by population.
    stubFetch(PE_SHARD, []);
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="PE" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "c" } });
    await pastDebounce();

    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options.some((t) => t.includes("Cusco"))).toBe(false);
    // Only the off-map offer, which is what one character is worth.
    expect(options).toHaveLength(1);
  });

  test("ranks a prefix match the population cap would have cut", async () => {
    // `SHARD_CANDIDATES` is a bound on work, and this pins that it is not also
    // a bound on the answer. The shard is population-ordered — "display
    // order, never score order" (lib/cityShard.ts) — so a single list
    // truncated at 60 drops rows the ranker would have scored above the ones
    // it keeps: `rankPlaces` scores a prefix match 100 and a substring match
    // 80. Measured over all 246 committed shards and every 2-6 character
    // prefix in them (175,814 queries), that changed the visible top ten 409
    // times and row one 64 times.
    //
    // Synthetic, and it has to be: no committed shard puts 60 more-populous
    // substring matches ahead of a prefix match for a short query, which is
    // exactly why the real fixtures could not observe the cap.
    const substringMatches = Array.from({ length: SHARD_CANDIDATES }, (_, i) => ({
      id: `G${3_000_001 + i}`,
      n: `Cordoba ${i + 1}`,
      lat: -31.4,
      lon: -64.18,
      a1: "Cordoba",
      p: 600_000 - i,
      tz: "America/Argentina/Cordoba",
    }));
    stubFetch(
      {
        country: "AR",
        generatedAt: "2026-08-25",
        source: "GeoNames cities500 (CC BY 4.0)",
        cities: [
          ...substringMatches,
          // Last in the file, so a population-ordered cut never reaches it —
          // and the only prefix match in the shard.
          { id: "G3838233", n: "Ortiz", lat: -33.5, lon: -60.6, a1: "Santa Fe", p: 1_000, tz: "America/Argentina/Cordoba" },
        ],
      },
      []
    );
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="AR" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "or" } });
    await pastDebounce();

    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Ortiz");
  });

  test("does not re-offer a place a curated card already covers", async () => {
    // Yangshuo has no data/catalog.json row, so the ingest's dedup would keep
    // it if it reached the CN shard — while "Guilin & Yangshuo" is a curated
    // card that already plans three days there. Without `curatedPlaceNames`
    // the picker offers both, which is the duplication §3.3's dedup exists to
    // remove. `rankPlaces` does not dedupe by name across kinds, so this is
    // the only thing that catches it.
    //
    // The fixture is deliberately not a claim about the committed CN.json:
    // measured, Yangshuo is absent from its 413 rows today. It is a shard the
    // nightly refresh-cities.yml could produce tomorrow, which is exactly what
    // `ACTIVITY_COVERED.CN` is held open for.
    stubFetch(
      {
        country: "CN",
        generatedAt: "x",
        source: "y",
        cities: [
          { id: "G1787746", n: "Yangshuo", lat: 24.77, lon: 110.49, a1: "Guangxi", p: 30_000, tz: "Asia/Shanghai" },
        ],
      },
      []
    );
    render(
      <PlaceSearch
        curated={[{ id: "guilin", name: "Guilin & Yangshuo", localName: "桂林", knownFor: [] }]}
        coordsFor={() => null}
        selected={[]}
        country="CN"
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "yangshuo" } });
    await pastDebounce();

    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options.filter((t) => t.includes("Yangshuo"))).toHaveLength(1);
    expect(options[0]).toContain("Guilin & Yangshuo");
  });

  test("suppresses only the open country's curated names", async () => {
    // The other half of the suppression, and the one a CN-only fixture cannot
    // state: `curatedPlaceNames` is keyed by country, so the very same shard
    // row is offered when the country in scope is not the one whose curated
    // set claims the name. Without the key, a global blocklist would hide a
    // Peruvian Yangshuo with no way to notice.
    stubFetch(
      {
        country: "PE",
        generatedAt: "x",
        source: "y",
        cities: [
          { id: "G1787746", n: "Yangshuo", lat: -13.5, lon: -71.9, a1: "Cuzco Department", p: 30_000, tz: "America/Lima" },
        ],
      },
      []
    );
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="PE" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "yangshuo" } });
    await pastDebounce();

    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Yangshuo");
  });

  test("keeps working when a country has no shard at all", async () => {
    // 246 of ~250 codes have one; the rest 404, and a 404 behind the login
    // wall arrives as login HTML that `res.json()` rejects on. Either way the
    // off-map row is still the guaranteed path to a place.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url).startsWith("/cities/")
          ? Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
          : Promise.resolve({ ok: true, status: 200, json: async () => ({ available: true, results: [] }) })
      )
    );
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="AQ" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "somewhere" } });
    await pastDebounce();

    expect(screen.getByRole("option")).toHaveTextContent("as its own place");
  });
});
