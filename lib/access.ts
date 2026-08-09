/**
 * Site-wide access-code gate. Edge-safe: uses only Web Crypto so it can run
 * in middleware and Node route handlers alike. Enabled by setting the
 * ACCESS_CODE environment variable; when unset the app is open.
 */

export const ACCESS_COOKIE = "cip-access";
export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

let cachedFor: string | null = null;
let cachedToken: string | null = null;

/** Derives the cookie token from the access code (never store the code itself). */
export async function accessToken(code: string): Promise<string> {
  if (cachedFor !== code || cachedToken === null) {
    const bytes = new TextEncoder().encode(`cip-access-v1:${code}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    cachedToken = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    cachedFor = code;
  }
  return cachedToken;
}

/** Constant-time string comparison so code guesses can't be timed. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Only allow same-origin relative redirect targets (no open redirects). */
export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}
