import { describe, expect, test } from "vitest";
import { checkAuthSecret } from "./authSecret";

// 32 random bytes, base64url — the shape the README tells you to generate.
const GOOD = "k3Nv8xQ2mR7pL0wZaB6tY4hJ1cF9sD5gE2uI8oP3nA0";

describe("checkAuthSecret", () => {
  test("a real secret passes, deployed or not", () => {
    expect(checkAuthSecret(GOOD, true)).toEqual({ ok: true });
    expect(checkAuthSecret(GOOD, false)).toEqual({ ok: true });
  });

  test("missing on a deployment is fatal", () => {
    const result = checkAuthSecret(undefined, true);
    expect(result).toMatchObject({ ok: false, fault: "missing", fatal: true });
  });

  test("missing locally is reported but not fatal (no-accounts mode)", () => {
    const result = checkAuthSecret(undefined, false);
    expect(result).toMatchObject({ ok: false, fault: "missing", fatal: false });
  });

  test("blank and whitespace count as missing", () => {
    expect(checkAuthSecret("", true)).toMatchObject({ fault: "missing" });
    expect(checkAuthSecret("   ", true)).toMatchObject({ fault: "missing" });
  });

  test("the secret from the plan docs is caught as a placeholder", () => {
    expect(checkAuthSecret("dev-secret-0123456789", true)).toMatchObject({
      fault: "placeholder",
      fatal: true,
    });
  });

  test("placeholders are caught regardless of case or padding length", () => {
    expect(checkAuthSecret("CHANGEME-changeme-changeme-changeme", true)).toMatchObject({
      fault: "placeholder",
    });
    // Better Auth's own default, long enough to clear the length floor.
    expect(checkAuthSecret("better-auth-secret-123456789", true)).toMatchObject({
      fault: "placeholder",
    });
  });

  test("short secrets are rejected on a deployment", () => {
    expect(checkAuthSecret("abc123", true)).toMatchObject({
      fault: "too-short",
      fatal: true,
    });
  });

  test("the failure message says what breaks and how to fix it", () => {
    const missing = checkAuthSecret(undefined, true);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.message).toContain("every page is public");
    expect(missing.message).toContain("randomBytes(32)");

    const weak = checkAuthSecret("abc123", true);
    if (weak.ok) return;
    expect(weak.message).toContain("forged");
  });
});
