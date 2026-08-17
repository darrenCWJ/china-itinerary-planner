# Day Builder — invariants and traps

**Date:** 2026-08-18
**Status:** input to PR2 Tasks 22-25. Produced by a five-lens analysis (reflow
semantics, poll-gate hazard, legacy data, plan-ops surface, shelf/target routing)
run against the real code, then merged and re-verified.

Read this before Task 22. Several entries **contradict the plan's own task
brief** — where they do, they say so, and they were verified by running the code.
The plan's line citations for `lib/server/schemas.ts` are all wrong (PR1 inserted
the timing sub-schemas and shifted everything down); navigate by symbol, not line.

Task 21 has already landed (`lib/timeline.ts`, commit ff63963). Its committed
semantics are the authority, not the plan's description of them: `reflow(items)`
takes **no anchor argument**, `pushedBy` names the **immediate predecessor**, and
a push past midnight clamps to 1439 with `overflows: true`.

---

## Invariants

### reflow-output-is-never-persisted  
**Risk: high**

Reducer state stays `ScheduledItem[]` carrying raw stored starts. `reflow()` is called only at read/selector time, and the reducer emits `setTiming` ONLY for the block the user acted on — never for a block carrying `pushedBy`, and never by diffing reflow output against stored values.

*Why it matters:* `reflow(items)` takes no anchor argument. It is a pure cursor pass that normalises EVERY overlap it finds, including overlaps that were already in storage when the page loaded. Diffing its output into ops therefore emits `setTiming` for blocks another member owns the moment a member merely opens the trip — the concurrent-member-edit loss spec §5.4 forbids. It also breaks the engine's own pinned `un-pushes when the block above shrinks back` behaviour, which only works because B's stored start is left at its original value.

*Test:* days[1].items = [A{startMinutes:540,durationMinutes:60}, B{startMinutes:600,durationMinutes:60}]; adjustTiming('A',+60) → emitted ops === [{op:'setTiming',day:2,itemId:'A',startMinutes:540,durationMinutes:120}] (length 1, nothing naming B); state.days[1].items[1].startMinutes === 600 while reflow(state.days[1].items)[1] reports startMinutes 660 and pushedBy 'A'. Separately: applying a payload whose day already contains two overlapping blocks and dispatching no edit emits ZERO ops.

*Grounded in:* lib/timeline.ts:60-87 (signature `reflow(items)`, cursor-based, no anchor); lib/timeline.ts:31-33 ("Derived per reflow and never persisted — it is a presentation fact"); lib/timeline.test.ts:83-92 (un-push depends on stored starts being untouched); spec §5.4 lines 405-416

---

### never-emit-a-half-block  
**Risk: high**

Every emitted timing pair is both numbers or both null. `{startMinutes: 540, durationMinutes: null}` and its mirror must never be emitted, because the server accepts them.

*Why it matters:* VERIFIED EMPIRICALLY, and the schema's own comment is wrong: `startMinutes` and `durationMinutes` on `setTiming` are `.nullable()` independently, so `{op:'setTiming',day:1,itemId:'a',startMinutes:540,durationMinutes:null}` parses, and `patchTiming` stores `{startMinutes:540}` with no duration. The engine's private `isTimed` then reads that item as untimed, so the user's block silently disappears from the timeline and contributes 0 to the day-load readout. A lost edit with no error anywhere.

*Test:* Property test over every op the reducer emits: for setTiming/updateItem, `(op.startMinutes === null) === (op.durationMinutes === null)`. Pin the server hole so nobody relies on it: `PlanOpSchema.safeParse({op:'setTiming',day:1,itemId:'a',startMinutes:540,durationMinutes:null}).success === true`, then `applyPlanOp` on it yields `{startMinutes:540}` with no `durationMinutes`, and `dayLoad([thatItem]).plannedMinutes === 0`.

*Grounded in:* lib/server/schemas.ts:106-114 (comment at :110-111 claims the opposite); lib/planOps.ts:60-65 patchTiming; lib/timeline.ts:49-58 isTimed; lib/server/schemas.test.ts:231-234 only covers the omitted-key case

---

### settiming-must-carry-both-keys  
**Risk: high**

`setTiming` requires both `startMinutes` and `durationMinutes` to be PRESENT (they are `.nullable()` but not `.optional()`). A ±15m duration change must resend the item's current `startMinutes` alongside the new duration.

*Why it matters:* Omitting either key fails zod, the POST 400s with only "Invalid edit" (the zod `details` are discarded by `extractMutationError`), and `mutate` force-refetches — so the ±15m tap does nothing while local state shows it applied, and the forced refetch can wipe other in-progress local edits.

*Test:* `PlanOpSchema.safeParse({op:'setTiming',day:1,itemId:'a',startMinutes:540}).success === false` (verified). adjustTiming on `{id:'x',startMinutes:540,durationMinutes:60}` by +15 emits `{op:'setTiming',day,itemId:'x',startMinutes:540,durationMinutes:75}` with both keys present and neither undefined.

*Grounded in:* lib/server/schemas.ts:112-113; app/api/trips/[id]/plan/route.ts:31-37; lib/tripPayloadCore.ts:95-98 (details discarded); lib/useTripPayload.ts:138-141

---

### add-is-exactly-one-addItem-op  
**Risk: high**

A shelf add or custom add emits exactly ONE `addItem` op, carrying `slot` and (if timed) `startMinutes`/`durationMinutes` inline. It never emits `addItem` then `setTiming`, and never invents a client-side item id.

*Why it matters:* The item id is minted server-side by `ctx.newId()` and the plan route's 200 response is the whole refreshed payload with no created-item id. A follow-up `setTiming` has no `itemId` to name — it 400s with "That item no longer exists", or, if the reducer guesses by title, it overwrites the wrong item's block the moment the day holds two items with that title. Task 22's brief specifies the two-op sequence, so a literal implementation ships a builder where every newly added block loses its time.

