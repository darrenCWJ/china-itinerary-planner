import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import type { Catalog, CatalogCity } from "./catalog";

/**
 * The server leg of place search, which `searchCities` owns and nothing tested.
 *
 * A fixture rather than the real 1MB catalog: the point is which *spellings*
 * match, and stating the corpus in the test is what makes an empty result mean
 * something. Pointed at through `CIP_CATALOG_PATH`, the same override
 * `CIP_DB_PATH` gives the store.
 */

const city = (over: Partial<CatalogCity> & Pick<CatalogCity, "qid" | "name">): CatalogCity => ({
  chineseName: null,
  province: "Shandong",
  lat: 36.6,
  lon: 117.0,
  population: 7_000_000,
  description: null,
  interests: [],
  image: null,
  level: "prefecture",
  ...over,
});

const FIXTURE: Catalog = {
  generatedAt: "2026-08-21",
  source: "fixture",
  cities: [
    // Real spellings from data/catalog.json, where 23 of 695 city names carry an
    // apostrophe and 2 carry diacritics. The person searching types neither.
    city({ qid: "Q1", name: "Tai'an" }),
    city({ qid: "Q2", name: "Ma'anshan", province: "Anhui" }),
    city({ qid: "Q3", name: "Ürümqi", province: "Xinjiang" }),
    // Synthetic: the curly apostrophe a paste from Wikipedia carries. Not in the
    // catalog today, which is exactly why the fold should already handle it.
    city({ qid: "Q4", name: "Huai’an", province: "Jiangsu" }),
    // A control that must never match the queries below.
    city({ qid: "Q5", name: "Luoyang", province: "Henan" }),
  ],
  attractions: [],
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cip-catalog-"));
const fixturePath = path.join(dir, "catalog.json");
fs.writeFileSync(fixturePath, JSON.stringify(FIXTURE), "utf8");
process.env.CIP_CATALOG_PATH = fixturePath;

// Imported after the override so the loader reads the fixture, not data/.
const { searchCities } = await import("./catalog");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const names = (q: string) => searchCities(q).map((h) => h.name);

describe("searchCities — folding", () => {
  test("finds an apostrophe name from a query without one", () => {
    // The bug §5d fixed on the client and left standing here: the server leg
    // compared raw lowercase, so "taian" never reached "Tai'an". Anyone whose
    // search went through /api/destinations got the broken half.
    expect(names("taian")).toContain("Tai'an");
    expect(names("maanshan")).toContain("Ma'anshan");
  });

  test("treats a curly apostrophe as the same character", () => {
    expect(names("huaian")).toContain("Huai’an");
  });

  test("finds a diacritic name from an unaccented query", () => {
    expect(names("urumqi")).toContain("Ürümqi");
  });

  test("still matches what it always matched, and nothing more", () => {
    // Folding widens what counts as equal; it must not widen what counts as a
    // match. Luoyang shares no prefix or substring with these queries.
    expect(names("luoyang")).toEqual(["Luoyang"]);
    expect(names("taian")).not.toContain("Luoyang");
    expect(names("zzzz")).toEqual([]);
  });
});
