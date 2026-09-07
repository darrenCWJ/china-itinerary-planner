/**
 * ingest-country-facts — the pure parse: CSV, SPARQL bindings, entity ids.
 *
 * Moved out of scripts/ingest-country-facts.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-country-facts.mjs was
 * split along its section banners. Every describe below is that file's,
 * unchanged; only the import paths moved with them.
 *
 * No network call is made anywhere in this file. Every upstream answer is a
 * fixture.
 */

import { describe, expect, test } from "vitest";
import { entityId, parseBindings, parseCsv } from "./parse.mjs";

// ---------------------------------------------------------------------------
// parseCsv / parseBindings / entityId
// ---------------------------------------------------------------------------

describe("parseCsv", () => {
  test("splits plain rows and columns", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("keeps a comma inside a quoted field in one column", () => {
    // Not theoretical: P37 returns "Norwegian Bokmål, Nynorsk" and several
    // P498 currency names carry commas. A naive split shifts every later
    // column left by one, which the gate would read as a reshaped feed rather
    // than as a parse bug.
    expect(parseCsv('country,value\nNO,"Norwegian Bokmål, Nynorsk"\n')).toEqual([
      ["country", "value"],
      ["NO", "Norwegian Bokmål, Nynorsk"],
    ]);
  });

  test("unescapes a doubled quote and keeps an embedded newline inside the field", () => {
    expect(parseCsv('a\n"he said ""hi""\nand left"\n')).toEqual([["a"], ['he said "hi"\nand left']]);
  });

  test("treats CRLF the same as LF", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("returns nothing for an empty body", () => {
    expect(parseCsv("")).toEqual([]);
  });

  test("keeps a final record that has no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseBindings", () => {
  test("keys each row by the header line", () => {
    expect(parseBindings("country,value\nPE,right\n", ["country", "value"])).toEqual([
      { country: "PE", value: "right" },
    ]);
  });

  test("a header with no data rows is a legitimately empty answer", () => {
    expect(parseBindings("country,value\n", ["country"])).toEqual([]);
  });

  test("a body with no CSV header at all throws rather than reading as empty", () => {
    // The Task 7 shape. A rate-limit page or a truncated body arrives as
    // HTTP 200; reading it as "Wikidata knows nothing about 246 countries"
    // is what feeds a destructive merge.
    expect(() => parseBindings("", ["country"])).toThrow(/no CSV header/);
  });

  test("a response missing an expected column throws rather than filling it with blanks", () => {
    expect(() => parseBindings("country\nPE\n", ["country", "value"])).toThrow(/no "value" column/);
  });
});

describe("entityId", () => {
  test("takes the Q-id out of a full entity URI", () => {
    expect(entityId("http://www.wikidata.org/entity/Q60740126")).toBe("Q60740126");
  });

  test("passes a bare Q-id through", () => {
    expect(entityId("Q60740126")).toBe("Q60740126");
  });

  test("returns nothing for a value that carries no id", () => {
    expect(entityId("")).toBe("");
    expect(entityId("Europlug")).toBe("");
  });
});

