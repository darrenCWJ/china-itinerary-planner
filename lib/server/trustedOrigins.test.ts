import { describe, expect, test } from "vitest";
import { trustedOriginsFrom } from "./trustedOrigins";

describe("trustedOriginsFrom", () => {
  test("nothing configured trusts nothing beyond the base URL", () => {
    expect(trustedOriginsFrom({})).toEqual([]);
    expect(trustedOriginsFrom({ TRUSTED_ORIGINS: "", VERCEL_URL: "  " })).toEqual([]);
  });

  test("the manual list is split, trimmed and kept verbatim — wildcards included", () => {
    expect(
      trustedOriginsFrom({ TRUSTED_ORIGINS: " https://a.example, ,https://*.preview.example " })
    ).toEqual(["https://a.example", "https://*.preview.example"]);
  });

  test("each Vercel host becomes an https origin", () => {
    expect(
      trustedOriginsFrom({
        VERCEL_URL: "cip-abc123-team.vercel.app",
        VERCEL_BRANCH_URL: "cip-git-main-team.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "cip.vercel.app",
      })
    ).toEqual([
      "https://cip-abc123-team.vercel.app",
      "https://cip-git-main-team.vercel.app",
      "https://cip.vercel.app",
    ]);
  });

  test("a host given with a scheme or a path is reduced to its origin", () => {
    expect(trustedOriginsFrom({ VERCEL_URL: "https://cip.vercel.app/" })).toEqual([
      "https://cip.vercel.app",
    ]);
    expect(trustedOriginsFrom({ VERCEL_BRANCH_URL: "http://cip.vercel.app/login?x=1" })).toEqual([
      "https://cip.vercel.app",
    ]);
  });

  test("duplicates collapse, the manual list first", () => {
    expect(
      trustedOriginsFrom({
        TRUSTED_ORIGINS: "https://cip.vercel.app",
        VERCEL_URL: "cip.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "cip.vercel.app",
      })
    ).toEqual(["https://cip.vercel.app"]);
  });
});