*Test:* addFromShelf({name:'Great Wall at Mutianyu', startMinutes:540, durationMinutes:480}) with targetDay=2 → emitted ops === [{op:'addItem',day:2,title:'Great Wall at Mutianyu',slot:'morning',startMinutes:540,durationMinutes:480}]; assert length 1 and that no emitted op has an `itemId` the reducer generated.

*Grounded in:* lib/planOps.ts:96-107 (`id: ctx.newId()`); app/api/trips/[id]/plan/route.ts:50-53, :64-65 (returns payload, no id); lib/planOps.ts:129-130; lib/server/schemas.ts:92-93 (addItem timing inline, optional, non-nullable)

---

### array-index-not-view-index-for-moveItem  
**Risk: high**

`moveItem` is a raw adjacent-index swap on `day.items`. A lane-grouped or start-sorted view must translate view position back to array index before emitting, and the reducer must never sort its stored `days` — array order is the canonical order every other consumer reads.

*Why it matters:* `addItem` appends to the end of the array regardless of slot, so days stored as [evening, morning] already exist for any member who used DayCard's "+ Add item". In a re-sorted or lane-grouped view, "move up" swaps with the array neighbour, not the block the user sees above — the arrow moves the wrong item, silently reordering a shared plan. The same array order drives `reflow`'s cursor, `nowNext` on the Today tab, and the legacy check-key migration.

*Test:* Day 2 items in array order [{id:'e',slot:'evening'},{id:'m',slot:'morning'}]. In a lane view 'm' renders above 'e'. moveBlock('m','up') must emit either zero ops or an op whose applied result matches what the user saw — assert the emitted op and the resulting array explicitly. Also: rendering a lane view emits zero ops (no normalising write).

*Grounded in:* lib/planOps.ts:107 (append, slot ignored), :151-158 (index swap); components/trip/DayCard.tsx:84 (`day.items.map`), :125,:134 (arrows disabled on array index); lib/timeline.ts:13-15 ("Array order is day order… Reflow never sorts"); lib/tracker.ts:79-86; lib/server/migrate.ts:33

---

### target-day-clamped-and-shelf-rederived-on-apply  
**Risk: high**

Every applied `serverPayload` reconciles `targetDay` into 1..days.length in the same transition and re-derives the shelf from the (possibly changed) `days[targetDay-1].destinationId`. The reducer never emits an op whose `day` is absent from `state.days`.

*Why it matters:* `PATCH /api/trips/:id` rebuilds the entire plan from `input` and can shrink 7 days to 3. A stale targetDay of 5 makes every subsequent `+` POST `day:5`, which returns 400 "Day not found" — the user's adds vanish behind a nonsense error. Retargeting without recomputing the shelf is equally wrong: the member would be adding Xi'an activities to a Beijing day.

*Test:* state.targetDay = 5 over 7 days (day 5 destinationId 'xian'); apply serverPayload(version 12, days 1..3, all destinationId 'beijing') → state.targetDay === 3 AND state.shelf derived from 'beijing' activities. Then addFromShelf → op `day:3`, never `day:5`.

*Grounded in:* lib/planOps.ts:92-93; app/api/trips/[id]/route.ts:66-84 (buildTripData full rebuild); lib/server/schemas.ts:26-27 (creation caps at 8 destinations / 21 days, but PATCH can shorten)

---

### pending-ops-need-settle-and-fail-actions  
**Risk: high**

There must be actions that remove an op from `pendingOps` on success and roll back its optimistic effect on failure (e.g. `opSettled(opId)` / `opFailed(opId, message)`), with ops carrying an id so acknowledgement is by identity, not position.

*Why it matters:* Task 22's action list gives `pendingOps` no exit, so it can only grow: any rebase-on-apply re-applies already-saved ops forever (duplicate blocks), and a server-rejected op is never undone, so the member keeps an edit that does not exist on the server. `mutate`'s catch branch is the worst case — it returns a string and does NOT refetch, so a network failure leaves the optimistic edit on screen with nothing at all to correct it.

*Test:* addFromShelf → pendingOps.length === 1; opSettled(thatId) → pendingOps.length === 0 and days reflect only the server payload. Separately opFailed(thatId,'…') → the optimistic item is removed from days, pendingOps.length === 0, and the message is surfaced.

*Grounded in:* docs/superpowers/plans/2026-08-17-pr2-redesign-plan.md Task 22 action list (no settle/fail action); lib/useTripPayload.ts:144-146 (catch returns a string, no refetch); lib/planOps.ts:112,130,153; app/api/trips/[id]/plan/route.ts:68-71 (409 after 3 attempts)

---

### rejection-reaches-the-reducer-explicitly  
**Risk: high**

A rejected op must be delivered to the reducer as its own action. The reducer must not infer failure from the payload stream.

*Why it matters:* `mutate` signals failure only through its return value, then fires `refetch(true)`. Because an optimistic edit deliberately keeps the old `version`, the reconciling payload can carry the SAME version the client already holds — and `reducePayload` drops a non-newer payload unless forced. So a 400/409/401 can leave the optimistic edit on screen indefinitely: the member sees their block at 09:00, closes the tab, and it was never saved.

*Test:* `mutate` resolves to 'That item no longer exists'; assert the reducer receives `opRejected(opId, message)`, rolls the optimistic item back to its pre-action state, and surfaces the message — and that this path does not depend on a version bump arriving.

*Grounded in:* lib/useTripPayload.ts:133-149; lib/tripPayloadCore.ts:21-28, :30-34

---

### force-survives-the-buffer  
**Risk: high**

`serverPayload` must carry the accessor's `force` flag, and `endInteraction` must apply a forced buffered payload even when its version is equal to or lower than the baseline.

