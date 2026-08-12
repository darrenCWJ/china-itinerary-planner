import { randomBytes } from "node:crypto";

export function newTripId(): string {
  return randomBytes(5).toString("hex");
}

// Unambiguous uppercase alphabet (no 0/O/1/I).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function newJoinCode(): string {
  return randomCode(6);
}

/** Wallet codes are global bearer secrets, so they get more entropy. */
export function newWalletCode(): string {
  return randomCode(10);
}

/**
 * Briefing codes are the sole secret guarding a public URL, so they get more
 * entropy than a wallet code: 12 chars over a 32-symbol alphabet (~60 bits).
 */
export function newBriefingCode(): string {
  return randomCode(12);
}
