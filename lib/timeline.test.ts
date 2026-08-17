import { describe, expect, it } from "vitest";
import type { ScheduledItem } from "./itinerary";
import {
  DURATION_STEP,
  MIN_DURATION,
  adjustDuration,
  dayLoad,
  formatClock,
  formatSpan,
  reflow,
} from "./timeline";

/**
 * The reflow engine (spec §3.2.6): when a block grows or moves, later *timed*
 * blocks give way. Untimed items never move — spec §5.3 forbids fabricating a
 * start for an item that never had one, which is most items in every plan saved
 * before time blocks existed.
 */

/** A timed block. Array order is day order; startMinutes is the clock. */
const timed = (id: string, startMinutes: number, durationMinutes: number): ScheduledItem => ({
  id,
  slot: "morning",
  kind: "activity",
  title: id,
  startMinutes,
  durationMinutes,
});

/** An untimed item: the shape every pre-time-blocks plan is full of. */
const untimed = (id: string, slot: ScheduledItem["slot"] = "morning"): ScheduledItem => ({
  id,
  slot,
  kind: "activity",
  title: id,
});

const startsOf = (items: ScheduledItem[]) => items.map((i) => i.startMinutes ?? null);

describe("reflow", () => {
  it("leaves a day whose blocks do not overlap alone", () => {
    const items = [timed("a", 540, 60), timed("b", 660, 60)];

    const out = reflow(items);

    expect(startsOf(out)).toEqual([540, 660]);
    expect(out.every((i) => i.pushedBy === undefined)).toBe(true);
  });

  it("pushes an overlapped successor to the end of the block before it", () => {
    // a runs 09:00–11:00, b was set for 10:00 — b moves to 11:00.
    const items = [timed("a", 540, 120), timed("b", 600, 60)];

    const out = reflow(items);

    expect(startsOf(out)).toEqual([540, 660]);
    expect(out[1].pushedBy).toBe("a");
  });

  it("cascades a push through every block it reaches", () => {
    const items = [timed("a", 540, 180), timed("b", 600, 60), timed("c", 660, 60)];

    const out = reflow(items);

    // a ends 12:00, so b → 12:00–13:00 and c → 13:00.
    expect(startsOf(out)).toEqual([540, 720, 780]);
    // Attribution is to the immediate predecessor, so the UI can say what moved
    // this block rather than blaming the original edit three blocks back.
    expect(out[1].pushedBy).toBe("a");
    expect(out[2].pushedBy).toBe("b");
  });

  it("stops cascading at the first block that already fits", () => {
    const items = [timed("a", 540, 120), timed("b", 600, 30), timed("c", 800, 60)];

    const out = reflow(items);

    expect(startsOf(out)).toEqual([540, 660, 800]);
    expect(out[2].pushedBy).toBeUndefined();
  });

  it("is idempotent", () => {
    // The UI reflows on every change; a second pass must not drift the day.
    const once = reflow([timed("a", 540, 180), timed("b", 600, 60)]);
    const twice = reflow(once);

    expect(startsOf(twice)).toEqual(startsOf(once));
    expect(twice[1].pushedBy).toBe(once[1].pushedBy);
  });

  it("un-pushes when the block above shrinks back", () => {
    const grown = reflow([timed("a", 540, 180), timed("b", 600, 60)]);
    expect(startsOf(grown)).toEqual([540, 720]);

    // The user undoes the growth. b's stored start is still its original 600.
    const shrunk = reflow([timed("a", 540, 60), timed("b", 600, 60)]);

    expect(startsOf(shrunk)).toEqual([540, 600]);
    expect(shrunk[1].pushedBy).toBeUndefined();
  });

  it("never moves an untimed item, even between two timed ones", () => {
    const items = [timed("a", 540, 180), untimed("mid"), timed("b", 600, 60)];

    const out = reflow(items);

    expect(out[1].startMinutes).toBeUndefined();
    expect(out[1].pushedBy).toBeUndefined();
    // And it does not interrupt the push from a to b.
    expect(out[2].startMinutes).toBe(720);
    expect(out[2].pushedBy).toBe("a");
  });

  it("is a no-op on a fully legacy day", () => {
    // Every plan saved before time blocks existed looks like this.
    const items = [untimed("a"), untimed("b", "afternoon"), untimed("c", "evening")];

    const out = reflow(items);

    expect(out.map((i) => i.startMinutes ?? null)).toEqual([null, null, null]);
    expect(out.every((i) => i.pushedBy === undefined)).toBe(true);
  });

  it("treats a half-timed item as untimed", () => {
    // startMinutes without durationMinutes is not a block; giving it a computed
    // length would be the same fabrication §5.3 forbids.
    const items = [
      timed("a", 540, 120),
      { ...untimed("half"), startMinutes: 600 },
      timed("b", 600, 60),
    ];

    const out = reflow(items);

    expect(out[1].startMinutes).toBe(600);
    expect(out[1].pushedBy).toBeUndefined();
    expect(out[2].startMinutes).toBe(660);
  });

  it("orders by position in the day, not by clock time", () => {
    // The day list is the user's order — moveItem reorders the array. A block
    // dragged above one that starts earlier must push it, not be re-sorted.
    const items = [timed("later", 660, 60), timed("earlier", 540, 60)];

    const out = reflow(items);

    expect(out.map((i) => i.id)).toEqual(["later", "earlier"]);
    expect(startsOf(out)).toEqual([660, 720]);
    expect(out[1].pushedBy).toBe("later");
  });

  it("pushes a block that starts exactly when the previous one ends by nothing", () => {
    // Touching is not overlapping; back-to-back blocks are the normal case.
    const out = reflow([timed("a", 540, 60), timed("b", 600, 60)]);

    expect(out[1].pushedBy).toBeUndefined();
  });

  it("separates two blocks sharing a start time", () => {
    const out = reflow([timed("a", 540, 60), timed("b", 540, 60)]);

    expect(startsOf(out)).toEqual([540, 600]);
    expect(out[1].pushedBy).toBe("a");
  });

  it("clamps a push at the last minute of the day rather than overflowing", () => {
    // startMinutes is bounded 0–1439 by the write schema
    // (lib/server/schemas.ts), so a push past midnight cannot be stored. It is
    // clamped and flagged instead, which is what lets the UI say the day is
    // overfull rather than silently rejecting the write.
    const items = [timed("a", 1380, 120), timed("b", 1400, 60)];

    const out = reflow(items);

    expect(out[1].startMinutes).toBe(1439);
    expect(out[1].overflows).toBe(true);
  });

  it("returns new objects rather than mutating the input", () => {
    const items = [timed("a", 540, 180), timed("b", 600, 60)];
    const before = JSON.parse(JSON.stringify(items));

    reflow(items);

    expect(items).toEqual(before);
  });

  it("handles an empty day", () => {
    expect(reflow([])).toEqual([]);
  });
});