*Why it matters:* A forced refetch is the accessor's only post-error reconciliation path, and it exists precisely because an optimistic update kept the old version "so no poll would ever overtake it". If the poll-gate buffers a forced payload and then re-tests it against the `>=` rule at endInteraction, it drops the one payload that can heal the state — reintroducing the exact stuck-phantom-edit bug `force` was added to prevent. Task 22's action signature `serverPayload(payload)` has no force channel.

*Test:* baseline version 7 with an optimistic block the server rejected; beginInteraction; serverPayload(serverTruth v7, {force:true}); endInteraction → state.days equals serverTruth (phantom gone) even though 7 === 7. Contrast: serverPayload(v6, {force:false}) → dropped.

*Grounded in:* lib/tripPayloadCore.ts:14-28 (force docblock and `prev.version >= fresh.version`); lib/useTripPayload.ts:139, :160-167 (both failure paths call refetch(true))

---

### pending-ops-dropped-when-their-target-vanishes  
**Risk: high**

When an applied payload no longer contains an item id (or day) a pending op references, that op is DROPPED, not retried, and the local edit is discarded — server wins. The reducer never resurrects a deleted item.

*Why it matters:* `PATCH /api/trips/:id` regenerates every item id (`items.map(it => ({...it, id: newId()}))`). Retrying `setTiming`/`moveItem` against a dead id yields an endless 400 loop; `removeItem` against a dead id returns `ok:true` and does nothing, which is worse because the UI believes the delete stuck. Re-inserting the local copy would leave an orphaned block whose check keys point nowhere.

*Test:* pendingOps = [{op:'setTiming',day:2,itemId:'old-1',…}]; apply serverPayload(v11) whose day-2 item ids are all fresh → pendingOps === [] and days equals v11 exactly (no 'old-1' anywhere), and zero ops are emitted.

*Grounded in:* lib/itinerary.ts:254; app/api/trips/[id]/route.ts:81-84 ("The rebuilt plan has fresh item ids"); lib/planOps.ts:129-130, :152-153, :141-142

---

### emitted-ops-stay-inside-the-write-boundary  
**Risk: high**

Every emitted op already satisfies the server bounds: `day` int 1–60; `startMinutes` int 0–1439; `durationMinutes` int 1–1440 (reducer floor 15); `title` trimmed 1–80; `time` ≤20; `note` ≤200; `direction` exactly 'up'|'down'. A shelf name longer than 80 characters is truncated or suppressed before emission, and a blank custom draft emits nothing.

*Why it matters:* Any out-of-bounds value is a flat 400 whose zod `details` the client discards, so the member sees a generic failure with no field named — and because `mutate` then force-refetches, the whole batch of local edits is replaced by server state, not just the offending op. This is reachable from real data: `data/catalog.json` contains exactly one 86-character attraction name ("Migratory Bird Sanctuaries along the Coast of Yellow Sea-Bohai Gulf of China (Phase I)"), verified present.

*Test:* addFromShelf({name: that 86-char name}) → emitted title length ≤ 80. addCustom('   ') → zero ops. adjustTiming at durationMinutes 15 with -15 → duration stays 15 and either no op or an op with 15, never 0. No emitted op has startMinutes > 1439.

*Grounded in:* lib/server/schemas.ts:72-81, :74-76; data/catalog.json (one name-like string of 86 chars, verified); lib/timeline.ts:21-27, :106; lib/tripPayloadCore.ts:95-98

---

### poll-gate-buffers-exactly-one-newest-payload  
**Risk: high**

While `interaction` is active, `serverPayload` writes only to a single `buffered` slot (newest version wins) and leaves `days`, `targetDay`, `shelf` and `pendingOps` byte-identical. On `endInteraction` the buffer is applied through `reducePayload(baseline, buffered, force)` — the library function, not a hand-rolled comparison — so an EQUAL version is dropped as well as a lower one.

*Why it matters:* A poll landing mid-drag would replace the block the member is holding, so the drop lands on stale geometry or the edit is discarded. Buffering every payload instead of the newest replays stale states in sequence. And hand-rolling the comparison as `>` loses the equal-version case, which is exactly where an optimistic edit lives — applying an equal-version poll overwrites the member's change with pre-edit data and no error.

*Test:* Applied v5; beginInteraction; serverPayload(v7); serverPayload(v6); serverPayload(v8) → state.days still the v5 days (same reference) and buffered.version === 8; endInteraction → days are v8's and buffered === null. Separately: applied v9, beginInteraction, serverPayload(v9, force:false), endInteraction → state unchanged.

*Grounded in:* lib/tripPayloadCore.ts:21-28 and lib/useTripPayload.ts:114-128 (the interval calls refetch regardless of any interaction); plan Task 22

---

### interaction-release-is-unconditional  
**Risk: high**

`interaction` is a boolean, not a nesting counter. Two `beginInteraction`s followed by one `endInteraction` leaves the gate open and flushes the buffer. `endInteraction` from a clean state is a no-op returning the identical state object, and never clears `targetDay` or `pendingOps`.

*Why it matters:* Press-and-hold escalating into a drag fires begin twice against one pointerup, and pointercancel/unmount/Esc can fire one without the other. A counter that never unwinds freezes the surface at a stale version forever: live sync stops, every later op is computed against stale day numbers and item ids, and the member silently drifts out of the shared plan with no visible failure.

*Test:* beginInteraction; beginInteraction; serverPayload(v11); endInteraction → state.interaction === false and days === v11's days. From a clean state: endInteraction returns the same object reference, does not throw, and leaves targetDay and pendingOps untouched.

*Grounded in:* plan Task 22 ("beginInteraction / endInteraction (drag or press-and-hold)") and Task 25 ("bracket every drag"); lib/tripPayloadCore.ts:12 (POLL_MS = 4000)

---

### first-payload-is-never-gated  
**Risk: medium**

With no baseline yet (no payload ever applied), `serverPayload` applies immediately even while `interaction` is active — mirroring `reducePayload`'s null-prev branch.

