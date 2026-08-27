import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PlanStep } from "@/components/PlanStep";
import { BriefingView } from "@/components/trip/BriefingView";
import { PackingSection } from "@/components/trip/PackingSection";
import { PlanTab } from "@/components/trip/PlanTab";
import { buildBriefing, type Briefing } from "@/lib/briefing";
import { chinaLeaks, peruMisses } from "@/lib/chinaLeakScan";
import type { TripInput } from "@/lib/itinerary";
import { NEUTRAL_TRAVEL_EMOJI, RAIL_TRAVEL_EMOJI } from "@/lib/meta";
import { resolveDestinations } from "@/lib/server/catalog";
import { buildTripData } from "@/lib/server/planService";
import { resolveTripSeason } from "@/lib/tripSeason";
import type { TripData, TripPayload } from "@/lib/tripShared";
import type { Destination } from "@/lib/types";

/**
 * T30 — the Peru acceptance gate, jsdom half.
 *
 * `lib/worldwidePlan.test.ts` proves the *generators* produce nothing Chinese
 * for Peru. This proves the same of what a person actually sees, over the three
 * surfaces the country's guidance is drawn on — which are, not by coincidence,
 * the three `components/plan/GapNote.tsx` names in its own docblock:
 *
 *   1. `components/PlanStep.tsx`   — the wizard's plan preview.
 *   2. `components/trip/PlanTab.tsx` (+ `PackingSection`) — the saved trip.
 *   3. `components/trip/BriefingView.tsx` — the **unauthenticated** briefing.
 *
 * **Why the third one has no test of its own under `app/`.** The public page is
 * `app/b/[code]/page.tsx`, and `vitest.config.mts` includes nothing under
 * `app/` — a test file placed there would sit on disk and never run. That page
 * does exactly two things worth testing: it calls
 * `buildBriefing(payload, { redacted: true, includeBookings })` and hands the
 * result to `<BriefingView>`. Both halves are exercised here, with the same
 * redacted options, so the surface is covered by its two real parts rather than
 * by a file that could not execute.
 *
 * **What is scanned is `innerHTML`, not `textContent`.** It is a strict
 * superset: it catches copy that lives in an `aria-label`, a `title` or an
 * `alt` as well as copy a sighted user reads. Nothing in the class names or the
 * CSS variables this app uses contains a China marker, so the extra surface
 * costs no false positives.
 *
 * **Everything expensive is built once, at module scope.** Resolving GeoNames
 * cities parses a 58,742-row index; done inside a `test` that cost lands in
 * that test's wall-clock budget and flakes under parallel load (commit
 * 84cd61e). Each `test` below renders and scans, and nothing more.
 */

/** `ShareTripCard` calls `useRouter`, which jsdom has no provider for. */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/** Lima, Cusco, Arequipa — ids and coordinates from `public/cities/PE.json`. */
const PERU_CITY_IDS = ["G3936456", "G3941584", "G3947322"];
const CHINA_CITY_IDS = ["beijing", "xian", "shanghai"];
const JUNE = 6;

interface Assembled {
  input: TripInput;
  destinations: Destination[];
  data: TripData;
  briefing: Briefing;
}

/**
 * The same assembly the node half runs, through the same production functions:
 * `resolveDestinations` → `buildTripData` → `buildBriefing`. Duplicated across
 * the two files rather than shared, because they run in different vitest
 * projects and importing one suite from the other re-runs its `describe` blocks
 * — the hazard `lib/tripFixtures.ts` documents. What the two files must NOT
 * duplicate is the scan, and they do not: both import `lib/chinaLeakScan.ts`.
 */
