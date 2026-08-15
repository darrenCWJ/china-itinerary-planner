export interface WallInput {
  pathname: string;
  /** True when the request URL carries a ?code= param (guest link). */
  hasCode: boolean;
  hasSessionCookie: boolean;
  /** False when BETTER_AUTH_SECRET is unset — the wall turns off entirely. */
  accountsConfigured: boolean;
}

/**
 * The compulsory-login wall, as a pure decision. Optimistic only: a cookie's
 * presence is enough to pass — real enforcement lives in the per-route
 * session gates. "redirect" means send the visitor to /login.
 */
export function wallDecision(input: WallInput): "pass" | "redirect" {
  if (!input.accountsConfigured) return "pass";
  if (input.hasSessionCookie) return "pass";
  const p = input.pathname;
  if (p === "/login" || p === "/signup") return "pass";
  if (p.startsWith("/b/")) return "pass";
  if (p.startsWith("/api/")) return "pass"; // routes self-enforce
  if (p.startsWith("/trip/") && input.hasCode) return "pass"; // guest link view
  return "redirect";
}
