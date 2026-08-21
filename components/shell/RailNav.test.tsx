import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  accentColor,
  chromaFor,
  contrastRatio,
  ISO_CODES,
  lightnessFor,
  oklchToSrgb,
} from "@/lib/accent";
import { TRIP_NAV } from "@/lib/nav";
import { RailNav } from "./RailNav";

/**
 * The rail's *layout* is visual work and is not asserted here, per the standing
 * ruling. Its active-state **colour pairing** is not visual: it is a spec §4.2
 * token role, it silently failed AA for the whole of PR2, and the only reason it
 * read as fine is that the inversion happens to pass under the dark ramp — the
 * one theme PR2 does not ship.
 *
 * `accent.test.ts` already pins the token maths (fill against light ink clears
 * 4.5:1 at every hue). What was missing is anything asserting the rail actually
 * *uses* that pairing, which is exactly how a correct ramp ended up behind
 * white text at 2.60:1.
 */

const search = vi.hoisted(() => ({ current: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/trip/abc123",
  useSearchParams: () => new URLSearchParams(search.current),
}));

/**
 * The two tokens the active pill composites against, as 0–1 sRGB — mirroring
 * app/globals.css and accent.test.ts's own constants.
 */
const LIGHT_INK: [number, number, number] = [0x17 / 255, 0x26 / 255, 0x3b / 255];
const PAPER: [number, number, number] = [1, 1, 1];

describe("RailNav active-tab contrast", () => {
  afterEach(cleanup);

  test("the active tab draws its label in --on-accent, not --ink-0 or --paper", () => {
    search.current = "tab=money";
    render(<RailNav />);

    const active = screen.getByRole("link", { name: "Money and expenses" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active.style.background).toBe("var(--accent-fill)");
    // The regression: `var(--paper)` here is 2.60:1 in light. `var(--ink-0)`
    // fixed light (5.82:1) but broke dark (1.72:1) — `--accent-fill` does not
    // invert between ramps, so a ramp-following ink cannot pair with it in both.
    expect(active.style.color).toBe("var(--on-accent)");
  });

  test("inactive tabs stay --ink-2 on the rail's own paper", () => {
    search.current = "tab=money";
    render(<RailNav />);

    const inactive = screen.getByRole("link", { name: "Plan the trip" });
    expect(inactive).not.toHaveAttribute("aria-current");
    expect(inactive.style.background).toBe("");
    expect(inactive.style.color).toBe("var(--ink-2)");
  });

  test("every tab in TRIP_NAV renders exactly once", () => {
    search.current = "";
    render(<RailNav />);
    for (const item of TRIP_NAV) {
      expect(screen.getAllByRole("link", { name: item.ariaLabel })).toHaveLength(1);
    }
  });

  /**
   * Checked against the ramp rather than against hardcoded numbers, so retuning
   * the accent ramp fails here instead of shipping a rail that no longer meets
   * AA.
   *
   * The ≥4.5 assertion lives here and not in accent.test.ts on purpose. That
   * file pins fill-behind-ink at ≥3.0, which is the correct *spec-level* floor
   * for a fill surface. This label is 11px, so it needs 4.5 — a stricter
   * requirement belonging to the consumer that has it, not to the token.
   */
  test("ink-on-fill clears AA at every hue; paper-on-fill never can", () => {
    const fillAt = (hue: number) =>
      oklchToSrgb(lightnessFor("light", "fill") / 100, chromaFor("light", "fill"), hue);

    let worstInk = Infinity;
    let bestPaper = 0;
    // Sweep every hue, not just the ISO table: `accentHue` accepts a user
    // override, so any of the 360 is reachable.
    for (let hue = 0; hue < 360; hue++) {
      const fill = fillAt(hue);
      worstInk = Math.min(worstInk, contrastRatio(fill, LIGHT_INK));
      bestPaper = Math.max(bestPaper, contrastRatio(fill, PAPER));
    }

    expect(worstInk).toBeGreaterThanOrEqual(4.5);
    // Pins *why* this is the fix rather than a per-country tuning problem:
    // white cannot clear AA on this ramp at any hue...
    expect(bestPaper).toBeLessThan(4.5);
    // ...nor even the 3:1 graphics floor the 24px icon needs.
    expect(bestPaper).toBeLessThan(3);
  });

  test("the ISO table's own hues are covered by that sweep", () => {
    for (const code of ISO_CODES.slice(0, 12)) {
      expect(accentColor(code, "light", "fill")).toMatch(/^oklch\(72% [\d.]+ \d+(\.\d+)?\)$/);
    }
  });
});