function assemble(country: string, ids: string[]): Assembled {
  const season = resolveTripSeason("summer", JUNE, country);
  const input: TripInput = {
    destinationIds: ids,
    days: 10,
    season,
    adults: 2,
    kids: 1,
    interests: ["history", "food", "nature"],
    country,
  };
  const destinations = resolveDestinations(ids);
  const data = buildTripData({
    tripName: `${destinations[0]?.name ?? country} trip`,
    startDate: "2026-06-05",
    input,
  });
  const payload: TripPayload = {
    id: "trip-t30",
    version: 1,
    updatedAt: 0,
    data,
    members: [{ name: "Ada", joinedAt: 1 }],
    checks: [],
    tickets: [],
    expenses: [],
    settlements: [],
    journal: [],
    currencySettings: { home: "SGD", rates: {} },
    features: { photoUploads: false },
    joinCode: "SECRET",
  };
  const briefing = buildBriefing(payload, { redacted: true, includeBookings: false });
  return { input, destinations, data, briefing };
}

const peru = assemble("PE", PERU_CITY_IDS);
const china = assemble("CN", CHINA_CITY_IDS);

function renderWizard(trip: Assembled): string {
  const { container } = render(
    <PlanStep input={trip.input} extraDestinations={trip.destinations} month={JUNE} />
  );
  return container.innerHTML;
}

function renderTripPage(trip: Assembled): string {
  const { container } = render(
    <>
      <PlanTab
        plan={trip.data.plan}
        startDate="2026-06-05"
        country={trip.input.country ?? "CN"}
        season={trip.input.season}
        tickets={[]}
        checkedBy={new Map()}
        isMember
        todayIndex={null}
        onToggle={() => {}}
        onPlanOp={async () => null}
      />
      <PackingSection
        packing={trip.data.packing}
        checkedBy={new Map()}
        isMember
        onToggle={() => {}}
      />
    </>
  );
  return container.innerHTML;
}

function renderBriefing(trip: Assembled): string {
  const { container } = render(<BriefingView briefing={trip.briefing} />);
  return container.innerHTML;
}

afterEach(cleanup);

/**
 * FINDING 1 (T30), fixed — the render-time rail glyph, on every country.
 *
 * `lib/meta.ts`'s `KIND_EMOJI.travel` was `"🚄"`, stamped on every `kind:
 * "travel"` itinerary item by all three renderers (`PlanStep`'s `PlanItem`,
 * `DayCard`, `BriefingView`'s `DayPanel`). It was not country-aware, so a
 * Peruvian hop whose *title* is the neutral "Travel to Cusco" was drawn with a
 * Chinese high-speed-train glyph — on the unauthenticated briefing included.
 *
 * **This is the seam this gate exists to find, and the reason it had to be a
 * RENDER test.** The generated plan was always clean: `lib/worldwidePlan.test.ts`
 * scans the same trip's data and reports nothing, because the glyph does not
 * exist until render. Every data-layer suite in the phase was blind to it, and
 * so was the design — it asserts "Zero 🚄 anywhere" for Peru while no task in
 * T20–T32 touched `lib/meta.ts`. Nothing but a scan of `innerHTML` could have
 * caught it, which is what the three `chinaLeaks(render…)` pins below are.
 *
 * The glyph now comes from `travelEmoji(railKmh)`: `🚄` where a country has a
 * researched rail speed, `🧭` where it has none. Not `✈️` — the resolution is
 * per country, not per leg, so a plane would be the same unsourced claim
 * reversed. Both glyphs are asserted in both directions below: a Peru surface
 * must show the neutral one and never the rail one, a China surface the
 * reverse. Without the positive halves of those pairs, "no 🚄 on the Peru page"
 * would also be satisfied by rendering no hop at all.
 */
const RAIL_GLYPH = RAIL_TRAVEL_EMOJI;
const NEUTRAL_GLYPH = NEUTRAL_TRAVEL_EMOJI;

/**
 * `innerHTML` with the tags taken out, so a glyph can be pinned NEXT TO the hop
 * it belongs to rather than merely somewhere on the page.
 *
 * Each renderer wraps the glyph differently — `PlanStep` and `DayCard` emit
 * `<span aria-hidden>… </span>` before the title, `BriefingView` puts both in
 * one span — so the raw markup has no shared substring to match. Stripping tags
 * leaves the one thing all three agree on: "<glyph> <title>".
 *
 * This is not fussiness. `🧳` was the first choice for the neutral glyph and it
 * is ALSO the wizard's travellers chip ("🧳 2 adults + 1 kid"), which would have
 * made a bare `toContain` pass on a page that drew no hop at all — an arming
 * assertion that armed nothing.
 */
