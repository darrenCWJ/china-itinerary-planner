import { describe, expect, test } from "vitest";
import { wallDecision } from "./wall";

const base = { hasCode: false, hasSessionCookie: false, accountsConfigured: true };

describe("wallDecision", () => {
  test("signed-out app pages redirect", () => {
    expect(wallDecision({ ...base, pathname: "/" })).toBe("redirect");
    expect(wallDecision({ ...base, pathname: "/plan" })).toBe("redirect");
    expect(wallDecision({ ...base, pathname: "/account" })).toBe("redirect");
    expect(wallDecision({ ...base, pathname: "/trip/abc123" })).toBe("redirect");
  });

  test("auth pages are exempt", () => {
    expect(wallDecision({ ...base, pathname: "/login" })).toBe("pass");
    expect(wallDecision({ ...base, pathname: "/signup" })).toBe("pass");
  });

  test("briefing pages are exempt", () => {
    expect(wallDecision({ ...base, pathname: "/b/somecode" })).toBe("pass");
  });

  test("trip links with a code pass (guest view)", () => {
    expect(wallDecision({ ...base, pathname: "/trip/abc123", hasCode: true })).toBe("pass");
    // A code on a non-trip path does not open other pages.
    expect(wallDecision({ ...base, pathname: "/account", hasCode: true })).toBe("redirect");
  });

  test("api routes are never walled (defense in depth vs matcher)", () => {
    expect(wallDecision({ ...base, pathname: "/api/trips/abc" })).toBe("pass");
  });

  test("a session cookie passes everything", () => {
    expect(wallDecision({ ...base, pathname: "/", hasSessionCookie: true })).toBe("pass");
    expect(wallDecision({ ...base, pathname: "/trip/abc123", hasSessionCookie: true })).toBe("pass");
  });

  test("accounts unconfigured turns the wall off", () => {
    expect(wallDecision({ ...base, pathname: "/", accountsConfigured: false })).toBe("pass");
    expect(wallDecision({ ...base, pathname: "/trip/abc123", accountsConfigured: false })).toBe("pass");
  });

  test("an unusable secret on a deployment refuses every path", () => {
    // The fail-open case this exists to kill: accountsConfigured is false
    // precisely *because* the secret is missing, so every rule below would
    // otherwise pass. Nothing is exempt — not the wall's own destination,
    // not the bearer-secret briefing links, not the self-enforcing API.
    const dead = { ...base, accountsConfigured: false, secretFatal: true };
    for (const pathname of [
      "/",
      "/plan",
      "/account",
      "/trip/abc123",
      "/login",
      "/signup",
      "/b/somecode",
      "/api/trips/abc",
    ]) {
      expect(wallDecision({ ...dead, pathname })).toBe("refuse");
    }
  });

  test("a session cookie or guest code cannot get past a fatal secret", () => {
    const dead = { ...base, accountsConfigured: false, secretFatal: true };
    expect(wallDecision({ ...dead, pathname: "/", hasSessionCookie: true })).toBe("refuse");
    expect(wallDecision({ ...dead, pathname: "/trip/abc123", hasCode: true })).toBe("refuse");
  });

  test("secretFatal is what refuses — not merely having accounts off", () => {
    // Local no-accounts planning mode must keep working: same unconfigured
    // state, but not a deployment, so the fault is non-fatal.
    expect(
      wallDecision({ ...base, pathname: "/", accountsConfigured: false, secretFatal: false })
    ).toBe("pass");
  });
});

describe("wallDecision — the city shards", () => {
  const signedOut = {
    hasCode: false,
    hasSessionCookie: false,
    accountsConfigured: true,
  };

  test("a city shard sits behind the wall, exactly like the topology assets", () => {
    // Deliberate, not an oversight. The picker only renders on /plan, which
    // needs a session anyway, and RouteMap — the one map a guest can reach —
    // fetches no cities at all. Exempting /cities/ would publish 6.5 MB of
    // data outside the wall for no user-visible gain.
    expect(wallDecision({ ...signedOut, pathname: "/cities/PE.json" })).toBe("redirect");
    expect(wallDecision({ ...signedOut, pathname: "/cities/index.json" })).toBe("redirect");
    expect(wallDecision({ ...signedOut, pathname: "/cities/enrich/PE.json" })).toBe("redirect");
    // The same answer the assets that already work give.
    expect(wallDecision({ ...signedOut, pathname: "/world-globe.json" })).toBe("redirect");
  });

  test("a signed-in visitor gets the shard", () => {
    expect(
      wallDecision({ ...signedOut, hasSessionCookie: true, pathname: "/cities/PE.json" })
    ).toBe("pass");
  });

  test("the enrichment route self-enforces like every other api route", () => {
    expect(wallDecision({ ...signedOut, pathname: "/api/cities/enrich" })).toBe("pass");
  });
});
