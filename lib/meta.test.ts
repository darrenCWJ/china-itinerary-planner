import { describe, expect, test } from "vitest";
import { getCountryBaseProfile } from "./countryBaseProfile";
import { getCountry } from "./countries";
import { SEASONS, seasonMonths } from "./meta";
import { MONTHS } from "./months";
import type { Season } from "./types";

/**
 * The season chips' months, reconciled against the season a trip actually gets.
 *
 * `SEASONS` used to carry a `months` string per season — "Mar – May" for
 * spring, everywhere — and `lib/countryBaseProfile.ts` has always resolved a
 * southern country's June to winter. Nothing compared the two, because the
 * label is presentation and the resolution is data, so the wizard could caption
 * a Peruvian traveller's Spring chip with the northern hemisphere's months
 * indefinitely. This file is the comparison.
 *
 * Both directions, for both hemispheres: every month a label names must resolve
 * to that season, and every month it does not name must not. A one-directional
 * check would pass a table that named one correct month per season.
 */
describe("seasonMonths agrees with the season a country's profile resolves", () => {
  /**
   * The month numbers an inclusive `"Dec – Feb"`-shaped label covers.
   *
   * Walks forward from the first month and stops at the last, so a label that
   * wraps the year end is expanded the same way as one that does not. Throws on
   * a short name `lib/months.ts` does not carry, which is what stops a typo
   * ("Sept – Nov") from quietly expanding to nothing and passing every check
   * below as an empty set.
   */
  const monthsIn = (label: string): number[] => {
    const parts = label.split("–").map((part) => part.trim());
    expect(parts, `"${label}" is not a two-ended month range`).toHaveLength(2);
    const idOf = (short: string): number => {
      const found = MONTHS.find((month) => month.short === short);
      if (!found) throw new Error(`"${short}" is not a month short name in lib/months.ts`);
      return found.id;
    };
    const start = idOf(parts[0]);
    const end = idOf(parts[1]);
    const out: number[] = [];
    for (let step = 0; step < MONTHS.length; step += 1) {
      const month = ((start - 1 + step) % 12) + 1;
      out.push(month);
      if (month === end) break;
    }
    return out;
  };

  test("the range expander is real, or every reconciliation below is vacuous", () => {
    // Three arming claims: a plain range, a range that wraps the year end, and
    // a refusal — an expander that silently returned [] would make every
    // "all these months resolve to this season" assertion trivially true.
    expect(monthsIn("Mar – May")).toEqual([3, 4, 5]);
    expect(monthsIn("Dec – Feb")).toEqual([12, 1, 2]);
    expect(() => monthsIn("Sept – Nov")).toThrow(/short name/);
  });

  test("the two hemispheres really are opposite, or the fixtures prove nothing", () => {
    // JP and PE are the north/south pair every case below uses. If either
    // moved, the "north" and "south" columns could be identical and still pass.
    expect(getCountry("JP").hemisphere).toBe("north");
    expect(getCountry("PE").hemisphere).toBe("south");
    expect(getCountryBaseProfile("JP").seasonOfMonth(6)).toBe("summer");
    expect(getCountryBaseProfile("PE").seasonOfMonth(6)).toBe("winter");
    // The defect this file exists for, stated as a fact rather than as prose:
    // March is spring in Japan and autumn in Peru, and the old single-column
    // table captioned both Spring chips "Mar – May".
    expect(seasonMonths("spring", "north")).not.toBe(seasonMonths("spring", "south"));
    expect(seasonMonths("spring", "north")).toBe(seasonMonths("autumn", "south"));
  });

  const CASES = [
    { code: "JP", hemisphere: "north" as const },
    { code: "PE", hemisphere: "south" as const },
    // China's own answer must not move: it is northern, and the wizard's
    // captions for a China trip are the ones every existing screenshot shows.
    { code: "CN", hemisphere: "north" as const },
  ];

  test("every month a label names resolves to that season, and no month it omits does", () => {
    const violations: string[] = [];
    for (const { code, hemisphere } of CASES) {
      const { seasonOfMonth } = getCountryBaseProfile(code);
      for (const season of SEASONS) {
        const label = seasonMonths(season.id, hemisphere);
        const named = new Set(monthsIn(label));
        for (const month of MONTHS) {
          const resolved = seasonOfMonth(month.id);
          if (named.has(month.id) && resolved !== season.id) {
            violations.push(`${code}: "${label}" names ${month.short}, which is ${resolved}`);
          }
          if (!named.has(month.id) && resolved === season.id) {
            violations.push(`${code}: "${label}" omits ${month.short}, which is ${season.id}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("the four labels partition the year, so no month is captioned twice or never", () => {
    const violations: string[] = [];
    for (const hemisphere of ["north", "south"] as const) {
      const covered = SEASONS.flatMap((season) => monthsIn(seasonMonths(season.id, hemisphere)));
      if (covered.length !== 12) violations.push(`${hemisphere}: ${covered.length} months captioned`);
      if (new Set(covered).size !== 12) violations.push(`${hemisphere}: a month is captioned twice`);
    }
    expect(violations).toEqual([]);
  });

  test("an unrecognised code is captioned, not blanked", () => {
    // `getCountry` is total, so a code that is not a country answers "north".
    // The chips degrade to the northern calendar rather than to an empty line.
    const hemisphere = getCountry("\u{1f642}").hemisphere;
    expect(hemisphere).toBe("north");
    expect(seasonMonths("summer", hemisphere)).toBe("Jun – Aug");
  });

  test("SEASONS carries no months of its own for a renderer to reach for", () => {
    // The northern table was a FIELD here, and the fix is that it is gone
    // rather than corrected — the same move `KIND_EMOJI.travel` makes. A
    // reintroduced `months` key would compile against every existing call site
    // and silently caption the whole world from the northern hemisphere again.
    const keys = SEASONS.map((season) => Object.keys(season).sort().join(","));
    expect(keys).toEqual(["emoji,id,label", "emoji,id,label", "emoji,id,label", "emoji,id,label"]);
    const ids: Season[] = ["spring", "summer", "autumn", "winter"];
    expect(SEASONS.map((season) => season.id)).toEqual(ids);
  });
});
