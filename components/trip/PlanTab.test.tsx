import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
