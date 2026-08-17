# Currency — PR4 Implementation Plan

**Date:** 2026-08-17 (rewritten same day after the user's rulings in §1)
**Spec:** `docs/superpowers/specs/2026-08-17-planner-redesign-design.md` §5.5 (authoritative on the pivot, but out of date — see §2), extended by the rulings in §1 which the spec does not cover
**Depends on:** PR2 and PR3 merged (this plan consumes `CountryProfile.currency`)
**Branch:** to be cut from `main` after PR3 merges — suggested `feature/currency`
**Stack:** Next.js 16 App Router · React 19 · TS strict · Tailwind v4 · vitest (node + jsdom projects)

---

## 0. Ground rules

**Verification loop after every task** (the tree must be green after each):

```
npm test
npx tsc --noEmit
npm run build
```

**Persisted-semantics rule.** Every task here touches data already in users' trips. `CurrencySettings.rates` means "pivot units per 1 unit of foreign currency"; `Expense.amount` and `Settlement.amount` are minor units. Both are persisted, un-versioned, and there is **no migration runner in either backend** (spec §5.4). No task reinterprets stored numbers. Where a meaning must change, the new meaning is recorded alongside the data and an absent field reads as the old meaning — the pattern `currencyPivot()` already uses.

**Test placement.** Pure arithmetic, formatting, and response parsing live in `lib/` with node tests. `MoneyTab` and the rates page get real jsdom component tests where behaviour is assertable (per the PR2 handoff §5.1 ruling).

**Network rule.** No task fetches a third-party URL from the browser. All upstream calls go through a server route so the upstream lives in one place and members' IPs never reach the provider.

---

## 1. User rulings, 2026-08-17 — these override the spec

1. **Amounts stay exactly as typed.** No task converts, rescales, or rewrites a stored expense amount.
2. **Hand-entered rates stay.** The existing converted-totals feature and its manual rate entry are *not* deleted. The live-rates page is **purely additive**.
3. **A new page shows today's conversion rate**, sourced live.
4. **Source: `open.er-api.com` primary, `fawazahmed0` via jsDelivr as outage fallback.** Chosen over Frankfurter (only 30 currencies — no TWD, no VND, no LAK/KHR/MMK — which contradicts the all-countries constraint; also returned a 522 during research) and over CDN-only (undocumented data source for a money-adjacent feature).
5. **The page shows the trip currency and the member's home currency** — not a 160-row table.
6. **Zero-decimal currencies are fixed in this PR** (§4).

---

## 2. ⚠ The spec's §5.5 is out of date — read before planning further

Spec §5.5 says `lib/money.ts:41` hardcodes CNY as the pivot. **It does not, anymore.** Inspected 2026-08-17:

| Spec §5.5 requirement | Actual state |
|---|---|
| Pivot as a parameter, not a constant | **Done** — `convertedTotals(totals, settings, pivot = "CNY")`, `lib/money.ts:48-52` |
| Existing trips read with explicit CNY, not reinterpreted | **Done** — trailing default documented at `lib/money.ts:43-46` |
| New trips record their pivot | **Half done** — `CurrencySettings.pivot?` (`lib/tripShared.ts:113-118`) and `currencyPivot()` (`:127-129`) exist; **nothing writes them** |
| Pivot sourced from `CountryProfile.currency` | **Field exists** (`lib/countryProfile.ts:40`), **no caller** |

The pure layer is built and tested (`lib/money.test.ts:139-146`). What is missing is that **the plumbing is entirely unused**:

- `components/trip/MoneyTab.tsx:52` calls `convertedTotals(totals, currencySettings)` with **no third argument** — every trip is priced in CNY regardless of persisted pivot.
- `MoneyTab.tsx:117` hardcodes `"Total CNY"` and `formatMinor(converted.cny, "CNY")`; `:118` compares `converted.home.currency !== "CNY"`.
- Nothing stamps `pivot`: `DEFAULT_CURRENCY_SETTINGS` (`lib/tripShared.ts:120`) has no such field, and neither store's read path (`lib/server/tripStore.ts:138`, `lib/server/pgStore.ts:261`) nor any create path sets one.

Because ruling 1.2 keeps hand-entered conversion, this is still a live bug and Tasks 5–8 still fix it.

---

## 3. ⚠ The two rulings collide — `convertedTotals` is not exponent-safe

**This is the highest-risk finding in the plan and it is not in the spec.**

Keeping hand-entered conversion (1.2) and fixing zero-decimal currencies (1.6) are individually fine and **together they break the conversion arithmetic.**

`lib/money.ts:62` reads:

```js
grandTotal += Math.round(t.amount * rate);
```

`t.amount` is in **minor units**. `rate` is a **major-unit** ratio (pivot majors per 1 foreign major). That works today only because *every* currency shares exponent 2 — the two factors of 100 cancel.

Make JPY exponent 0 and they stop cancelling. A ¥1,000 total becomes `amount = 1000`; at a rate of 0.0424 CNY per JPY, `grandTotal += 42` — read as CNY minor units, that is **¥0.42 instead of ¥42.40, wrong by 100×**. The same break applies to `home` at `:68`.

**Both must change together, in one task (Task 4), or the tree ships a silent 100× error on every mixed-exponent trip.** The fix is to normalise through major units:

```
contribution = amount / 10^exp(t.currency) * rate * 10^exp(pivot)
```

Task 4's tests must include a mixed-exponent case (JPY expense + CNY pivot) that fails before the change and passes after. A test with only exponent-2 currencies cannot detect this.

---

## 4. Tasks — Part A: zero-decimal currencies (do first)

### Task 1 — Minor-unit exponent table
- **Goal:** One authority on how many minor-unit digits a currency has. 0 for JPY, KRW, VND, IDR (and ISK, CLP, PYG, RWF, UGX, VUV, XAF, XOF, XPF, KMF, DJF, GNF); 2 otherwise. 3-digit currencies (BHD, JOD, KWD, OMR, TND) exist — decide explicitly whether to include them; recommendation: yes, the table costs nothing and omitting them bakes in a second wrong assumption.
- **Test first** (`lib/money.test.ts`): `minorUnitDigits("JPY") === 0`, `("CNY") === 2`, `("KWD") === 3`, and an unlisted code defaults to 2 (the ISO-4217 majority — an unknown currency must not throw, mirroring J-C4).
- **Files:** modify `lib/money.ts`.
- **Verify:** `npm test`, `npx tsc --noEmit`.

### Task 2 — `formatMinor` honours the exponent
- **Goal:** `formatMinor(1000, "JPY")` → `"¥1,000"` (no decimal point); `formatMinor(124050, "CNY")` → `"¥1,240.50"` unchanged.
- **Test first:** JPY renders with no separator and no cents; CNY/SGD/USD output is **byte-identical to today** (regression guard — every existing `formatMinor` assertion must still pass untouched); KWD renders 3 decimals.
- **Files:** modify `lib/money.ts`.
- **Verify:** `npm test`.

### Task 3 — `majorToMinor` honours the exponent
- **Goal:** `majorToMinor("1000", "JPY")` → `1000`, not `100000`. `majorToMinor("1000.50", "JPY")` → **null** (yen have no cents; rejecting is honest, silently flooring is not).
- **⚠ Signature change:** `majorToMinor(input)` gains a required `currency`. Find every caller first — the expense form and settlement form at minimum — and confirm each has a currency in scope at the call site. If any does not, that is a signal the form's currency selection needs threading before this task, not a reason to default the parameter.
- **Test first:** JPY integer accepted; JPY with decimals rejected; CNY behaviour byte-identical to today; the existing 1-to-100,000,000 bounds still enforced (note the bound is in minor units, so its *major* meaning shifts by currency — assert the intended bound explicitly rather than inheriting it).
- **Files:** modify `lib/money.ts`, plus each caller.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

### Task 4 — ⚠ Make `convertedTotals` exponent-safe (see §3)
- **Goal:** Conversion stays correct when the pivot and an expense currency have different exponents.
- **Test first — the mixed-exponent case is mandatory:** JPY expenses with a CNY pivot produce the arithmetically correct CNY total (compute the expected value by hand in the test, with the working in a comment); an all-exponent-2 trip produces **byte-identical results to today** (this is the guarantee that no existing trip's displayed totals move).
- **Files:** modify `lib/money.ts`.
- **Do not split this from Tasks 1–3.** Landing the exponent table without this is the 100× error in §3.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

---

## 5. Tasks — Part B: the live rates page

### Task 5 — Rate-response parsing (pure, TDD)
- **Goal:** Both providers' payloads normalise to one internal type, so the UI never branches on which source answered.
- **Shapes verified live 2026-08-17:**
  - er-api: `{ result: "success", provider, base_code: "CNY", rates: { USD: 0.148, ... }, time_last_update_utc, time_next_update_utc }` — **uppercase** codes
  - CDN: `{ date: "2026-08-17", cny: { usd: 0.148, ... } }` — **lowercase** codes, rates nested under the base-currency key
- **Test first** (`lib/rates.test.ts`), against committed fixtures of both real payloads: each parses to `{ base, rates: Record<UppercaseCode, number>, asOf, source }`; CDN codes are upcased; er-api's `result !== "success"` is rejected rather than trusted; a missing/NaN rate for a requested code yields absent, never `0` (a zero rate would render a wrong number instead of an honest gap); unknown extra keys are ignored, not rejected (a provider adding a currency must not break the page).
- **Files:** create `lib/rates.ts`, `lib/rates.test.ts`, `lib/data/rates-fixtures/*.json`.
- **Verify:** `npm test`, `npx tsc --noEmit`.

### Task 6 — Cached server route with fallback
- **Goal:** `GET /api/rates?base=XXX` returns the normalised shape, cached, with the CDN engaged only when er-api fails.
- **Behaviour:**
  - Fetch er-api first; on non-200, `result !== "success"`, timeout, or parse failure, try the CDN; if both fail return the last good cached value marked stale, and only if there is none return an error.
  - Cache with `next: { revalidate: 3600 }`. Upstream refreshes daily (`time_next_update_utc` in the payload) so hourly is well inside er-api's documented throttle guidance and honours "you may cache the data".
  - **Never proxy the raw upstream body** — return only the normalised object. er-api's terms forbid redistribution; echoing their payload verbatim through a public endpoint is closer to that line than returning our own derived shape.
  - Validate `base` against the known-code set before interpolating it into an upstream URL.
- **⚠ Wall interaction:** the proxy now **runs on `api/`** — the matcher exclusions for `api/`, `b/`, `login`, `signup` were deliberately removed in `0d35d20`. This route needs an authenticated member anyway, so it needs **no** wall exemption. Do not add one, and do not restore matcher exclusions to make it work.
- **Test first** (`lib/rates.test.ts` + a route test): primary success skips the fallback; primary failure uses the fallback; both failing yields stale-marked cache; an invalid `base` is rejected before any fetch.
- **Files:** create `app/api/rates/route.ts`; modify `lib/rates.ts`.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

### Task 7 — The rates page
- **Goal:** Show today's rate between **the trip's currency and the member's home currency** (ruling 1.5), both directions, with the as-of date.
- **Content:** the pair and its inverse; `asOf` shown plainly (the rate is up to 24h old and the page must not imply live-tick data); a stale-cache notice when Task 6 marks it stale; an honest empty state when the member has set no home currency (link to where they set it) or the trip's country has no researched currency; **the required attribution link** — `Rates By Exchange Rate API` → `https://www.exchangerate-api.com`, discreet but present, which er-api's terms require.
- **⚠ Judgement call J-C5 — currencies beyond the pair.** A trip can hold expenses in a currency that is neither the destination's nor home (a layover, a cross-border leg). Ruling 1.5 names only the two. **Recommendation: show the two as the headline pair, then any additional currency actually present in the trip's expenses beneath it.** Rationale: a member who spent in THB on the way to Tokyo needs that rate, and omitting it makes the page wrong-by-absence rather than merely focused. This is a small expansion of the ruling, flagged rather than smuggled — confirm before building.
- **⚠ Where it lives:** PR2 collapsed navigation to four tabs (`plan | today | money | kit`) and C1 makes `TRIP_NAV` the only tab declaration. **This page must not become a fifth tab.** Put it inside Money — a sub-view or disclosure — or as a route reached from Money. Adding to `TRIP_NAV` would breach C1 and the four-tab decision recorded in the spec.
- **Test** (`components/.../Rates.test.tsx`, jsdom): renders both directions for a known pair; shows the stale notice when flagged; shows the empty state with no home currency; **the attribution link is present** (a licence condition regressing silently is exactly what a test is for).
- **Files:** create the page/component; modify `components/trip/MoneyTab.tsx` to link it.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

---

## 6. Tasks — Part C: the unused pivot (the original §5.5 work)

### Task 8 — Stamp the pivot at trip creation
- **Goal:** A trip created for Japan persists `pivot: "JPY"`. Pre-existing trips persist nothing new and keep reading as CNY.
- **Test first** (`lib/tripShared.test.ts`): `initialCurrencySettings(countryCode)` returns `{ home: null, rates: {}, pivot }` from `getCountryProfile(code).currency`; `"CN"` → `"CNY"`; the result is never the shared `DEFAULT_CURRENCY_SETTINGS` reference (a mutated default would poison every later trip).
- **⚠ Judgement call J-C1 — do not stamp placeholder pivots.** `getCountryProfile` returns `currency: "USD"` as an admitted placeholder for unresearched countries (`lib/countryProfile.ts:193-197`, comment included). Stamping `"USD"` on a Vietnam trip persists a guess as a fact, which is worse than absent — absent at least reads as the documented legacy default. **Stamp only when the profile is researched**, which needs `countryProfile` to expose that (a `researched: boolean`, or `currency: string | null` on the fallback path; prefer the latter unless PR2 made `currency` load-bearing elsewhere — check first).
- **Files:** modify `lib/tripShared.ts`, `lib/countryProfile.ts`, and the trip-create path.
- **Verify:** `npm test`, `npx tsc --noEmit`.

### Task 9 — Thread the pivot through MoneyTab
- **Goal:** `MoneyTab` prices totals in the trip's own pivot instead of always CNY.
- **Test first** (`components/trip/MoneyTab.test.tsx`, jsdom): with `pivot: "JPY"` the totals row is labelled JPY; with no `pivot` it is labelled CNY (the legacy guarantee, asserted not assumed).
- **Files:** modify `components/trip/MoneyTab.tsx` — `:52` passes `currencyPivot(currencySettings)`; `:117` reads the pivot from `converted.pivot` (`lib/money.ts:32`) rather than recomputing, so label and arithmetic can never disagree; `:118` compares against the pivot.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

### Task 10 — Surface the pivot in the rates editor
- **Goal:** The currency-settings editor (`MoneyTab.tsx:234+`) states which currency the rates are against, so "5.2" is unambiguous.
- **⚠ Display-only.** Making the pivot editable can reprice a trip: switching it does not rescale saved rates, so CNY-relative rates under a JPY pivot render garbage. Options were (1) read-only text, (2) editable but clearing `rates` with confirmation, (3) editable preserving rates — **(3) is rejected outright**. **Take (1).** After Task 8 every trip needing a non-CNY pivot gets one at creation, so an editable path serves only pre-existing non-CN trips, of which there are none — the app has shipped CN-only.
- **Files:** modify `components/trip/MoneyTab.tsx`.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

### Task 11 — Retire the deprecated `cny` field
- **Goal:** `ConvertedTotals.cny` (`lib/money.ts:24-28`, already `@deprecated`, equal to `grandTotal`) goes once Task 9 is the last reader.
- **Test first:** replace the `c!.cny` assertions (`lib/money.test.ts:105,116,146`) with the `grandTotal` assertions they duplicate, so coverage does not drop.
- **Guard:** `grep -rn "\.cny\b" --include=*.ts --include=*.tsx` returns nothing before this lands.
- **Files:** modify `lib/money.ts`, `lib/money.test.ts`.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

### Task 12 — Currency symbols beyond the CN-era set
- **Goal:** A Japan trip renders `¥1,240`, not `JPY 1240`.
- **Context:** `SYMBOLS` (`lib/money.ts:72-81`) covers CNY, SGD, USD, EUR, GBP, HKD, TWD, MYR — the CN-trip neighbourhood. `formatMinor` already falls back to `"CODE 1,240.50"`, so this is polish, not correctness.
- **⚠ Symbol collision:** `¥` is both CNY and JPY, and `$` is shared by many. **Disambiguate as `CN¥` / `JP¥` only when both appear in the same displayed set**, plain `¥` otherwise. That makes symbol choice depend on context, so it moves out of the flat map into a function over the set of currencies being rendered.
- **Test first:** JPY alone → `¥`; JPY with CNY → `JP¥` and `CN¥`; unlisted code still falls back to the code form.
- **Files:** modify `lib/money.ts`.
- **Verify:** `npm test`, `npx tsc --noEmit`.

---

## 7. Judgement calls

- **J-C1** — placeholder pivots are not stamped (Task 8).
- **J-C2 — ~~nothing fetches exchange rates~~ — OVERRIDDEN by ruling 1.3.** Live rates are now in scope, but **read-only and display-only**: the fetched rate never writes to a trip, never feeds `convertedTotals`, and never alters a stored amount. Hand-entered rates remain the only input to conversion arithmetic. Keeping the two paths separate is what stops a provider outage from changing anyone's totals.
- **J-C3 — split arithmetic is untouched.** `splitMinorUnits`, `balancesByCurrency`, `settleUp` are per-currency and pivot-independent. Tasks 1–4 change what a JPY minor unit *is*, not how it divides.
- **J-C4 — the unlisted-currency fallbacks stay.** `formatMinor` renders `"XYZ 1,240.50"` and `minorUnitDigits` defaults to 2 rather than throwing. That is what lets an unresearched country be priced at all.
- **J-C5** — currencies beyond the trip/home pair on the rates page (Task 7). Recommendation: include those present in expenses. **Unconfirmed.**

---

## 8. Sequencing

**Part A (Tasks 1–4) goes first and lands as one unit** — §3 is why. Its safety is a function of timing: it is free while no non-CNY trip exists and expensive afterwards, since JPY expenses would split into pre-fix and post-fix magnitudes with no field distinguishing them and no migration runner to repair them. **If this PR slips, extract Part A and land it alone.**

Part B (5–7) is independent of Part A and could run in parallel on a separate branch; it touches no persisted data.

Part C (8–12) is the original §5.5 work: 8→9 are the deliverable, 10 is small UI, 11 is cleanup gated on 9, 12 is polish.

A defensible minimum PR4 is **Part A complete, plus Tasks 5, 6, 7, 9**: exponents correct, rates page live, pivot honoured.
