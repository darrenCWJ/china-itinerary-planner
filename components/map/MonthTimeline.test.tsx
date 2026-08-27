import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { HOLIDAY_BANDS, NATIONAL_CROWD } from "@/lib/months";
import { MonthTimeline } from "./MonthTimeline";

/**
 * The month scrubber stops being Chinese for every country.
 *
 * Everything asserted here is asserted twice — once for `country="PE"` and once
 * for `country="CN"` — and that is the point of the file rather than a
 * convention. "Peru shows no Chinese New Year" passes just as well against a
 * component that renders nothing, against a prop that is ignored while the
 * month happens to sit outside every band, and against a typo in the string
 * being searched for. Only the China half proves the queries can see a band
 * when one is there, so only together do the two halves mean anything.
 *
 * `country` is a required prop for the same reason: an optional one defaulting
 * to "CN" would leave every existing call site rendering China's bands with
 * nothing to fail.
 */

afterEach(cleanup);

/** The label on the crowd line — identifies the whole element, not its dots. */
const CROWD_TITLE = "Typical national crowd pressure this month";

const BAND_NAMES = HOLIDAY_BANDS.map((b) => b.name);

const FILLED = "●";
const HOLLOW = "○";
const RED_ENVELOPE = "\u{1f9e7}";
const CN_FLAG = "\u{1f1e8}\u{1f1f3}";

function titles(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[title]")].map((el) => el.getAttribute("title") ?? "");
}

/** Band-strip entries, which are titled `<emoji> <name>: <note>`. */
function bandTitles(container: HTMLElement): string[] {
  return titles(container).filter((t) => BAND_NAMES.some((name) => t.includes(name)));
}

describe("MonthTimeline — holiday bands", () => {
  test("China still draws all four bands, and February lists Chinese New Year", () => {
    // The arming half. Every absence asserted for Peru below is measured
    // against this: the same component, the same month, the same queries.
    const { container } = render(<MonthTimeline month={2} onMonth={() => {}} country="CN" />);

    expect(BAND_NAMES).toHaveLength(4);
    expect(bandTitles(container)).toHaveLength(4);
    for (const name of BAND_NAMES) {
      expect(bandTitles(container).filter((t) => t.includes(name))).toHaveLength(1);
    }

    // The list under the track, which only renders for an overlapping month.
    expect(container.querySelectorAll("ul")).toHaveLength(1);
    expect(screen.getByText("Chinese New Year:")).toBeInTheDocument();
    expect(container.textContent).toContain(RED_ENVELOPE);
  });

  test("October in China still says National Day Golden Week", () => {
    const { container } = render(<MonthTimeline month={10} onMonth={() => {}} country="CN" />);
    expect(screen.getByText("National Day Golden Week:")).toBeInTheDocument();
    expect(container.textContent).toContain(CN_FLAG);
  });

  test("Peru draws no bands in any month, and no band list", () => {
    // Every month, not a sampled one: a prop that was being ignored would still
    // look clean in a month no band overlaps, and eight of the twelve are such
    // months even under China's table.
    for (let month = 1; month <= 12; month++) {
      const { container } = render(
        <MonthTimeline month={month} onMonth={() => {}} country="PE" />
      );
      expect(bandTitles(container)).toEqual([]);
      expect(container.querySelectorAll("ul")).toHaveLength(0);
      const text = container.textContent ?? "";
      expect(text).not.toContain("Chinese New Year");
      expect(text).not.toContain("Golden Week");
      expect(text).not.toContain("China");
      expect(text).not.toContain(RED_ENVELOPE);
      expect(text).not.toContain(CN_FLAG);
      expect(text).not.toMatch(/[一-鿿]/u);
      cleanup();
    }
  });
});

describe("MonthTimeline — the crowd curve", () => {
  test("China renders the element, and renders the real twelve-month curve", () => {
    expect(NATIONAL_CROWD).toHaveLength(12);
    for (let month = 1; month <= 12; month++) {
      const { container } = render(
        <MonthTimeline month={month} onMonth={() => {}} country="CN" />
      );
      expect(screen.getByTitle(CROWD_TITLE)).toBeInTheDocument();
      // The dots are this month's own value, not a constant — a component
      // rendering the same figure every month would pass a presence check.
      const crowd = NATIONAL_CROWD[month - 1];
      expect(screen.getByLabelText(`${crowd} out of 5`)).toBeInTheDocument();
      expect(container.textContent).toContain("Crowds");
      expect(container.textContent).toContain(FILLED.repeat(crowd));
      cleanup();
    }
  });

  test("Peru renders no crowd element at all — not a flat three-of-five", () => {
    // The flat curve is what this asserts against, not the Chinese one. Wiring
    // Peru through a `[3,3,3,…]` profile would render "Crowds ●●●○○" under a
    // label reading *typical national crowd pressure* — a brand-new unsourced
    // claim invented by the change that was meant to remove one. So the
    // assertion is on the element, not on the value of its dots.
    for (let month = 1; month <= 12; month++) {
      const { container } = render(
        <MonthTimeline month={month} onMonth={() => {}} country="PE" />
      );
      expect(screen.queryByTitle(CROWD_TITLE)).not.toBeInTheDocument();
      expect(container.textContent).not.toContain("Crowds");
      expect(container.textContent).not.toContain(FILLED);
      expect(container.textContent).not.toContain(HOLLOW);
      cleanup();
    }
  });
});

describe("MonthTimeline — the season word", () => {
  test("June is summer in China and winter in Peru", () => {
    // The scrubber read `MONTHS[].season`, which is the northern table. Left
    // alone it would sit beside a plan that now says winter and contradict it
    // on the same screen.
    render(<MonthTimeline month={6} onMonth={() => {}} country="CN" />);
    expect(screen.getByText("summer")).toBeInTheDocument();
    expect(screen.queryByText("winter")).not.toBeInTheDocument();
    cleanup();

    render(<MonthTimeline month={6} onMonth={() => {}} country="PE" />);
    expect(screen.getByText("winter")).toBeInTheDocument();
    expect(screen.queryByText("summer")).not.toBeInTheDocument();
  });

  test("the month itself is unaffected by the hemisphere", () => {
    // Only the season inverts. December is December everywhere, and a fix that
    // shifted the label would be a different bug.
    for (const country of ["CN", "PE"]) {
      render(<MonthTimeline month={12} onMonth={() => {}} country={country} />);
      expect(screen.getByText(/December/)).toBeInTheDocument();
      expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "12");
      cleanup();
    }
  });
});

describe("MonthTimeline — the positive half", () => {
  test("a Peru scrubber is still a working scrubber", () => {
    // Without this, every absence above is satisfied by a component that
    // returned null for any country but China.
    const { container } = render(<MonthTimeline month={2} onMonth={() => {}} country="PE" />);

    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("aria-valuenow", "2");
    expect(slider).toHaveAttribute("aria-valuemin", "1");
    expect(slider).toHaveAttribute("aria-valuemax", "12");
    expect(screen.getByText(/February/)).toBeInTheDocument();
    for (const short of ["Jan", "Jun", "Dec"]) {
      expect(screen.getByText(short)).toBeInTheDocument();
    }
    // Twelve month cells, so "no bands" is not "no track".
    expect(container.querySelectorAll("span.flex-1")).toHaveLength(12);
  });
});
