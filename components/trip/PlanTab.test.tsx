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

function renderTab(onPlanOp: (op: PlanOp) => Promise<string | null>) {
  return render(
    <PlanTab
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
