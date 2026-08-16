/**
 * BETTER_AUTH_SECRET usability check.
 *
 * Missing the secret doesn't degrade gracefully — it fails *open*: the auth
 * routes 503 and, more importantly, lib/wall.ts turns the login wall off
 * entirely, so the whole site serves publicly. Locally that's the documented
 * no-accounts planning mode. On a deployment it's a silent data leak, so we
 * refuse to boot instead.
 */

export type SecretFault = "missing" | "too-short" | "placeholder";

export type SecretCheck =
  | { ok: true }
  | { ok: false; fault: SecretFault; fatal: boolean; message: string };

/**
 * 32 random bytes is 43 base64url characters. This floor sits well under that
 * so it rejects placeholders without dictating an encoding.
 */
const MIN_LENGTH = 24;

/** Substrings that mark a value as an example someone forgot to replace. */
const PLACEHOLDERS = [
  "dev-secret", // the value in docs/superpowers/plans/*.md
  "better-auth-secret", // Better Auth's own documented default
  "changeme",
  "change-me",
  "your-secret",
  "test-secret",
];

const GENERATE =
  'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"';

function fault(secret: string | undefined): SecretFault | null {
  const value = (secret ?? "").trim();
  if (!value) return "missing";
  const lowered = value.toLowerCase();
  if (PLACEHOLDERS.some((p) => lowered.includes(p))) return "placeholder";
  if (value.length < MIN_LENGTH) return "too-short";
  return null;
}

const REASON: Record<SecretFault, string> = {
  missing: "BETTER_AUTH_SECRET is not set",
  "too-short": `BETTER_AUTH_SECRET is shorter than ${MIN_LENGTH} characters`,
  placeholder: "BETTER_AUTH_SECRET still looks like an example value",
};

/**
 * `deployed` should be true for anything that isn't a developer's machine —
 * the caller passes `Boolean(process.env.VERCEL)`, the same deployment signal
 * lib/server/store.ts uses. Fatal results are meant to be thrown.
 */
export function checkAuthSecret(
  secret: string | undefined,
  deployed: boolean
): SecretCheck {
  const f = fault(secret);
  if (!f) return { ok: true };

  const consequence =
    f === "missing"
      ? "accounts are off and the login wall is disabled, so every page is public."
      : "session cookies are signed with a guessable key, so sessions can be forged.";

  return {
    ok: false,
    fault: f,
    fatal: deployed,
    message: `${REASON[f]} — ${consequence} ${GENERATE}`,
  };
}
