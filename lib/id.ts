/**
 * Short unique id, safe in both browser and Node. Falls back to a
 * time+random id where crypto.randomUUID is unavailable (e.g. plain-http
 * LAN testing, where the page is not a secure context).
 */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