*Why it matters:* Gating the first payload leaves the builder with zero days, so any add targets a day that does not exist. There is also nothing to protect: no local edit can predate the first payload.

*Test:* Fresh state (days === [], no applied version); beginInteraction; serverPayload(v1) → state.days === v1's days immediately and state.buffered === null.

*Grounded in:* lib/tripPayloadCore.ts:26 (the `prev &&` guard); lib/tripPayloadCore.test.ts ("accepts the first payload when there is nothing to compare against")

---

### timed-test-is-both-halves-and-positive-duration  
**Risk: high**

The reducer's timed/untimed predicate must be `typeof startMinutes === 'number' && typeof durationMinutes === 'number' && durationMinutes > 0` — never `!== null`, never truthiness. Untimed and half-timed items are returned byte-identical: no key added, no start fabricated.

*Why it matters:* `ScheduledItem.startMinutes` is `?: number | null` — optional AND nullable — so `!== null` is TRUE for every legacy item, and 100% of stored items are legacy. That predicate would classify all of them as timed and compute `undefined + undefined` → NaN, or coerce to 0 and fabricate a 00:00 start that the very next setTiming persists into a plan members already own. Truthiness fails separately: startMinutes 0 (midnight) is legal. Note `isTimed` is PRIVATE to lib/timeline.ts and not exported, so the reducer will write its own copy — export it or duplicate it exactly.

*Test:* Four items — `{id:'a'}`, `{id:'b',startMinutes:null,durationMinutes:null}`, `{id:'c',startMinutes:600}` (half), `{id:'d',startMinutes:0,durationMinutes:60}` — through the reducer's classifier: a, b and c are untimed; d is timed. reflow/emit path returns a, b, c with no key added (`'startMinutes' in result === false` for a and b) and emits zero ops for them.

*Grounded in:* lib/itinerary.ts:30-38 (the `?: number | null` docblock); lib/timeline.ts:49-58 (private isTimed, requires `durationMinutes > 0`); lib/timeline.test.ts:116-130 ("treats a half-timed item as untimed"); lib/planOps.ts:60-65 (clearing lands on undefined, so "null" is not a usable marker); spec §5.3 lines 387-391

---

### edge-moves-emit-nothing  
**Risk: medium**

`moveBlock` emits zero ops when the block is already at array index 0 (up) or last (down). The reducer clamps; it must not rely on a server rejection.

*Why it matters:* A boundary `moveItem` is NOT an error — `applyPlanOp` returns `{ok:true, plan}` unchanged, but the route still calls `updateTripDataIf` unconditionally and `touch()` increments `version`. So a member mashing "move up" on the top block churns every 4-second poller with a newer payload that carries no change, and each of those applies over any other pending optimistic work.

*Test:* moveBlock(firstItemId,'up') → zero ops. moveBlock(lastItemId,'down') → zero ops. Pin the server behaviour so nobody relies on it: applyPlanOp with a boundary move returns ok:true with an unchanged plan.

*Grounded in:* lib/planOps.ts:151-159 (`if (target < 0 || target >= day.items.length) return { ok: true, plan }`); lib/planOps.test.ts:268 ("is a no-op at the boundary"); app/api/trips/[id]/plan/route.ts:58; lib/server/tripStore.ts:28-31, :215-231 (touch on every write)

---

### emitted-ops-carry-only-schema-keys  
**Risk: medium**

Every emitted op's key set is exactly the schema's key set for that op. The reducer must never spread a `ReflowedItem`, a `ScheduledItem`, or a shelf entry into an op payload.

*Why it matters:* VERIFIED: `PlanOpSchema` members are plain (non-strict) zod objects, so extra keys are silently STRIPPED, not rejected. `PlanOpSchema.parse({op:'addItem',day:1,title:'x',slot:'morning',id:'cid',fullDay:true,pushedBy:'z',overflows:true,interests:['food']})` returns only `{op,day,title,slot}`. A stripped field looks like a successful save: the server returns 200 and the implementer concludes `fullDay`/`interests`/`pushedBy` are persisted when they are not. Note also that `reflow`'s output object carries `pushedBy` as an own enumerable key, so it JSON-serialises.

*Test:* The parse above returns an object with no `id`, `fullDay`, `pushedBy`, `overflows` or `interests` (verified). Reducer test: for every emitted op, `Object.keys(op)` equals the expected set exactly; and `JSON.stringify(emittedOps)` contains no 'pushedBy' and no 'overflows'.

*Grounded in:* lib/server/schemas.ts:83-123 (no `.strict()`); lib/planOps.ts:96-107 (server mints id, hardcodes kind:'custom', ignores fullDay/interests); lib/timeline.ts:77-82

---

### shelf-activities-must-be-injected  
**Risk: medium**

Shelf derivation is a pure function of (days, targetDay, an injected `activitiesByDestinationId` map, customDraft). The reducer must never resolve activities itself, and a target day whose destinationId is absent from the map yields a shelf containing only the custom row — never a crash, never an error state.

*Why it matters:* The trip payload carries NO activity data: `TripData` is `{tripName, startDate, input, plan, packing, foods, destinationNames}`. `getDestination` knows only the 16 bundled curated cities, while `data/catalog.json` holds 695 — so 679 destinations have no client-side Activity records at all. If the reducer reads `lib/data` directly, every catalog-city day shows a permanently empty shelf with no signal that data is missing rather than exhausted.

*Test:* days = [{day:1,destinationId:'Q1234',destinationName:'Zibo',items:[]}], targetDay=1, activitiesByDestinationId={} → shelf === [{kind:'custom'}]. Same state with a one-entry map → shelf === [{kind:'activity',name:'…'},{kind:'custom'}].

