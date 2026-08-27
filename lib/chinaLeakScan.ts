/**
 * The instrument the Peru acceptance gate is measured with (T30).
 *
 * A zero-import leaf, shared by `lib/worldwidePlan.test.ts` (node) and
 * `components/plan/worldwidePlan.test.tsx` (jsdom) so the two halves of the
 * gate cannot drift into scanning for different things. A plain module rather
 * than an export out of one of those suites, for the reason `lib/tripFixtures.ts`
 * documents: importing from a `.test.ts` re-runs that file's `describe` blocks
 * wherever it lands, and these two files run in different vitest projects.
 *
 * **Everything here is one-directional on its own, and that is the danger.**
 * A token list with a typo in it, a regex that never compiles, a scan handed an
 * empty string — each of those silently matches nothing and passes forever. So
 * neither consumer may use `chinaLeaks` without also running it against a real
 * *China* plan and asserting that it reports leaks. That arming proof is the
 * only thing that distinguishes a clean Peru plan from a broken scanner.
 */

/**
 * What must never appear in a plan for a country that is not China.
 *
 * Every one of these is a real string this repo emits for CN — see
 * `lib/countryData/cn.ts`, which holds all of them between its tips, its
 * packing document, its booking copy and its hop titles. That is deliberate:
 * a token nothing in the codebase can produce would make the arming proof
 * below impossible to satisfy honestly.
 */
export const CHINA_TOKENS = [
  "China",
  "Chinese",
  "Alipay",
  "WeChat",
  "VPN",
  "RMB",
  "¥",
  "12306",
  "Trip.com",
  "Amap",
  "Pleco",
  "高德",
  "high-speed rail",
  "🚄",
  "🧧",
  "🇨🇳",
] as const;

/**
 * CJK Unified Ideographs — the `[一-鿿]` range T30 names, spelled in escapes so
 * the source stays reviewable in an editor that cannot render the block.
 *
 * `U+4E00`–`U+9FFF`. Deliberately not the extension blocks or kana: the claim
 * is "no Chinese text reached this plan", and the base block is what every
 * string in `cn.ts` is written in.
 */
export const CJK_IDEOGRAPH = /[一-鿿]/gu;

/**
 * Every China marker present in `text`, distinct and in a stable order.
 *
 * Returns the markers rather than a boolean so a failure names what leaked
 * instead of only that something did — `expect(chinaLeaks(t)).toEqual([])`
 * prints the offending token, which is the difference between a five-minute
 * fix and a bisect.
 *
 * **Token matching is case-insensitive.** `CN_HOP_TITLE` is
 * "High-speed rail or flight to {city}" — capital H — so a case-sensitive scan
 * for "high-speed rail" would miss the single most likely thing to leak into a
 * Peruvian itinerary. Insensitivity is strictly stronger here and costs
 * nothing: no Peruvian city, currency, language or emergency number in the
 * committed artifacts contains any of these tokens in any casing.
 *
 * CJK characters are reported one per distinct codepoint, so a mixed leak
 * ("同行", "启程") is legible rather than collapsed into one "CJK" line.
 */
export function chinaLeaks(text: string): string[] {
  const haystack = text.toLowerCase();
  const tokens = CHINA_TOKENS.filter((token) => haystack.includes(token.toLowerCase()));
  // A fresh matcher each call. `CJK_IDEOGRAPH` is /g, and a shared `lastIndex`
  // would make the second scan of the same string answer differently from the
  // first — the exact shape of a scan that passes for the wrong reason.
  const ideographs = new Set(text.match(new RegExp(CJK_IDEOGRAPH)) ?? []);
  return [...tokens, ...ideographs];
}

/**
 * What a Peru plan must actually SAY, so an empty plan cannot pass the scan
 * above by having nothing in it to leak.
 *
 * Case-sensitive, and each one traces to a committed artifact rather than to a
 * sentence invented for this test:
 *
 * - `PEN`   — `data/country-facts.json` → `PE.currencyCode`, rendered by
 *             `currencyTip` and `cashBackupItem`. Lowercase would match "open".
 * - `220`   — `PE.voltageV`, rendered by `socketsTip` and `powerAdapterItem`.
 * - `type A`— `PE.plugs` `["A","B","C"]`, rendered by `socketsTip`.
 * - `105`   — `PE.emergency`, the police number, rendered by `emergencyTip`.
 * - `+51`   — `PE.callingCode`, rendered by `roadAndDiallingTip`.
 * - `Spanish` — one of `PE.officialLanguages`, rendered by `languageTip`.
 */
export const PERU_TOKENS = ["PEN", "220", "type A", "105", "+51", "Spanish"] as const;

/** Every Peru marker missing from `text`. Empty means the plan said all of them. */
export function peruMisses(text: string): string[] {
  return PERU_TOKENS.filter((token) => !text.includes(token));
}
