import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { FitLegend, FIT_LEGEND_LABEL } from "./FitLegend";
import { FIT_COLORS, FIT_LABELS, FIT_ORDER } from "./mapTypes";

afterEach(cleanup);

/**
 * Decision P6-2: the key China's map used to have, back for every country
 * now that the colours mean something everywhere. Five existing bands, no
 * new swatch, no `FIT_COLORS` change (§9.4).
 */
describe("FitLegend", () => {
  test("lists every band once, in FIT_ORDER, with its own swatch", () => {
    render(<FitLegend />);
    const list = screen.getByRole("list", { name: FIT_LEGEND_LABEL });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.trim())).toEqual(FIT_ORDER.map((fit) => FIT_LABELS[fit]));
    items.forEach((li, i) => {
      const swatch = li.querySelector("span[aria-hidden]") as HTMLElement | null;
      expect(swatch, FIT_ORDER[i]).not.toBeNull();
      expect(swatch!.style.backgroundColor).toBe(hex2rgb(FIT_COLORS[FIT_ORDER[i]]));
    });
  });

  test("is a key and not a control — nothing in it is operable", () => {
    // The tap-target sweep (e2e/tap-targets.spec.ts) counts every control the
    // map panel owns; a legend that rendered buttons would add five 20px ones.
    const { container } = render(<FitLegend />);
    expect(container.querySelectorAll("button, a, input, select, [tabindex]")).toHaveLength(0);
  });
});

/** jsdom normalises an inline hex colour to `rgb(r, g, b)`. */
function hex2rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