function hopLine(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * FINDING 2 (T30), resolved by T31 — the wizard's static China branding.
 *
 * `components/PlanStep.tsx` used to render three literals that were about
 * China rather than about the trip: the `启程` chop on the boarding-pass
 * header, the headline "Your China itinerary", and `一起走` in the
 * share-a-trip card. A Peru traveller saw all three.
 *
 * **T31 fixed the first two**, wiring both through `getCountry(...)` — the
 * same accessor `TripView.tsx` already used for its own hero. That resolves
 * the self-contradiction this finding originally flagged: the design's own
 * T31 test story claimed `启程` would still appear for CN after the fix, but
 * `getCountry("CN").mark` is `同行`, not `启程` — they are two different
 * chops that happened to occupy the same spot in two different components.
 * `TripView.tsx`'s docblock is explicit that `同行` is the mark every
 * mark-bearing country (CN included) is meant to show, so T31 took
 * consistency with `TripView` over the stale test-story wording. CN's wizard
 * chop changing from `启程` to `同行` is the one deliberate change to China's
 * rendered output this task makes — see the arming test below.
 *
 * `一起走` in the share-a-trip card is still not on T31's file:line list and
 * remains unowned. It is the one entry left below.
 */
const UNOWNED_SHARE_CARD_CJK = ["一", "起", "走"];

describe("T30 jsdom — the trip that gets rendered", () => {
  test("is a real Peru trip, or every scan below is vacuous", () => {
    expect(peru.destinations.map((d) => d.name)).toEqual(["Lima", "Cusco", "Arequipa"]);
    expect(peru.input.season).toBe("winter");
    expect(peru.input.kids).toBeGreaterThan(0);
    expect(peru.data.plan.days).toHaveLength(10);
    expect(peru.data.plan.tips.length).toBeGreaterThan(0);
    expect(peru.briefing.gapNote).toHaveLength(1);
  });

  test("and the China trip it is armed against is one too", () => {
    expect(china.destinations.map((d) => d.name)).toEqual(["Beijing", "Xi'an", "Shanghai"]);
    expect(china.data.plan.days).toHaveLength(10);
    expect(china.briefing.gapNote).toEqual([]);
  });
});

/**
 * The negative half, per surface, pinned with `toEqual` rather than filtered.
 *
 * Every assertion below states the COMPLETE set of China markers a Peru
 * traveller can see on that surface. Two of the three are non-empty today, and
 * naming the exact set is what keeps that from being a hole: a new leak reddens
 * these, and so does either finding above being fixed — at which point the
 * expectation shrinks to `[]` and the constant is deleted. An exclusion that
 * only ever shrinks is a gate; one that forgives a category is not.
 */
describe("T30 jsdom — the negative half", () => {
  test("the saved trip's plan and packing are clean", () => {
    expect(chinaLeaks(renderTripPage(peru))).toEqual([]);
    // Armed: the page really drew a hop, and drew it with the glyph a country
    // that has no researched rail speed earns. Without this the empty scan
    // above is equally satisfied by a page that rendered no travel item.
    expect(hopLine(renderTripPage(peru))).toContain(`${NEUTRAL_GLYPH} Travel to Cusco`);
  });

  test("the unauthenticated briefing is clean", () => {
    // `plan.tips` reaches a bearer-link holder here, with no login in front of
    // it. This is the surface the phase's honesty rule matters most on — and it
    // is where a Chinese train used to be drawn over a Peruvian hop.
    expect(chinaLeaks(renderBriefing(peru))).toEqual([]);
    expect(hopLine(renderBriefing(peru))).toContain(`${NEUTRAL_GLYPH} Travel to Cusco`);
  });

  test("the wizard leaks only the unowned share-card CJK, and nothing else", () => {
    // Post-fix: no token matches at all. `chinaLeaks` reports CHINA_TOKENS
    // first and CJK codepoints after them, so an empty token half in front of
    // these three is the whole claim — "China" and 启/程 went with T31, 🚄 with
    // the country-aware glyph. `一起走` is `ShareTripCard`'s, on no task's
    // file list; see the constant's docblock.
    expect(chinaLeaks(renderWizard(peru))).toEqual(["一", "起", "走"]);
    // Spelled out above, and cross-checked against the constant here, so the
    // two cannot drift and the constant's docblock stays the explanation.
    expect(chinaLeaks(renderWizard(peru))).toEqual(UNOWNED_SHARE_CARD_CJK);
    // Armed the same way as the other two surfaces.
    expect(hopLine(renderWizard(peru))).toContain(`${NEUTRAL_GLYPH} Travel to Cusco`);
    // T31's arming proof, direction one: a country with no curated mark shows
    // no chop at all — neither China's old hardcoded one nor any other.
    expect(renderWizard(peru)).not.toContain("启程");
    expect(renderWizard(peru)).not.toContain("同行");
    expect(renderWizard(peru)).not.toContain("China");
  });

  /**
   * The headline, which no China-token scan can see.
   *
   * "Your PE itinerary" contains no Chinese marker and omits no Peru fact, so
   * both halves of this gate passed over it in silence. It is here because it
   * is the same class of defect as the glyph — a render-only string naming the
   * wrong thing — and the only instrument that catches it is an assertion about
   * what the page actually says.
   */
  test("the wizard headline names Peru, not its ISO code", () => {
    const wizard = renderWizard(peru);
    expect(wizard).toContain("Your Peru itinerary");
    expect(wizard).not.toContain("Your PE itinerary");
    // Armed from the other side. CN is one of lib/countries.ts's 24 curated
    // names AND is in the facts artifact, so China reads the same either way —
    // which is the point: the fix moved the source without moving China's copy.
    expect(renderWizard(china)).toContain("Your China itinerary");
  });

  test("everything the generators produced is clean — the leaks are render-only", () => {
    // The seam, stated as an assertion. The plan, packing, tips and gap note
    // this page was handed carry no marker at all; the glyph is added by the
    // renderer, which is why no data-layer suite in the phase can see it.
    expect(chinaLeaks(JSON.stringify(peru.data))).toEqual([]);
    expect(chinaLeaks(JSON.stringify(peru.briefing))).toEqual([]);
    // And the item the glyph is stamped on is a travel hop with neutral copy.
    const hop = peru.data.plan.days
      .flatMap((d) => d.items)
      .find((i) => i.kind === "travel");
    expect(hop?.title).toBe("Travel to Cusco");
    expect(hop?.note).toBeUndefined();
    // Both glyphs stay render-only. The persisted plan carries neither, so a
    // regression can only ever come back through a renderer — which is why
    // this file, and not a data-layer suite, is where they are pinned.
    expect(JSON.stringify(peru.data)).not.toContain(NEUTRAL_GLYPH);
    expect(JSON.stringify(peru.data)).not.toContain(RAIL_GLYPH);
  });

  /**
   * The three surfaces render real documents, or every `toEqual([])` above is
   * satisfied by a blank string.
   *
   * `peruMisses` covers this from the positive side, but only for Peru facts.
   * This is the cheap direct guard, and it is the one that reddens if a render
   * helper is ever wired to return "" — the mutation an exclusion-shaped gate
   * is least able to see.
   */
  test("the scanned surfaces are real renders, not empty strings", () => {
    for (const html of [renderWizard(peru), renderTripPage(peru), renderBriefing(peru)]) {
      expect(html.length).toBeGreaterThan(2000);
      expect(html).toContain("Cusco");
    }
  });

  test("the hop glyph is the travel item's, not something structural", () => {
    // If either glyph appears on a surface with no travel item, it came from
    // somewhere else and the pins above are measuring the wrong thing.
    const noHops = { ...peru.briefing, days: peru.briefing.days.slice(0, 1) };
    expect(noHops.days[0].items.every((i) => i.kind !== "travel")).toBe(true);
    const html = renderBriefing({ ...peru, briefing: noHops });
    expect(chinaLeaks(html)).toEqual([]);
    expect(html).not.toContain(NEUTRAL_GLYPH);
    expect(html).not.toContain(RAIL_GLYPH);
  });
});

/**
 * FINDING 3 (T31b) — the leak that gets WRITTEN DOWN.
 *
 * `ShareTripCard` defaulted a cleared trip-name field to the literal
 * `"China trip"` and pre-filled the field with `${destinationNames[0] ??
 * "China"} trip`. Everything else this file scans is a render, and a render is
 * fixed the moment the code is: a Peru trip created with the blank field went
 * to `/api/trips`, into the trips table, onto the dashboard, onto the trip page
 * and into every share link — under China's name, permanently. It is the only
 * finding in the phase that survives its own fix.
 *
 * No scan above could see it. `renderWizard` reads `container.innerHTML`, and
 * a controlled `<input value>` is a DOM property React assigns, not markup —
 * so the string never appeared in any scanned surface, and the POST body it
 * ends up in is not rendered at all. The only instrument that catches it is
 * driving the button and reading what went on the wire, which is what
 * `shareCardNames` does.
 *
 * Both the pre-fill and the blank-field fallback are checked, because they were
 * two separate literals and only fixing the louder one leaves the other.
 */
/**
 * A wizard that resolved no destination at all — the resolve-miss branch.
 *
 * Both halves matter. `extraDestinations: []` is not enough on its own: the
 * curated `lib/data` list is merged in ahead of it, so China's `"beijing"` id
 * still resolves and would quietly send this down the first-city branch
 * instead. An id nothing carries is what makes the fallback the thing measured
 * — and it makes the Peru and China cases the same shape, rather than Peru's
 * passing by the accident of GeoNames ids being absent from the curated list.
 */
const UNRESOLVED_IDS = ["G0000000"];

function unresolved(tripInput: TripInput): TripInput {
  return { ...tripInput, destinationIds: UNRESOLVED_IDS };
}

interface ShareCardNames {
  /** What the field says before anyone touches it. */
  prefilled: string;
  /** What `/api/trips` is asked to persist. The one that outlives the fix. */
  posted: string;
}

/**
 * Render the wizard, put `typed` in the trip-name field, press the button, and
 * report both names.
 *
 * **The fetch stub never settles, deliberately.** `create()` awaits it and
 * stops there, so no state update lands outside React's `act()` — this needs
 * no `waitFor`, no fake timers and no polling, and so cannot contribute the
 * kind of timing-sensitive test commit 84cd61e had to repair. The request body
 * is captured synchronously when the click handler calls `fetch`, which is
 * everything the assertions below read.
 *
 * `extraDestinations: []` is not a contrived input: `goToPlan` in
 * `app/plan/page.tsx` advances to step 2 on any `res.ok`, so a resolve that
 * comes back with nothing lands a real traveller on exactly this page — and
 * that is the branch where the old code said "China".
 */
function shareCardNames(
  tripInput: TripInput,
  extraDestinations: Destination[],
  typed: string
): ShareCardNames {
  const fetchMock = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetchMock);
  try {
    // Scoped to THIS render's container, not to `document.body`, which is what
    // `render`'s own bound queries search. `cleanup` runs between tests, not
    // between two renders inside one — and a test that names a Peru trip and a
    // China trip in the same breath is exactly what this file wants to write.
    const { container } = render(
      <PlanStep input={tripInput} extraDestinations={extraDestinations} month={JUNE} />
    );
    const card = within(container);
    const field = card.getByLabelText(/Trip name/) as HTMLInputElement;
    const prefilled = field.value;
    fireEvent.change(field, { target: { value: typed } });
    fireEvent.click(card.getByRole("button", { name: /Start shared trip/ }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    // Armed: this is the trip-creation write path and not some other request.
    expect(url).toBe("/api/trips");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as { tripName: string };
    return { prefilled, posted: body.tripName };
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("T30 jsdom — the name the trip is SAVED under", () => {
  test("a blank-name Peru trip is never persisted as a China trip", () => {
    // Whitespace, not "": `.trim() ||` is what makes a space-only field take
    // the fallback, and a bare "" would not exercise it.
    const names = shareCardNames(peru.input, peru.destinations, "   ");
    expect(chinaLeaks(names.posted)).toEqual([]);
    expect(chinaLeaks(names.prefilled)).toEqual([]);
    // The most specific true thing the wizard knows.
    expect(names.posted).toBe("Lima trip");
    expect(names.prefilled).toBe("Lima trip");
  });

  test("with no destination resolved it names the country, not China", () => {
    // The branch the old `destinationNames[0] ?? "China"` covered, and the one
    // a `/api/destinations/resolve` miss actually reaches.
    const names = shareCardNames(unresolved(peru.input), [], "");
    expect(chinaLeaks(names.posted)).toEqual([]);
    expect(names.posted).toBe("Peru trip");
    expect(names.prefilled).toBe("Peru trip");
  });

  test("a code that is not a country gets a country-free name, not a broken one", () => {
    const nowhere: TripInput = { ...unresolved(peru.input), country: "ZZ" };
    // Armed: the profile really did resolve no name, which is the case under
    // test — the headline drops the name for exactly the same reason.
    expect(renderWizard({ ...peru, input: nowhere, destinations: [] })).toContain(
      "Your itinerary"
    );
    const names = shareCardNames(nowhere, [], "");
    expect(names.posted).toBe("Untitled trip");
    expect(names.prefilled).toBe("Untitled trip");
    // The three ways this could have degraded instead. The last is the worst:
    // `tripName: z.string().trim().min(1)` rejects it, so a blank name would
    // turn a cosmetic gap into a trip that cannot be created at all.
    expect(names.posted).not.toContain("undefined");
    expect(names.posted).not.toBe(" trip");
    expect(names.posted.trim()).not.toBe("");
  });

  test("what the traveller actually typed is written down, trimmed and unchanged", () => {
    // The fallback must be a fallback. A fix that always names the country
    // would satisfy every assertion above and silently rename everyone's trip.
    // `unresolved` so this renders an empty itinerary rather than a second
    // ten-day one: which fallback it would have used is not what is measured,
    // and the cheaper render keeps this file's share of the jsdom project's
    // wall-clock down (commit 84cd61e).
    expect(shareCardNames(unresolved(peru.input), [], "  Machu Picchu week  ").posted).toBe(
      "Machu Picchu week"
    );
  });
});

/**
 * The arming half of the finding above, and the reason a fix cannot simply
 * blank every default: China is a country somebody really does travel to, and
 * "China trip" is the *right* name for a China trip. What was wrong was
 * printing it on a Peruvian one.
 */
describe("T30 jsdom — the saved name, armed from China's side", () => {
  test("a blank-name China trip is still named, by its city and by its country", () => {
    expect(shareCardNames(china.input, china.destinations, "").posted).toBe("Beijing trip");
    expect(shareCardNames(unresolved(china.input), [], "").posted).toBe("China trip");
  });

  test("and the identical scan over those names reports the leak", () => {
    // The scanner is live on this surface. Without this, `chinaLeaks` returning
    // [] for the Peru names above would be indistinguishable from a scan that
    // matches nothing at all.
    expect(chinaLeaks(shareCardNames(unresolved(china.input), [], "").posted)).toEqual(["China"]);
  });
});

describe("T30 jsdom — the positive half", () => {
  test("the wizard shows Peru's own facts", () => {
    // Stops the negative half passing because the page rendered nothing.
    expect(peruMisses(renderWizard(peru))).toEqual([]);
  });

  test("the saved trip shows them too", () => {
    expect(peruMisses(renderTripPage(peru))).toEqual([]);
  });

  test("and so does the unauthenticated briefing", () => {
    expect(peruMisses(renderBriefing(peru))).toEqual([]);
  });

  test("the gap note is drawn as a note, on all three surfaces", () => {
    // Structurally distinct from a tip, which is what makes it a disclaimer
    // about the advice rather than a piece of advice.
    // Each `render` gets its own container, so the three coexist happily and
    // `afterEach(cleanup)` takes them all down together.
    for (const html of [renderWizard(peru), renderTripPage(peru), renderBriefing(peru)]) {
      expect(html).toContain('role="note"');
      expect(html).toContain("Peru-specific guidance");
    }
  });

  test("day counts and route stops reach the page", () => {
    const wizard = renderWizard(peru);
    expect(wizard).toContain("Day 01");
    expect(wizard).toContain("Day 10");
    for (const city of ["LIMA", "CUSCO", "AREQUIPA"]) expect(wizard).toContain(city);
  });
});

describe("T30 jsdom — the arming proof", () => {
  test("the identical scan over the rendered China trip page reports leaks", () => {
    const leaks = chinaLeaks(renderTripPage(china));
    expect(leaks).not.toEqual([]);
    for (const token of ["Alipay", "WeChat", "VPN", "12306", "high-speed rail"]) {
      expect(leaks).toContain(token);
    }
    // The glyph fix, armed from China's side on all three surfaces (here and
    // in the two tests below): CN has a researched rail speed, so it keeps 🚄
    // and never shows the neutral one. Without these, `travelEmoji` returning
    // the neutral glyph unconditionally would satisfy every Peru pin above.
    expect(leaks).toContain(RAIL_GLYPH);
    expect(hopLine(renderTripPage(china))).toContain(
      `${RAIL_GLYPH} High-speed rail or flight to`
    );
    expect(renderTripPage(china)).not.toContain(NEUTRAL_GLYPH);
  });

  test("the identical scan over the rendered China briefing reports leaks", () => {
    const leaks = chinaLeaks(renderBriefing(china));
    expect(leaks).not.toEqual([]);
    for (const token of ["Alipay", "WeChat", "VPN", "Trip.com", "12306", "Amap", "高德"]) {
      expect(leaks).toContain(token);
    }
    // CJK reaches this surface twice over: through cn.ts's "Amap 高德" tip and
    // through the curated `localName` the briefing carries for Beijing.
    expect(leaks).toContain("北");
    expect(leaks).toContain(RAIL_GLYPH);
    expect(hopLine(renderBriefing(china))).toContain(
      `${RAIL_GLYPH} High-speed rail or flight to`
    );
    expect(renderBriefing(china)).not.toContain(NEUTRAL_GLYPH);
  });

  test("the identical scan over the rendered China wizard reports leaks", () => {
    const leaks = chinaLeaks(renderWizard(china));
    for (const token of ["China", "Alipay", "WeChat", "RMB", "¥", "Pleco", "high-speed rail"]) {
      expect(leaks).toContain(token);
    }
    expect(leaks).toContain(RAIL_GLYPH);
    expect(hopLine(renderWizard(china))).toContain(`${RAIL_GLYPH} High-speed rail or flight to`);
    expect(renderWizard(china)).not.toContain(NEUTRAL_GLYPH);
    // T31's arming proof, direction two: CN still shows a chop, so the "no
    // chop for Peru" assertion above cannot pass because the feature is
    // simply broken. It is `同行`, not the old hardcoded `启程` — see the
    // FINDING 2 update above for why that is the fix, not a regression.
    expect(renderWizard(china)).toContain("同行");
  });

  test("the positive half is armed: a China page says none of Peru's facts", () => {
    const misses = peruMisses(renderTripPage(china));
    expect(misses).toContain("PEN");
    expect(misses).toContain("+51");
    expect(misses).toContain("Spanish");
  });
});