*Grounded in:* lib/tripShared.ts:6-14; lib/data/index.ts:14 (16 curated ids: beijing,xian,qingdao,harbin,shanghai,hangzhou,suzhou,xiamen,chengdu,chongqing,guilin,zhangjiajie,yunnan,sanya,guangzhou,shenzhen); data/catalog.json (695 cities, verified); lib/server/catalog.ts:278-288 (resolveDestinations is server-only, reads disk)

---

### unscheduled-is-destination-scoped-title-match  
**Risk: medium**

An activity is 'scheduled' — and off the shelf — when its trimmed, case-folded name equals the trimmed, case-folded `title` of an item on ANY day whose `destinationId` matches the target day's, not merely on the target day. Matching is by title string only: `Activity` has no id.

*Why it matters:* The generator's dedupe set (`const used = new Set<string>()`) is created once per destination, OUTSIDE the per-day loop, so a Beijing activity placed on Day 1 is deliberately absent from Days 2–3. A per-day-only rule re-offers it on Day 2, the member taps +, and the trip now holds the Summer Palace twice with no warning. An implementer who assumes a stable activity id will invent one (index, slug), fail to match it against stored titles, and nothing will ever leave the shelf.

*Test:* days = [{day:1,destinationId:'beijing',items:[{id:'a',title:'Summer Palace',…}]},{day:2,destinationId:'beijing',items:[]},{day:3,destinationId:'xian',items:[]}]; beijing activities include 'Summer Palace' and '798 Art District'. targetDay=2 → shelf omits 'Summer Palace'. targetDay=3 → shelf derives from xian only. Then updateItem renames the day-1 item to 'Yiheyuan' → 'Summer Palace' returns to the shelf (accepted consequence).

*Grounded in:* lib/itinerary.ts:168 (`used` created per destination at :164-168, day loop starts :170); lib/itinerary.ts:127-136 (`title: a.name` is the only join key); lib/types.ts:42-53 (Activity has `name`, no id); lib/planOps.ts:97-106 (addItem stores kind:'custom' + title)

---

### duplicate-add-guard-is-client-side-only  
**Risk: medium**

While an add for a given shelf key is in flight, that key is hidden from the shelf and cannot be added again. Nothing on the server prevents duplicates.

*Why it matters:* The shelf is derived from `days`, which only changes a full round trip later — and during an interaction the poll-gate defers that update further. `applyPlanOp` appends unconditionally with a fresh id and no dedupe. Without a pending set, a double-tap (or a drag plus a tap) yields two identical items the member has to find and delete.

*Test:* targetDay=2, shelf contains 'Summer Palace'. addFromShelf('Summer Palace') twice with no intervening serverPayload → exactly one emitted op, and the shelf omits it immediately after the first add. Then apply the payload containing the item → it stays omitted (now for the scheduled reason) and the pending entry clears.

*Grounded in:* lib/planOps.ts:107 (unconditional append); lib/tripPayloadCore.ts:12 (POLL_MS = 4000)

---

### explicit-target-only-never-visible-day  
**Risk: medium**

The reducer's state and action union contain no notion of a visible, scrolled, expanded, or 'today' day. `addFromShelf` derives the op's `day` solely from `state.targetDay`, which changes only via `setTargetDay`.

*Why it matters:* If the builder falls back to whatever day is on screen, a tap lands an item on the wrong day and the member does not see it happen — a silent corruption of a shared plan. This is also the concrete content of contract C3 ("lives in a hook with no layout knowledge"), which spec §11 names as the constraint most worth enforcing in review.

*Test:* setTargetDay(3) → serverPayload(v2, 7 days) → beginInteraction → endInteraction → addFromShelf(a) emits `day:3`. Interleave setTargetDay(5) before the add → `day:5`. Structural assertion: the exported state type and action union contain no `visibleDay`/`scrollDay`/`todayIndex` member, and the module imports nothing from `react` or `components/`.

*Grounded in:* spec §3.2.4 lines 128-132 ("an explicit \"adding to Day 03\" target chip"); spec §7 C3 lines 497-501; components/trip/PlanTab.tsx:28,:115 (`todayIndex` is a sibling concept that must not leak in)

---

### free-text-time-is-never-parsed-or-overwritten  
**Risk: medium**

`ScheduledItem.time` is unvalidated free text and is a separate field from `startMinutes`. The builder must not parse `time` into a start, and must not rewrite `time` when setting a block. Non-timing fields (id, slot, fullDay, kind, title, time, note, interests) are never altered by a timing edit.

*Why it matters:* Parsing '19:00' into a start is exactly the fabrication spec §5.3 forbids, and it is lossy against real values — `ItemTimeSchema` is `z.string().trim().max(20)` with no format, so the field holds things like 'after lunch'. The two can also legitimately contradict: DayCard's edit form writes `time` and leaves timing alone, so one member can label an item '19:00' while another blocks it at 09:00 and nothing reconciles them. `setTiming` cannot touch `time` at all.

*Test:* Item {startMinutes:540,durationMinutes:90,time:'19:00'}: the emitted setTiming leaves `time` untouched, and after applyPlanOp the stored item still reads time:'19:00'. Item {time:'after lunch'} with no timing → classified untimed, zero ops emitted.

*Grounded in:* lib/itinerary.ts:28-29; lib/server/schemas.ts:75, :101 (only updateItem can write time); lib/planOps.ts:128-138 (setTiming patches only the two timing fields); components/trip/DayCard.tsx:359

---

### builder-renders-only-reducer-state  
**Risk: medium**

The day-builder subtree reads exclusively from reducer state, never from the accessor's `payload` prop, for as long as the gate can be closed.

*Why it matters:* The poll-gate is described in Task 22 as a reducer property, which it cannot be on its own: `useTripPayload`'s interval calls `setPayload` unconditionally every 4s plus on focus and visibilitychange. Any sibling subtree still reading `payload.data.plan` repaints mid-drag while the gated subtree does not — a torn view showing the same day in two orderings, which makes the gate cosmetic rather than protective. Task 24 explicitly keeps PlanTab's DayCard list rendering from the payload until DayBuilder mounts.

