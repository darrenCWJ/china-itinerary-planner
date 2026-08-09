import { describe, expect, test } from "vitest";
import { accessToken, safeEqual, safeNextPath } from "./access";

describe("accessToken", () => {
  test("is deterministic for the same code and differs across codes", async () => {
    const a1 = await accessToken("panda2026");
    const a2 = await accessToken("panda2026");
    const b = await accessToken("other-code");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).toMatch(/^[0-9a-f]{64}$/);
  });

  test("never contains the raw code", async () => {
    const token = await accessToken("secretcode");
    expect(token).not.toContain("secretcode");
  });
});

describe("safeEqual", () => {
  test("matches equal strings and rejects different ones", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("safeNextPath", () => {
  test("allows same-origin relative paths only", () => {
    expect(safeNextPath("/trip/abc?code=X")).toBe("/trip/abc?code=X");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
  });
});
