import { describe, expect, test } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  test("a bare quote mid-field is literal content, not a quote-open", () => {
    // Reviewer's repro: a stray `"` after the first character of a field
    // must not enter quoted mode — otherwise it swallows the rest of the
    // input (commas and newlines alike) as literal text until another `"`
    // happens to re-sync the scanner, silently merging rows together.
    expect(parseCsv('ab"cd,ef\n')).toEqual([['ab"cd', "ef"]]);
  });

  test("a quoted field may contain a comma", () => {
    expect(parseCsv('"a,b",c\n')).toEqual([["a,b", "c"]]);
  });

  test("a doubled quote inside a quoted field is one literal quote", () => {
    expect(parseCsv('"a""b",c\n')).toEqual([['a"b', "c"]]);
  });

  test("a quoted field may contain a newline", () => {
    expect(parseCsv('"a\nb",c\n')).toEqual([["a\nb", "c"]]);
  });

  test("an empty quoted field yields an empty cell", () => {
    expect(parseCsv('"",b\n')).toEqual([["", "b"]]);
  });

  test("a final row with no trailing newline is still returned", () => {
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
  });

  test("CRLF line endings do not leave a stray \\r in the cell", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});