*Test:* With interaction active, push a new accessor payload; assert the DayBuilder's rendered day list is unchanged (a changing `payload` prop must not reach it) — `state.days` is the only render source. Plus a source assertion that the builder subtree does not reference `payload.data.plan.days`.

*Grounded in:* lib/useTripPayload.ts:73-75, :114-128; spec §7 C3; plan Task 24 ("PlanTab keeps the DayCard list working until DayBuilder mounts")

---

### custom-row-shape-and-lifecycle  
**Risk: low**

The free-text entry is always the terminal shelf row, is never removed by the unscheduled rule, and its draft clears on a successful add. Its emitted shape is `{op:'addItem', day: targetDay, title: trimmedDraft, slot}` with no client-supplied `kind`.

*Why it matters:* If the custom row is filtered like an activity, typing a title the day already has makes the row disappear mid-keystroke. If the draft does not clear, a second tap or an Enter repeat silently adds the same item twice. `kind` is forced to 'custom' server-side and is stripped from the op if sent.

*Test:* Day 2 already contains 'Dinner with Ana'. Set customDraft = 'Dinner with Ana' → the custom row is still present and enabled. addCustom → one op with that title; state.customDraft === '' afterwards; a second addCustom with no retyping emits nothing.

*Grounded in:* plan J6; lib/planOps.ts:100 (kind:'custom' set server-side); lib/server/schemas.ts:84-94 (no kind field on addItem)

---

## Traps and contradictions

The most valuable section. Each was verified against the code.

- **TASK 21 HAS ALREADY LANDED, and its committed semantics differ from every description of it in the plan and in the briefs.** `lib/timeline.ts` + `lib/timeline.test.ts` are in HEAD (commit ff63963 "feat: add the timeline reflow engine"). Four differences matter: (1) the signature is `reflow(items)` with NO anchor/changedId parameter; (2) `pushedBy` is the IMMEDIATE PREDECESSOR, not the block that initiated the cascade — pinned at lib/timeline.test.ts:52-63 (`out[1].pushedBy==='a'`, `out[2].pushedBy==='b'`); (3) an overflowing push CLAMPS to 1439 and sets `overflows:true` rather than refusing the reflow — pinned at lib/timeline.test.ts:158-170; (4) `dayLoad` returns exactly `{plannedMinutes, gaps}` and two tests use `toEqual` on the whole object (lib/timeline.test.ts:274, :278), so ADDING a field such as `untimedCount` breaks them. Any invariant written against the plan's prose description of Task 21 is stale. The open work is Task 22 (`lib/dayBuilder.ts`) and Task 23 (`components/plan/useDayBuilder.ts`), neither of which exists yet.

- **THE HEADLINE TRAP: `reflow` cannot distinguish 'this overlaps because I just grew A' from 'these two already overlapped when the page loaded.'** With no anchor argument it is a pure cursor pass that normalises every overlap it finds (lib/timeline.ts:60-87). The natural implementation — diff reflow's output against stored values and emit `setTiming` for each change — therefore POSTs over blocks the current member never touched, on mount, which is precisely the concurrent-member-edit loss spec §5.4 spends three paragraphs forbidding. It also breaks the engine's own pinned `un-pushes when the block above shrinks back` test, which works only because B's stored start is left alone. The only safe shape is: state stays `ScheduledItem[]`, `reflow` is a render-time selector, and `setTiming` is emitted for the acted-on block only. Decide this explicitly in a docblock before Task 22 is written — nothing in the spec or plan arbitrates it.

- **THERE IS NO TIMED DATA ANYWHERE, and no task creates any.** `buildItinerary` never sets `startMinutes`/`durationMinutes` (`activityItem` at lib/itinerary.ts:127-136 sets slot/fullDay/kind/title/note/interests; every draft literal at :178-248 omits both; :254 stamps only `id`), and grep for either field across `components/` and `app/` returns ZERO hits. So 100% of stored items in 100% of trips are untimed, and PR2's builder is the first producer of timing in the app's history. Consequences: `dayLoad` reads `0h 0m planned · 0 gaps` on a day holding eight activities, and a brand-new trip created after PR2 ships opens the builder with a completely empty timeline — the flagship §3.2.6 interaction has no data on first load. Task 21's brief treats "mixed legacy day (all-null timing) is a no-op" as one edge case; it is the entire installed base. `Activity.slots` (1 = half day, 2 = full day) is the only signal available if generation-time timing is ever added.

- **`setTiming`'s schema comment is false, and I verified it by running the parser.** lib/server/schemas.ts:110-111 says "Both required, so a block is always set or cleared as a whole and a half a block can never reach storage" — but the two fields are `.nullable()` INDEPENDENTLY (not `.optional()`). Verified: `PlanOpSchema.safeParse({op:'setTiming',day:1,itemId:'a',startMinutes:540,durationMinutes:null})` PARSES, `applyPlanOp` stores `{id:'a',slot:'morning',kind:'activity',title:'T',startMinutes:540}`, and `dayLoad` on that item returns `{plannedMinutes:0,gaps:0}` — the block silently vanishes. The existing test (lib/server/schemas.test.ts:231-233) only covers the OMITTED-key case, because its fixture `{op:'setTiming',day:1,itemId:'item-1'}` carries neither field. `addItem` has the same hole via independent `.optional()` (schemas.ts:92-93): `{op:'addItem',day:1,title:'x',slot:'morning',startMinutes:540}` parses. Both the spec and the plan model timing as a binary, so nothing downstream expects the half state.

