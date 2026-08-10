"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DESTINATIONS } from "@/lib/data";
import { buildItinerary, type ScheduledItem, type TripInput } from "@/lib/itinerary";
import { KIND_EMOJI, SEASONS, SLOT_META } from "@/lib/meta";
import { saveMyTrip } from "@/lib/myTrips";
import { buildPackingList } from "@/lib/packing";
import type { Destination } from "@/lib/types";

interface PlanStepProps {
  input: TripInput;
  /** Catalog-derived destinations resolved via /api/destinations/resolve. */
  extraDestinations: Destination[];
}

export function PlanStep({ input, extraDestinations }: PlanStepProps) {
  const allDestinations = useMemo(
    () => [...DESTINATIONS, ...extraDestinations],
    [extraDestinations]
  );
  const destinations = useMemo(
    () =>
      input.destinationIds
        .map((id) => allDestinations.find((d) => d.id === id))
        .filter((d): d is Destination => Boolean(d)),
    [input.destinationIds, allDestinations]
  );
  const plan = useMemo(() => buildItinerary(input, allDestinations), [input, allDestinations]);
  const packing = useMemo(() => buildPackingList(input, destinations), [input, destinations]);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());

  const seasonMeta = SEASONS.find((s) => s.id === input.season);
  const travellers = input.adults + input.kids;

  const toggleChecked = (item: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });

  return (
    <section>
      <div className="relative overflow-hidden rounded-2xl bg-rail-deep p-6 text-white sm:p-8">
        <span aria-hidden className="seal-round absolute right-6 top-6 hidden border-white/80 text-white/90 sm:inline-flex">
          启程
        </span>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-sky">Boarding pass</p>
        <h2 className="mt-2 font-display text-3xl font-bold">Your China itinerary</h2>
        <p className="mt-3 font-mono text-sm tracking-wider text-sky">
          {destinations.map((d) => d.name.toUpperCase()).join(" → ")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-white/15 px-3 py-1">
            {seasonMeta?.emoji} {seasonMeta?.label}
          </span>
          <span className="rounded-full bg-white/15 px-3 py-1">📅 {input.days} days</span>
          <span className="rounded-full bg-white/15 px-3 py-1">
            🧳 {input.adults} adult{input.adults > 1 ? "s" : ""}
            {input.kids > 0 ? ` + ${input.kids} kid${input.kids > 1 ? "s" : ""}` : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="mt-5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-rail-deep transition-colors hover:bg-sky print:hidden"
        >
          🖨️ Print / save as PDF
        </button>
      </div>

      <ShareTripCard input={input} destinationNames={destinations.map((d) => d.name)} />

      <div className="mt-8 grid gap-8 lg:grid-cols-3 print:block">
        <div className="space-y-5 lg:col-span-2">
          <h3 className="font-display text-xl font-bold">Day by day</h3>
          {plan.days.map((day) => (
            <article
              key={day.day}
              className="overflow-visible rounded-xl border border-sky bg-paper shadow-sm"
            >
              <header className="flex items-baseline justify-between px-5 pt-4">
                <p className="font-mono text-sm font-semibold uppercase tracking-widest text-rail">
                  Day {String(day.day).padStart(2, "0")}
                </p>
                <p className="text-sm font-medium text-ink-soft">{day.destinationName}</p>
              </header>
              <div className="relative mx-5 mt-3 border-t-2 border-dashed border-sky">
                <span aria-hidden className="absolute -left-[30px] -top-2 h-4 w-4 rounded-full bg-mist" />
                <span aria-hidden className="absolute -right-[30px] -top-2 h-4 w-4 rounded-full bg-mist" />
              </div>
              <ul className="space-y-3 px-5 py-4">
                {day.items.map((item, idx) => (
                  <PlanItem key={`${day.day}-${idx}`} item={item} />
                ))}
              </ul>
            </article>
          ))}
        </div>

        <aside className="space-y-8">
          <div>
            <h3 className="font-display text-xl font-bold">Packing list</h3>
            <div className="mt-3 space-y-4">
              {packing.map((group) => (
                <div key={group.title} className="rounded-xl border border-sky bg-paper p-4">
                  <p className="font-semibold">
                    <span aria-hidden>{group.emoji}</span> {group.title}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {group.items.map((item) => (
                      <li key={item}>
                        <label className="flex cursor-pointer items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked.has(item)}
                            onChange={() => toggleChecked(item)}
                            className="mt-0.5 h-4 w-4 accent-rail print:hidden"
                          />
                          <span className={checked.has(item) ? "text-ink-soft line-through" : ""}>
                            {item}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-display text-xl font-bold">Eat your way through</h3>
            <div className="mt-3 space-y-3">
              {destinations.map((d) => (
                <div key={d.id} className="rounded-xl border border-sky bg-paper p-4">
                  <p className="font-semibold">
                    {d.emoji} {d.name}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {d.foods.map((f) => (
                      <span key={f} className="rounded-full bg-sky/60 px-2.5 py-0.5 text-xs">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-display text-xl font-bold">Good to know</h3>
            <ul className="mt-3 space-y-2 rounded-xl border border-sky bg-paper p-4 text-sm">
              {plan.tips.map((tip) => (
                <li key={tip} className="flex gap-2">
                  <span aria-hidden className="text-seal">※</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}

function ShareTripCard({
  input,
  destinationNames,
}: {
  input: TripInput;
  destinationNames: string[];
}) {
  const router = useRouter();
  const [tripName, setTripName] = useState(`${destinationNames[0] ?? "China"} trip`);
  const [myName, setMyName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!myName.trim()) {
      setError("Add your name so the crew knows who's who.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripName: tripName.trim() || "China trip",
          creatorName: myName.trim(),
          startDate: startDate || null,
          input,
        }),
      });
      if (!res.ok) throw new Error(`Create failed (${res.status})`);
      const json: { id: string; joinCode: string } = await res.json();
      localStorage.setItem(`cip-member-${json.id}`, myName.trim());
      saveMyTrip({
        id: json.id,
        name: tripName.trim() || "China trip",
        startDate: startDate || null,
        days: input.days,
        destinations: destinationNames,
        role: "creator",
        memberName: myName.trim(),
      });
      router.push(`/trip/${json.id}?code=${json.joinCode}`);
    } catch {
      setError("Couldn't create the shared trip — is the server running?");
      setCreating(false);
    }
  };

  return (
    <div className="mt-6 rounded-xl border-2 border-dashed border-rail/40 bg-paper p-5 print:hidden">
      <h3 className="font-display text-lg font-semibold">Travelling together? 一起走</h3>
      <p className="mt-1 text-sm text-ink-soft">
        Turn this plan into a shared trip: everyone joins with a code, sees the same live
        itinerary, and ticks off packing and activities together.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-ink-soft">
          Trip name
          <input
            type="text"
            value={tripName}
            onChange={(e) => setTripName(e.target.value)}
            maxLength={60}
            className="mt-1 w-full rounded-lg border border-sky bg-mist px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-rail"
          />
        </label>
        <label className="text-xs font-medium text-ink-soft">
          Your name
          <input
            type="text"
            value={myName}
            onChange={(e) => setMyName(e.target.value)}
            maxLength={30}
            placeholder="e.g. Darren"
            className="mt-1 w-full rounded-lg border border-sky bg-mist px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-rail"
          />
        </label>
        <label className="text-xs font-medium text-ink-soft">
          Start date (optional)
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-sky bg-mist px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-rail"
          />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void create()}
          disabled={creating}
          className="rounded-lg bg-seal px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-seal/85 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Start shared trip →"}
        </button>
        {error && <span className="text-xs text-seal">{error}</span>}
      </div>
    </div>
  );
}

function PlanItem({ item }: { item: ScheduledItem }) {
  const slot = SLOT_META[item.slot];
  const isFiller = item.kind === "free";
  const transitEmoji = KIND_EMOJI[item.kind];
  return (
    <li className="flex gap-3">
      <span
        className="w-24 shrink-0 pt-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-soft"
        title={slot.label}
      >
        {slot.emoji} {item.fullDay ? "All day" : slot.label}
      </span>
      <div className="min-w-0">
        <p className={isFiller ? "text-sm italic text-ink-soft" : "text-sm font-medium"}>
          {transitEmoji && <span aria-hidden>{transitEmoji} </span>}
          {item.title}
        </p>
        {item.note && <p className="mt-0.5 text-xs text-ink-soft">{item.note}</p>}
      </div>
    </li>
  );
}
