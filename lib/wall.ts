export interface WallInput {
  pathname: string;
  /** True when the request URL carries a ?code= param (guest link). */
  hasCode: boolean;
  hasSessionCookie: boolean;
  /** False when BETTER_AUTH_SECRET is unset — the wall turns off entirely. */
  accountsConfigured: boolean;
  /**
   * True when the secret is unusable *and* this is a deployment — see
   * checkAuthSecret's `fatal`. Local no-accounts planning leaves it false.
   */
  secretFatal?: boolean;
}

export type WallDecision = "pass" | "redirect" | "refuse";

/**
 * The compulsory-login wall, as a pure decision. Optimistic only: a cookie's
 * presence is enough to pass — real enforcement lives in the per-route
 * session gates. "redirect" means send the visitor to /login; "refuse" means
 * serve nothing at all.
 */
export function wallDecision(input: WallInput): WallDecision {
  // First, and exempting nothing. A deployment missing its secret can't
  // enforce anything: `accountsConfigured` is false for the same reason, so
  // every rule below would wave the request through and the site would serve
  // publicly. instrumentation.ts can't catch this on its own — prerendered
  // routes are answered from the CDN without ever booting a server — so the
  // refusal has to happen here, in the one place every request passes.
  if (input.secretFatal) return "refuse";

  if (!input.accountsConfigured) return "pass";
  if (input.hasSessionCookie) return "pass";
  const p = input.pathname;
  if (p === "/login" || p === "/signup") return "pass";
  if (p.startsWith("/b/")) return "pass";
  if (p.startsWith("/api/")) return "pass"; // routes self-enforce
  if (p.startsWith("/trip/") && input.hasCode) return "pass"; // guest link view
  return "redirect";
}
