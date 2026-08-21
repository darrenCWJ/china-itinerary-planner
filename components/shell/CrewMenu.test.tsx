import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, test } from "vitest";
import type { TripPayload } from "@/lib/tripShared";
import { CrewMenu } from "./CrewMenu";
import { ShellTripProvider, useSetShellTrip } from "./ShellTripContext";

/**
 * The plan calls this interaction work and verifies it by hand. Per the ruling,
 * the keyboard contract it names — trigger focusable, Esc closes, focus returns —
 * is behaviour rather than appearance, so it is asserted here. Nothing below
 * touches layout or the avatar stacking.
 *
 * Rendered through the real ShellTripProvider rather than a mocked hook, so the
 * publish/subscribe direction is exercised too: if the store were a plain
 * context, the menu would read null and every test here would fail.
 */

/** Only the four fields CrewMenu reads; the rest of TripPayload is irrelevant. */
function payloadWith(overrides: Partial<TripPayload>): TripPayload {
  return {
    members: [
      { name: "Darren", joinedAt: Date.parse("2026-08-01") },
      { name: "Mei", joinedAt: Date.parse("2026-08-02") },
    ],
    myMemberName: "Darren",
    joinCode: "SKY42",
    ...overrides,
  } as unknown as TripPayload;
}

function Publish({ payload }: { payload: TripPayload | null }) {
  const set = useSetShellTrip();
  useEffect(() => {
    set(payload === null ? null : { tripId: "t1", payload, mutate: async () => null });
  }, [set, payload]);
  return null;
}

function renderMenu(payload: TripPayload | null) {
  return render(
    <ShellTripProvider>
      <Publish payload={payload} />
      <CrewMenu />
    </ShellTripProvider>
  );
}

describe("CrewMenu", () => {
  afterEach(cleanup);

  test("renders nothing until a trip is published", () => {
    renderMenu(null);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("names the crew on a keyboard-reachable trigger", async () => {
    renderMenu(payloadWith({}));

    const trigger = await screen.findByRole("button", { name: "Crew — 2 members" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Asserted on the tab index, not by calling focus(). This test used to do
    // `trigger.focus(); expect(trigger).toHaveFocus()`, which passes on any
    // native <button> — including one carrying `tabIndex={-1}`, i.e. exactly
    // the regression a "focusable trigger" test exists to catch. It measured
    // jsdom rather than the trigger's place in the tab order. Probed both
    // ways: this line fails under that mutation, the old one did not.
    expect(trigger.tabIndex).toBe(0);
  });

  test("opens to the member list and the invite code", async () => {
    renderMenu(payloadWith({}));

    fireEvent.click(await screen.findByRole("button", { name: "Crew — 2 members" }));

    const dialog = screen.getByRole("dialog", { name: "Crew" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Mei")).toBeInTheDocument();
    expect(screen.getByText("SKY42")).toBeInTheDocument();
    // The viewer is marked, so a two-Darren trip is still readable.
    expect(screen.getByText("YOU")).toBeInTheDocument();
  });

  test("closes on Escape and returns focus to the trigger", async () => {
    renderMenu(payloadWith({}));

    const trigger = await screen.findByRole("button", { name: "Crew — 2 members" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Crew" })).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The contract that rules out <details>: Esc must not drop the caret at the
    // top of the document.
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("omits the invite block for a viewer with no join code", async () => {
    // A guest has no joinCode on their payload; offering them an invite link
    // would promise something the server will refuse.
    renderMenu(payloadWith({ joinCode: undefined }));

    fireEvent.click(await screen.findByRole("button", { name: "Crew — 2 members" }));

    expect(screen.queryByText("Invite more people")).not.toBeInTheDocument();
    expect(screen.getByText("Mei")).toBeInTheDocument();
  });

  test("collapses a large crew into an overflow count", async () => {
    const names = ["Ana", "Ben", "Cal", "Dee", "Eli", "Fay"];
    renderMenu(
      payloadWith({
        members: names.map((name) => ({ name, joinedAt: Date.parse("2026-08-01") })),
      })
    );

    const trigger = await screen.findByRole("button", { name: "Crew — 6 members" });
    // Four initials plus "+2" — past four, initials stop being readable.
    expect(trigger).toHaveTextContent("+2");
  });
});
