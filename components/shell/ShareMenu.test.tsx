import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, test } from "vitest";
import type { TripPayload } from "@/lib/tripShared";
import { ShareMenu } from "./ShareMenu";
import { ShellTripProvider, useSetShellTrip } from "./ShellTripContext";

/**
 * T28b split the briefing out of this component and behind `next/dynamic`, so
 * that `buildBriefing` — and through it the 70 KB CC0 facts artifact — stops
 * riding in the shell chunk that app/layout.tsx ships to every route.
 *
 * lib/countryFacts.test.ts proves the module graph. This file proves the thing
 * a graph walk cannot: that the chunk on the far side of that `import()` still
 * resolves and still renders the same briefing. A split that quietly rendered
 * nothing would satisfy every byte-budget assertion in the repo.
 *
 * Rendered through the real ShellTripProvider, the same as CrewMenu.test.tsx.
 * `myMemberName` is left off deliberately: it is what mounts BriefingShare,
 * which calls a trip-scoped endpoint, and no test here is about that fetch.
 */

function payload(): TripPayload {
  return {
    id: "abc123",
    version: 3,
    updatedAt: 1_700_000_000_000,
    data: {
      tripName: "Lima run",
      startDate: "2026-12-24",
      input: {
        destinationIds: ["c1"],
        days: 1,
        season: "winter",
        adults: 2,
        kids: 0,
        interests: ["food"],
        country: "PE",
      },
      plan: {
        days: [
          {
            day: 1,
            destinationId: "c1",
            destinationName: "Lima",
            items: [{ id: "i1", slot: "morning", kind: "arrival", title: "Land" }],
          },
        ],
        tips: ["Carry your passport everywhere."],
      },
      packing: [],
      foods: [],
      destinationNames: ["Lima"],
    },
    members: [{ name: "Darren", joinedAt: 1_700_000_000_000 }],
    checks: [],
    tickets: [],
    expenses: [],
    settlements: [],
    journal: [],
    joinCode: "SKY42",
  } as unknown as TripPayload;
}

function Publish({ value }: { value: TripPayload }) {
  const set = useSetShellTrip();
  useEffect(() => {
    set({ tripId: "t1", payload: value, mutate: async () => null });
  }, [set, value]);
  return null;
}

function renderMenu() {
  return render(
    <ShellTripProvider>
      <Publish value={payload()} />
      <ShareMenu />
    </ShellTripProvider>
  );
}

/**
 * Testing Library waits 1000ms by default, and that is not enough here.
 * Resolving the chunk means evaluating lib/briefing.ts, lib/countryProfile.ts and
 * the 70 KB JSON behind them for the first time in this worker — the very cost
 * the lazy split exists to keep off other routes. It measures ~50ms on an idle
 * machine and blew past a second under the full two-project run, which is this
 * repo's documented concurrent-load failure mode rather than anything about
 * this component.
 *
 * The wait is 10x the breach that was actually observed, not 1.5x. A tighter
 * number would be a guess dressed as a measurement: the thing being waited on
 * is CPU availability, which has no upper bound worth predicting. Both figures
 * are still far below "hung", and neither costs anything on a run that passes.
 */
const CHUNK_WAIT = { timeout: 10_000 } as const;
const CHUNK_BUDGET = 25_000;

describe("ShareMenu's lazily loaded briefing", () => {
  afterEach(cleanup);

  test("does not render the briefing until the disclosure is expanded", async () => {
    renderMenu();

    fireEvent.click(await screen.findByRole("button", { name: "Share" }));

    // The panel is open and its own contents are here...
    expect(screen.getByRole("dialog", { name: "Share this trip" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /View briefing/ })).toBeInTheDocument();
    // ...but nothing from the briefing chunk has been rendered. This is the
    // half that makes the lazy import worth having: the bytes are not fetched
    // for a member who only wanted the invite link.
    expect(screen.queryByRole("heading", { name: "Logistics" })).not.toBeInTheDocument();
    expect(screen.queryByText("Lima run")).not.toBeInTheDocument();
  });

  test("resolves the chunk and renders the real briefing when expanded", async () => {
    renderMenu();

    fireEvent.click(await screen.findByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: /View briefing/ }));

    // The lazy split, asserted rather than assumed. Synchronously after the
    // click the chunk has not arrived, so the fallback is on screen and the
    // briefing is not — which is precisely what a static import could never
    // produce. Probed: point ShareMenu back at a static `buildBriefing` and
    // these two lines fail while everything below still passes.
    expect(screen.getByText(/Building the briefing/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Logistics" })).not.toBeInTheDocument();

    // And then it resolves, with the real briefing in it.
    expect(
      await screen.findByRole("heading", { name: "Logistics" }, CHUNK_WAIT)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Building the briefing/)).not.toBeInTheDocument();
    expect(screen.getByText("Lima run")).toBeInTheDocument();
    // Built through the real `buildBriefing`, so the trip's tips came with it.
    expect(screen.getByText("Carry your passport everywhere.")).toBeInTheDocument();
  }, CHUNK_BUDGET);

  test("carries the country gap note the members' briefing is supposed to show", async () => {
    // The reason `buildBriefing` reaches the artifact at all (T28). If the lazy
    // chunk had been wired to some cheaper builder to dodge the byte budget,
    // this is what would go missing, and no module-graph assertion would notice.
    renderMenu();

    fireEvent.click(await screen.findByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: /View briefing/ }));
    await screen.findByRole("heading", { name: "Logistics" }, CHUNK_WAIT);

    // Peru is not hand-researched, so its briefing disclaims coverage by name.
    expect(screen.getByText(/Peru/)).toBeInTheDocument();
  }, CHUNK_BUDGET);
});
