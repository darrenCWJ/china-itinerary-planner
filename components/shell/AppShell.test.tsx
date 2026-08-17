import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AppShell } from "./AppShell";

/**
 * The plan declines a test for this task on the grounds that the shell is
 * visual work, and the layout genuinely is — rail width, header rhythm and
 * safe-area padding are not things a jsdom assertion can judge honestly.
 *
 * Its *route gating* is not visual. Which routes get chrome and which get a
 * rail are two branches that silently regress into a login page wearing an
 * application header, so they are tested here. Nothing below asserts on
 * appearance.
 */

const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  // RailNav reads `?tab=`; no test here depends on which tab is active.
  useSearchParams: () => new URLSearchParams(),
}));

// AccountChip calls the auth client, which is not what this test is about.
vi.mock("@/components/auth/AccountChip", () => ({
  AccountChip: () => <div data-testid="account-chip" />,
}));

describe("AppShell route gating", () => {
  beforeEach(() => {
    pathname.current = "/";
  });

  // The jsdom project does not enable globals, so RTL's automatic cleanup never
  // registers and renders would accumulate across cases. Same as
  // PrefsProvider.test.tsx.
  afterEach(cleanup);

  test.each(["/login", "/signup", "/b/abc123"])("renders %s bare, with no chrome", (path) => {
    pathname.current = path;
    render(
      <AppShell>
        <p>page body</p>
      </AppShell>
    );

    expect(screen.getByText("page body")).toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("account-chip")).not.toBeInTheDocument();
  });

  test("gives a non-trip route the header but no rail", () => {
    pathname.current = "/plan";
    render(
      <AppShell>
        <p>page body</p>
      </AppShell>
    );

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Trip sections" })).not.toBeInTheDocument();
  });

  test("gives a trip route the rail, rendered from TRIP_NAV", () => {
    pathname.current = "/trip/abc";
    render(
      <AppShell>
        <p>page body</p>
      </AppShell>
    );

    const rail = screen.getByRole("navigation", { name: "Trip sections" });
    expect(rail).toBeInTheDocument();
    // Asserting the count, not the labels: the labels belong to lib/nav's test.
    // This only pins that the rail renders every item it is given (C1).
    expect(rail.querySelectorAll("a")).toHaveLength(4);
  });

  test("fills header slots on a trip route", () => {
    pathname.current = "/trip/abc";
    render(
      <AppShell tripSwitcher={<button type="button">switch</button>}>
        <p>page body</p>
      </AppShell>
    );
    expect(screen.getByRole("button", { name: "switch" })).toBeInTheDocument();
  });

  test("withholds header slots off a trip route", () => {
    // The slot content is passed but must not render: the trip zone describes a
    // trip, and /plan has none. A switcher there would offer to switch away
    // from nothing.
    render(
      <AppShell tripSwitcher={<button type="button">switch</button>}>
        <p>page body</p>
      </AppShell>
    );
    expect(screen.queryByRole("button", { name: "switch" })).not.toBeInTheDocument();
  });
});
