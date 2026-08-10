import { describe, expect, test } from "vitest";
import {
  bandsForMonth,
  crowdForMonth,
  highlightFor,
  MONTHS,
  monthFitForSeasons,
  REGION_MONTHS,
  seasonOfMonth,
} from "./months";
import type { Region } from "./types";

describe("seasonOfMonth", () => {
  test("maps month boundaries to the right seasons", () => {
    expect(seasonOfMonth(1)).toBe("winter");
    expect(seasonOfMonth(2)).toBe("winter");
    expect(seasonOfMonth(3)).toBe("spring");
    expect(seasonOfMonth(5)).toBe("spring");
    expect(seasonOfMonth(6)).toBe("summer");
    expect(seasonOfMonth(8)).toBe("summer");
    expect(seasonOfMonth(9)).toBe("autumn");
    expect(seasonOfMonth(11)).toBe("autumn");
    expect(seasonOfMonth(12)).toBe("winter");
  });

  test("MONTHS table agrees with seasonOfMonth", () => {
    for (const m of MONTHS) {
      expect(m.season).toBe(seasonOfMonth(m.id));
    }
  });
});

describe("monthFitForSeasons", () => {
  test("returns great for a best-season month", () => {
    expect(monthFitForSeasons({ bestSeasons: ["autumn"] }, 10)).toBe("great");
  });

  test("avoid wins over best when both match", () => {
    expect(
      monthFitForSeasons({ bestSeasons: ["summer"], avoidSeasons: ["summer"] }, 7)
    ).toBe("avoid");
  });

  test("falls back to ok otherwise", () => {
    expect(monthFitForSeasons({ bestSeasons: ["spring"] }, 12)).toBe("ok");
  });
});

describe("holiday bands and crowds", () => {
  test("Golden Week overlaps October only", () => {
    const oct = bandsForMonth(10).map((b) => b.name);
    expect(oct).toContain("National Day Golden Week");
    const nov = bandsForMonth(11).map((b) => b.name);
    expect(nov).not.toContain("National Day Golden Week");
  });

  test("Chinese New Year spans January and February", () => {
    expect(bandsForMonth(1).map((b) => b.name)).toContain("Chinese New Year");
    expect(bandsForMonth(2).map((b) => b.name)).toContain("Chinese New Year");
  });

  test("crowd levels stay in the 1–5 range for all months", () => {
    for (let m = 1; m <= 12; m++) {
      expect(crowdForMonth(m)).toBeGreaterThanOrEqual(1);
      expect(crowdForMonth(m)).toBeLessThanOrEqual(5);
    }
  });
});

describe("REGION_MONTHS climate table", () => {
  const regions: Region[] = [
    "North",
    "Northeast",
    "Northwest",
    "East",
    "South",
    "Southwest",
    "Central",
  ];

  test("every region has 12 months with sane temperature ranges", () => {
    for (const region of regions) {
      const rows = REGION_MONTHS[region];
      expect(rows).toHaveLength(12);
      for (const row of rows) {
        expect(row.lo).toBeLessThan(row.hi);
        expect(row.lo).toBeGreaterThan(-40);
        expect(row.hi).toBeLessThan(45);
      }
    }
  });

  test("Harbin winter is flagged as ice-festival season", () => {
    expect(REGION_MONTHS.Northeast[0].note).toMatch(/Ice Festival/i);
  });
});

describe("highlightFor", () => {
  test("returns curated monthly highlights when present", () => {
    expect(highlightFor("harbin", 1)).toMatch(/Ice/);
    expect(highlightFor("harbin", 5)).toBeUndefined();
    expect(highlightFor("not-a-dest", 1)).toBeUndefined();
  });
});
