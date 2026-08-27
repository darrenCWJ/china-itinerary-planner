import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PlanStep } from "@/components/PlanStep";
import { BriefingView } from "@/components/trip/BriefingView";
import { PackingSection } from "@/components/trip/PackingSection";
import { PlanTab } from "@/components/trip/PlanTab";
import { buildBriefing, type Briefing } from "@/lib/briefing";
import { chinaLeaks, peruMisses } from "@/lib/chinaLeakScan";
import type { TripInput } from "@/lib/itinerary";
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
 * ⚠ FINDING 1 — the render-time rail glyph, on every country.
 *
 * `lib/meta.ts`'s `KIND_EMOJI.travel` is `"🚄"`, stamped on every `kind:
 * "travel"` itinerary item by all three renderers (`PlanStep`'s `PlanItem`,
 * `DayCard`, `BriefingView`'s `DayPanel`). It is not country-aware, so a
 * Peruvian hop whose *title* is the neutral "Travel to Cusco" is drawn with a
 * Chinese high-speed-train glyph — on the unauthenticated briefing included.
 *
 * **This is the seam this gate exists to find.** The generated plan is clean:
 * `lib/worldwidePlan.test.ts` scans the same trip's data and reports nothing,
 * because the glyph does not exist until render. Every data-layer suite in the
 * phase is blind to it, and so is the design — the guidance design asserts
 * "Zero 🚄 anywhere" for Peru but no task in T20–T32 touches `lib/meta.ts`.
 *
 * Not fixed here. The fix threads a country through three renderers and needs a
 * country on `Briefing`, which is a feature change, not an acceptance gate.
 */
const RAIL_GLYPH = "🚄";

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
  test("the saved trip's plan and packing leak only the render-time rail glyph", () => {
    expect(chinaLeaks(renderTripPage(peru))).toEqual([RAIL_GLYPH]);
  });

  test("the unauthenticated briefing leaks only the render-time rail glyph", () => {
    // `plan.tips` reaches a bearer-link holder here, with no login in front of
    // it. This is the surface the phase's honesty rule matters most on — and it
    // is where a Chinese train is currently drawn over a Peruvian hop.
    expect(chinaLeaks(renderBriefing(peru))).toEqual([RAIL_GLYPH]);
  });

  test("the wizard leaks the rail glyph and the unowned share-card CJK, and nothing else", () => {
    // Post-T31: neither "China" nor 启/程 reach the Peru wizard any longer —
    // the chop renders nothing (Peru has no curated mark) and the headline
    // now names Peru's own code. `chinaLeaks` reports tokens in CHINA_TOKENS
    // order first — only "🚄" still matches — then CJK codepoints in the
    // order they appear in the document: the share-a-trip card is the only
    // source left.
    expect(chinaLeaks(renderWizard(peru))).toEqual([RAIL_GLYPH, "一", "起", "走"]);
    // Spelled out above, and cross-checked against the constant here, so the
    // two cannot drift and the constant's docblock stays the explanation.
    expect(chinaLeaks(renderWizard(peru)).filter((l) => l !== RAIL_GLYPH)).toEqual(
      UNOWNED_SHARE_CARD_CJK
    );
    // T31's arming proof, direction one: a country with no curated mark shows
    // no chop at all — neither China's old hardcoded one nor any other.
    expect(renderWizard(peru)).not.toContain("启程");
    expect(renderWizard(peru)).not.toContain("同行");
    expect(renderWizard(peru)).not.toContain("China");
  });

  test("everything the generators produced is clean — the leaks are render-only", () => {
    // The seam, stated as an assertion. The plan, packing, tips and gap note
    // this page was handed carry no marker at all; the glyph is added by the
    // renderer, which is why no data-layer suite in the phase can see it.
    expect(chinaLeaks(JSON.stringify(peru.data))).toEqual([]);
    expect(chinaLeaks(JSON.stringify(peru.briefing))).toEqual([]);
    // And the item it is stamped on is a travel hop with neutral copy.
    const hop = peru.data.plan.days
      .flatMap((d) => d.items)
      .find((i) => i.kind === "travel");
    expect(hop?.title).toBe("Travel to Cusco");
    expect(hop?.note).toBeUndefined();
  });

  test("the rail glyph is the travel item's, not something structural", () => {
    // If it ever appears on a surface with no travel item, it came from
    // somewhere else and the pin above is measuring the wrong thing.
    const noHops = { ...peru.briefing, days: peru.briefing.days.slice(0, 1) };
    expect(noHops.days[0].items.every((i) => i.kind !== "travel")).toBe(true);
    expect(chinaLeaks(renderBriefing({ ...peru, briefing: noHops }))).toEqual([]);
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
  });

  test("the identical scan over the rendered China wizard reports leaks", () => {
    const leaks = chinaLeaks(renderWizard(china));
    for (const token of ["China", "Alipay", "WeChat", "RMB", "¥", "Pleco", "high-speed rail"]) {
      expect(leaks).toContain(token);
    }
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