describe("adjustDuration", () => {
  it("grows a block by one step", () => {
    const out = adjustDuration([timed("a", 540, 60)], "a", DURATION_STEP);

    expect(out[0].durationMinutes).toBe(60 + DURATION_STEP);
  });

  it("shrinks a block by one step", () => {
    const out = adjustDuration([timed("a", 540, 60)], "a", -DURATION_STEP);

    expect(out[0].durationMinutes).toBe(60 - DURATION_STEP);
  });

  it("floors at the minimum rather than going to zero or negative", () => {
    const out = adjustDuration([timed("a", 540, MIN_DURATION)], "a", -DURATION_STEP);

    expect(out[0].durationMinutes).toBe(MIN_DURATION);
  });

  it("cannot be walked below the floor by repeated decrements", () => {
    let items: ScheduledItem[] = [timed("a", 540, 60)];
    for (let i = 0; i < 10; i++) items = adjustDuration(items, "a", -DURATION_STEP);

    expect(items[0].durationMinutes).toBe(MIN_DURATION);
  });

  it("caps at a full day", () => {
    const out = adjustDuration([timed("a", 0, 1440)], "a", DURATION_STEP);

    expect(out[0].durationMinutes).toBe(1440);
  });

  it("leaves an untimed item untouched", () => {
    // There is no duration to adjust, and inventing one would fabricate a block.
    const out = adjustDuration([untimed("a")], "a", DURATION_STEP);

    expect(out[0].durationMinutes).toBeUndefined();
    expect(out[0].startMinutes).toBeUndefined();
  });

  it("ignores an unknown id", () => {
    const items = [timed("a", 540, 60)];

    expect(adjustDuration(items, "nope", DURATION_STEP)).toEqual(items);
  });

  it("does not reflow — that is the caller's next step", () => {
    // Kept separate so a caller can adjust, inspect, then reflow once, rather
    // than reflowing on every intermediate step of a drag.
    const out = adjustDuration([timed("a", 540, 60), timed("b", 600, 60)], "a", 60);

    expect(out[1].startMinutes).toBe(600);
  });
});