- **C4 CONTRACT TRAP — it will turn CI red on Task 23, and I verified the substring.** The scan is whole-file co-occurrence: `f.text.includes("/api/trips/") && f.text.includes("fetch(")` (lib/contracts.test.ts:122-123). `"refetch("` CONTAINS `"fetch("` — verified `'void refetch(true)'.includes('fetch(') === true`. Task 23 prescribes BOTH in one file: build `/api/trips/${tripId}/plan` and "fall back to `refetch(force)`". That file is an instant offender. Worse, lib/contracts.test.ts:140 asserts `components/TripView.tsx` contains no `"fetch("` at all, so TripView can never contain `refetch(` either. Cleanest fix: have `useDayBuilder` take an `onPlanOp(op)` callback instead of a URL — `components/TripView.tsx:86` already owns `planOp = (op) => mutate(\`/api/trips/${tripId}/plan\`, jsonInit("POST", { op }))` and passes it down as `onPlanOp` through `components/trip/PlanTab.tsx:30,:120` into DayCard. That kills the C4 trap and removes a duplicate emitter in one move.

- **C3 CONTRACT TRAPS, three of them.** (a) The scan matches `/(^|\/)(use)?[dD]ayBuilder(\/index)?\.tsx?$/` restricted to paths starting `lib/`, and lib/contracts.test.ts:285 explicitly asserts that `lib/useDayBuilder.ts` MATCHES — so putting a `useReducer` hook at that path makes the contract unsatisfiable. The plan's `components/plan/useDayBuilder.ts` is safe (:287 pins that components paths do not match); keep the hook out of `lib/`. (b) Task 22's instruction to "un-skip the C3 assertion" is stale: it is `it.skipIf(builders.length === 0)` (:272), which self-arms the moment the module lands — an implementer hunting for a `.skip` to delete may damage the guard. (c) The assertion only tests `from "react"`, not imports from `components/` as Task 22 claims, and `lib/timeline.ts` does NOT match the pattern at all, so the reflow engine is covered by no contract. Good news for the design: `lib/tripPayloadCore.ts`, `lib/tripShared.ts`, `lib/planOps.ts`, `lib/itinerary.ts` and `lib/timeline.ts` all have zero react imports, so `lib/dayBuilder.ts` can import `reducePayload` and `reflow` directly.

- **`PATCH /api/trips/[id]` violates the spec's own §5.4 prohibition, and a header rename would trigger it.** app/api/trips/[id]/route.ts:66-84 calls `buildTripData(...)` — a full regeneration from `input` — even for a bare `{tripName}` body, then writes through `updateTripData` (lib/server/tripStore.ts:201-209, `UPDATE trips SET data=?, name=? WHERE id=?` — NO version clause), then `clearScheduleChecks(id)`. Spec §5.4 declares bulk rewrites through that exact function forbidden because they "silently clobber any member edit landing concurrently." No UI calls it today, which is why it is latent — but Task 4/Task 12 build a header trip zone with the name and dates in it, the single most natural place to add an inline rename. Wiring one to this endpoint wipes all timing, all member item edits, every item id, and every checkbox in the trip. Flag this in the Task 12 brief. For Task 22 it means a buffered payload can be a wholesale plan REPLACEMENT, not a delta.

- **One op per request, no batch, no transaction — so a multi-block reflow can never be atomic.** `PlanEditSchema = z.object({ op: PlanOpSchema })` (schemas.ts:125-127) is singular, and the route applies exactly one op under `updateTripDataIf` with `MAX_WRITE_ATTEMPTS = 3` before returning 409 "The trip is being edited by someone else right now — try again." (route.ts:11,:44-71). A four-block cascade would be four sequential POSTs, four version bumps, and four full payload broadcasts to every 4s poller; a 409 or 400 on the second leaves a PERSISTED half-reflow with overlapping blocks that no client can explain. Task 22's plural `pendingOps` implies a batching capability the server does not have. This is the second independent argument for treating reflow as display-only.

- **Array order and slot lanes contradict each other, and there is no op to reconcile them.** `addItem` appends to the end of `day.items` regardless of slot (planOps.ts:107) and generated days are built morning→afternoon→evening (itinerary.ts:174-248), so any member who used DayCard's "+ Add item" already has days stored as e.g. [evening, morning]. Meanwhile spec §5.3 says legacy items "render in slot lanes", `lib/server/tripStore.test.ts` repeats "renderable in their slot lanes", and Task 24 requires lanes — but no renderer in the tree groups by slot today (DayCard.tsx:84 + :327-335, PlanStep.tsx, BriefingView.tsx:28, GuestTripView.tsx:18 are all flat array-order lists with the slot as a text label). A lane view therefore visually reorders days members have already arranged, and because `moveItem` is a raw adjacent-index swap with arrows disabled on ARRAY index (DayCard.tsx:125,:134), the move controls in a re-sorted view move the wrong item. There is no insert-at-index op and no positional move, so "fix it with moveItem" is an N-request burst. This is the single most likely shipped bug in Task 24.

- **No slot is defined for a shelf add, and the primary interaction forbids asking.** `addItem` requires `slot: 'morning'|'afternoon'|'evening'` (schemas.ts:88), but `Activity.timeOfDay` is `TimeSlot | 'day' | 'any'` (lib/types.ts:37-47) and `'day'`/`'any'` are common in the curated data. Spec §3.2.4 says the `+` tap has "no modal, no navigation", so the slot must be derived silently. `canFill` (itinerary.ts:113-120) is the existing precedent but it is generator logic driven by remaining free slots, which the builder does not have. This is undefined behaviour at the most-used control on the surface — decide it in Task 22, not Task 24.

- **`fullDay` is not in `PlanOpSchema` at all, and any lane drag destroys it.** An item can fill morning+afternoon (itinerary.ts:24-25, rendered as "All day" at DayCard.tsx:335) and the generator produces these for `slots: 2`. No op can set it — verified, `addItem` silently strips a `fullDay` key — so an all-day activity added from the shelf renders as a single-slot item. Worse, `updateItem` clears it unconditionally whenever `slot` changes (`fullDay: slotChanged ? undefined : existing.fullDay`, planOps.ts:118, pinned at planOps.test.ts:85), so dragging a Great Wall all-day block into the afternoon lane silently downgrades it on every member's screen with no way to restore it. Neither the spec nor the plan mentions `fullDay` once.

