import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { DayPlan } from "@/lib/itinerary";
import type { PlanOp } from "@/lib/planOps";
import { PlanTab } from "./PlanTab";

/**
 * Plan's own failure surface. The day list, the route view and the builder each
 * have their own tests; what is asserted here is the one thing PlanTab does
 * that nothing else covers — telling a member that an edit did not land.
 */

const day = (n: number): DayPlan => ({
  day: n,
  destinationId: "beijing",
  destinationName: "Beijing",
  items: [],
});

const buildProps = {
  tripId: "t1",
  payload: { version: 5, data: { plan: { days: [day(1)], tips: [] } } } as never,
  mutate: async () => null,
};

function renderTab(
  onPlanOp: (op: PlanOp) => Promise<string | null>,
  extra: Record<string, unknown> = {}
) {
  return render(
    <PlanTab
      {...extra}
      plan={{ days: [day(1)], tips: [] }}
      startDate={null}
      country="CN"
      season="autumn"
      tickets={[]}
      checkedBy={new Map()}
      isMember
      todayIndex={null}
      onToggle={() => {}}
      onPlanOp={onPlanOp}
    />
  );
}

afterEach(cleanup);

describe("PlanTab — a failed add-day", () => {
  test("announces the failure through a live region", async () => {
    const message = "The trip is being edited by someone else right now — try again.";
    renderTab(vi.fn(async () => message));

    // The region has to already be in the DOM: a live region created in the
    // same tick as its first content is unreliably announced, so asserting it
    // exists while empty is the point rather than incidental.
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: /Add day/ }));

    await waitFor(() => expect(status).toHaveTextContent(message));
  });

  test("says nothing when the add succeeds", async () => {
    renderTab(vi.fn(async () => null));

    fireEvent.click(screen.getByRole("button", { name: /Add day/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Add day/ })).not.toBeDisabled()
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("PlanTab — the builder's queue survives a view change", () => {
  test("keeps the builder mounted once opened, hidden rather than destroyed", () => {
    renderTab(vi.fn(async () => null), buildProps);

    fireEvent.click(screen.getByRole("button", { name: /Build/ }));
    expect(screen.getByText("Adding to")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Days/ }));

    // Unmounting takes the reducer with it, and `pendingOps` holds every edit
    // queued behind the one in flight — those go out one at a time, so a burst
    // of edits leaves a real window where switching tabs drops them silently.
    // Still in the DOM, so the queue keeps draining.
    expect(screen.getByText("Adding to")).toBeInTheDocument();
    // But out of the accessibility tree and the tab order, which is what
    // `hidden` buys over an off-screen class.
    expect(screen.queryByRole("radio", { name: "Day 01" })).toBeNull();
  });

  test("does not mount the builder before it is asked for", () => {
    renderTab(vi.fn(async () => null), buildProps);
    expect(screen.queryByText("Adding to")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T28 — the gap note. Surface 2 of 3.
// ---------------------------------------------------------------------------

/**
 * The snapshotted tips a trip was created with. Chinese on purpose: every case
 * below hands the SAME plan to a different country, so a note derived from the
 * plan rather than from `country` would be visibly wrong.
 */
const SNAPSHOTTED_TIPS = ["Carry your passport everywhere."];

function renderPlan(country: string, tips: string[] = SNAPSHOTTED_TIPS) {
  return render(
    <PlanTab
      plan={{ days: [day(1)], tips }}
      startDate={null}
      country={country}
      season="autumn"
      tickets={[]}
      checkedBy={new Map()}
      isMember={false}
      todayIndex={null}
      onToggle={() => {}}
      onPlanOp={async () => null}
    />
  );
}

/** The "Good to know" block, found by its label rather than by a class. */
function goodToKnow(): HTMLElement {
  const heading = screen.getByText("Good to know");
  const panel = heading.parentElement;
  expect(panel).not.toBeNull();
  return panel as HTMLElement;
}

const PERU_LINE_ONE =
  "These notes come from open reference data. We don't have Peru-specific guidance on payments, " +
  "connectivity, booking channels or public holidays yet — and we'd rather leave that blank than guess.";

describe("PlanTab — the gap note", () => {
  test("a Peru trip is told where its notes came from", () => {
    renderPlan("PE");
    expect(screen.getByRole("note")).toHaveTextContent(PERU_LINE_ONE);
    expect(screen.getByRole("note").querySelectorAll("p")).toHaveLength(1);
  });

  test("China gets none of it", () => {
    renderPlan("CN");
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText(/open reference data/)).toBeNull();
    // Armed: the block it would have appeared in is on screen, with tips in it.
    expect(within(goodToKnow()).getAllByRole("listitem")).toHaveLength(1);
  });

  test("the note is a sibling of the tips list, not a row in it", () => {
    renderPlan("PE");

    const panel = goodToKnow();
    const list = within(panel).getByRole("list");
    const note = screen.getByRole("note");

    // Armed: there is a real list, with a real tip, to be mistaken for.
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);

    expect(list).not.toContainElement(note);
    expect(note.closest("ul")).toBeNull();
    expect(note.closest("li")).toBeNull();
    expect(within(list).queryByText(/open reference data/)).toBeNull();
    expect(panel).toContainElement(note);
  });

  test("a sparse country names exactly the fields we lack", () => {
    renderPlan("SH");
    const paragraphs = [...screen.getByRole("note").querySelectorAll("p")].map((p) => p.textContent);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1]).toBe(
      "Our data also has no currency, plug types, mains voltage or dialling code for " +
        "this country."
    );
  });

  test("it follows the country, not the plan — which is what stops it being snapshotted", () => {
    // The same frozen plan object, three countries. `plan.tips` is persisted at
    // creation and never regenerated, which is right for advice a traveller
    // acted on; the gap note is a statement about our CURRENT data, so it has
    // to shrink as coverage improves. If anyone ever moves it onto `plan`,
    // these three renders start agreeing and this test fails.
    const peru = renderPlan("PE");
    expect(screen.getByRole("note")).toHaveTextContent("Peru-specific guidance");
    peru.unmount();

    const helena = renderPlan("SH");
    expect(screen.getByRole("note")).toHaveTextContent("Saint Helena");
    expect(screen.getByRole("note")).not.toHaveTextContent("Peru-specific");
    helena.unmount();

    renderPlan("CN");
    expect(screen.queryByRole("note")).toBeNull();
    // And the tips themselves never moved: the plan handed in is untouched.
    expect(screen.getByText(SNAPSHOTTED_TIPS[0])).toBeInTheDocument();
  });

  test("an empty tips list still gets the explanation", () => {
    // The country the ingest never reached is the one whose blank panel most
    // needs a reason for being blank, so the block opens on either condition.
    renderPlan("PE", []);
    expect(within(goodToKnow()).queryByRole("list")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(PERU_LINE_ONE);
  });
});
