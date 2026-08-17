"use client";

import type { PackingGroup } from "@/lib/packing";
import { packingCheckKey } from "@/lib/tripShared";

/**
 * The packing list: grouped items, each checkable, showing who ticked it.
 *
 * Extracted verbatim from TripView's Packing tab so Task 7 can compose it under
 * Kit alongside bookings — the two halves of "things you carry" (spec §2.1).
 * Behaviour is unchanged; this is a move, not a rewrite.
 */
interface Props {
  packing: PackingGroup[];
  /** Check key → the member who ticked it. Absent means unchecked. */
  checkedBy: Map<string, string>;
  isMember: boolean;
  onToggle(key: string, checked: boolean): void;
}

export function PackingSection({ packing, checkedBy, isMember, onToggle }: Props) {
  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      {packing.map((group) => (
        <div key={group.title} className="rounded-xl border border-sky bg-paper p-4">
          <p className="font-semibold">
            <span aria-hidden>{group.emoji}</span> {group.title}
          </p>
          <ul className="mt-2 space-y-1.5">
            {group.items.map((item) => {
              const key = packingCheckKey(group.title, item);
              const by = checkedBy.get(key);
              return (
                <li key={item}>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={by !== undefined}
                      disabled={!isMember}
                      onChange={(e) => onToggle(key, e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-rail"
                    />
                    <span className={by ? "text-ink-soft line-through" : ""}>
                      {item}
                      {by && <span className="ml-1 text-[11px] text-rail no-underline"> · {by}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
