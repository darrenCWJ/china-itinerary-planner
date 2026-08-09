import { randomBytes } from "node:crypto";

export function newTripId(): string {
  return randomBytes(5).toString("hex");
}

export function newJoinCode(): string {
  // Unambiguous uppercase alphabet (no 0/O/1/I).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
