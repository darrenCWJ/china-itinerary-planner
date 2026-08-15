import type { GuestTripPayload } from "@/lib/tripShared";

/** Read-only itinerary + packing for join-code guests. No checks, no chrome. */
export function GuestTripView({ view }: { view: GuestTripPayload }) {
  return (
    <div className="mt-5 space-y-5">
      <p className="rounded-lg border border-dashed border-rail/40 bg-paper px-4 py-2 text-xs text-ink-soft">
        You&apos;re viewing as a guest — sign in and join to tick things off and see the rest.
      </p>
      {view.planDays.map((day) => (
        <div key={day.day} className="rounded-xl border border-sky bg-paper p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-ink-soft">
            Day {String(day.day).padStart(2, "0")} · {day.destinationName}
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {day.items.map((item) => (
              <li key={item.id} className="flex gap-2">
                <span className="font-mono text-[10px] uppercase text-ink-soft">{item.slot}</span>
                <span>{item.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        {view.packing.map((group) => (
          <div key={group.title} className="rounded-xl border border-sky bg-paper p-4">
            <p className="font-semibold">
              <span aria-hidden>{group.emoji}</span> {group.title}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