- **Task 22's `moveBlock(up|down)` and `adjustTiming(±15)` actions cannot be implemented as written** — they carry no item id, but `moveItem` and `setTiming` both require `itemId` (planOps.ts:31-37, schemas.ts:106-121). Following the brief literally produces a reducer with no way to name the block being moved or retimed. They need an `itemId` argument (a focused-block id in state is closer to layout knowledge than C3 wants). Also MISSING from the action list: no delete and no title/note edit, yet Task 24 mounts DayBuilder as "the member editing surface" and J13 relegates DayCard to guests and print — so members would lose delete (DayCard.tsx:155) and rename/renote (DayCard's ItemForm). The ops exist (`removeItem`, `updateItem`); the action list just does not cover them. And no rejection action, so a 400/409 from `mutate` has nowhere to go.

- **The plan's central justification for the poll-gate is not in the spec.** Task 22 calls it "the spec's top-ranked risk", but spec §11 never mentions polling, buffering, or interaction gating. Its first bullet is the China-scoped catalog pipeline; its only day-builder bullet is C3 state/layout separation ("if its state and layout are not cleanly separated, the mobile bottom sheet becomes a rewrite… C3 is the constraint most worth enforcing in review"). The buffering behaviour is a plan invention with no authoritative spec text behind it, so nothing arbitrates the force/rebase questions — decide them in code docblocks or the plan will keep losing the argument to whoever reads it next.

- **`version` is a whole-trip write counter, not a plan revision — so 'strictly newer' does not mean 'contains my op'.** `touch()` (tripStore.ts:28-31) increments it on EVERY write, including `setCheck` (:374 — anyone ticking a packing checkbox), ticket/expense/journal writes, and joins. So a v11 poll that predates an in-flight `addItem` is 'newer', and blind replacement deletes the block the member just added and can still see. Version monotonicity alone cannot protect a mid-drag edit; the safety story rests on op-level rebase or drop, which the brief never mentions. Also note `mutate`'s success path calls `applyPayload(json)` with force=FALSE (useTripPayload.ts:142), so mutation responses go through the same monotonic filter as polls.

- **`reducePayload` returns `prev` BY IDENTITY when it drops a payload** (tripPayloadCore.ts:26), so the accessor's `payload` reference does not change on a dropped poll. Convenient — a `useEffect(..., [payload])` will not re-fire — but a trap: after `endInteraction` no new payload identity is guaranteed to arrive, so the flush MUST come from the reducer's own buffer. A hook relying on "the effect will fire again once the interaction ends" sits on stale data until the next strictly-newer poll. Two pre-existing footholds worth reusing rather than reinventing: `applyOptimisticCheck` (:35-43) is the house pattern for "optimistic edit deliberately leaves `version` untouched so a forced refetch can reconcile it"; and `createSeqGuard` (:83-92) already solves out-of-order responses — but it guards only `refetch`, not `mutate`.

- **Timing is invisible on every read-only surface, and no PR2/PR3 task fixes it.** `BriefingItem` carries slot/kind/title/time/note and no minutes (lib/briefing.ts:22,:123); `BriefingView` renders `item.time ?? SLOT_META[item.slot].label` (:28); `GuestTripView` renders only `item.slot` (:18); `DayCard` — which J13 keeps as the guest and print renderer — shows only the free-text `time` (:359). So a fully time-blocked day shares, prints and appears to guests with no times at all, and can openly contradict a stale `time` string. `lib/briefing.ts` appears in no PR2 or PR3 task.

- **Every line citation for the schemas in the plan and the spec is wrong — do not navigate by them.** Spec §5.3 and the plan's fact list and Task 23 all say `lib/server/schemas.ts:60-86` for `PlanOpSchema`; it actually spans 83-123 (line 59 is `UpdateTripSchema`). `CreateTripSchema` is at 40 (plan says 30) and `TripInputSchema` at 25 (plan says 19). PR1 inserted the timing sub-schemas (`StartMinutesSchema` :80, `DurationMinutesSchema` :81) above them and shifted everything down. Related: the client discards the server's field-level detail — the route returns `{error:'Invalid edit', details: parsed.error.flatten()}` but `extractMutationError` (tripPayloadCore.ts:95-98) reads only `error`, so a bounds violation is indistinguishable from a shape violation at the UI.

- **Off-map places never reach a saved plan, so spec §5.6 is true only in the wizard preview.** `app/plan/page.tsx:101` mints ids of the form `offmap:<slug>` inside `input.destinationIds`; server-side `resolveDestinations` (lib/server/catalog.ts:278-288) keeps only curated ids and catalog qids and drops the rest, and `buildItinerary` (itinerary.ts:149-151) drops unknown ids again. Good news for Task 22 — a day's `destinationId` is never an off-map id, so the shelf needs no off-map branch — but it means the off-map work signed off in Task 18 does not persist. Separately: `/api/destinations` returns `CatalogHit` with no activities, but `/api/destinations/resolve?ids=…` DOES return full `Destination[]` including activities, is public with `MAX_IDS = 12` (comfortably above the 8-destination creation cap), and is not an `/api/trips/` path — so it is a C4-safe injection point for the shelf's activity map.

- **`addDay` is unbounded but every other op caps at day 60.** `applyPlanOp` appends `day: plan.days.length + 1` with no ceiling (planOps.ts:83-89), while `DayNumberSchema` is `min(1).max(60)` (schemas.ts:72). Past 60 days a day exists that no `addItem`/`setTiming`/`moveItem`/`removeItem` can address — every edit to it 400s permanently. Reachable only via ~40 repeated addDay clicks (creation itself caps at 21 days), so low priority, but the reducer should not offer a target chip for a day it cannot address.