describe("dayLoad", () => {
  it("sums the timed blocks", () => {
    const { plannedMinutes } = dayLoad([timed("a", 540, 90), timed("b", 660, 60)]);

    expect(plannedMinutes).toBe(150);
  });

  it("ignores untimed items in the total", () => {
    // They have no length to count. Counting them as zero is right; guessing is not.
    const { plannedMinutes } = dayLoad([timed("a", 540, 90), untimed("b")]);

    expect(plannedMinutes).toBe(90);
  });

  it("counts the holes between consecutive blocks", () => {
    // 09:00–10:00, gap, 11:00–12:00, gap, 14:00–15:00.
    const { gaps } = dayLoad([timed("a", 540, 60), timed("b", 660, 60), timed("c", 840, 60)]);

    expect(gaps).toBe(2);
  });

  it("does not count the time before the first block or after the last", () => {
    // Those are the unplanned rest of the day, not holes in a plan.
    const { gaps } = dayLoad([timed("a", 540, 60)]);

    expect(gaps).toBe(0);
  });

  it("counts no gap between back-to-back blocks", () => {
    const { gaps } = dayLoad([timed("a", 540, 60), timed("b", 600, 60)]);

    expect(gaps).toBe(0);
  });

  it("reports an empty day as nothing planned and no gaps", () => {
    expect(dayLoad([])).toEqual({ plannedMinutes: 0, gaps: 0 });
  });

  it("reports a legacy day as nothing planned rather than crashing", () => {
    expect(dayLoad([untimed("a"), untimed("b")])).toEqual({ plannedMinutes: 0, gaps: 0 });
  });

  it("measures gaps over the reflowed order, not the clock", () => {
    // Gaps are read off the same array order reflow uses, so the readout agrees
    // with what the user sees rather than with a re-sorted view.
    const { gaps } = dayLoad(reflow([timed("a", 540, 120), timed("b", 600, 60)]));

    expect(gaps).toBe(0);
  });
});

describe("formatClock", () => {
  it("pads to a 24-hour clock", () => {
    expect(formatClock(540)).toBe("09:00");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(605)).toBe("10:05");
    expect(formatClock(1439)).toBe("23:59");
  });
});

describe("formatSpan", () => {
  it("reads the way a person would say it", () => {
    expect(formatSpan(45)).toBe("45m");
    expect(formatSpan(60)).toBe("1h");
    expect(formatSpan(90)).toBe("1h 30m");
    // The readout in spec §3.2.6.
    expect(formatSpan(580)).toBe("9h 40m");
  });

  it("drops a zero minute part rather than printing 1h 0m", () => {
    expect(formatSpan(120)).toBe("2h");
  });

  it("handles nothing planned", () => {
    expect(formatSpan(0)).toBe("0m");
  });
});
