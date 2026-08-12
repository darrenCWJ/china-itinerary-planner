"use client";

import { useState } from "react";
import { BarChart } from "@/components/briefing/charts/BarChart";
import { ColumnChart } from "@/components/briefing/charts/ColumnChart";
import type { Briefing, BriefingDay } from "@/lib/briefing";
import { KIND_EMOJI, SLOT_META, ticketKindMeta } from "@/lib/meta";

function DayPanel({ day }: { day: BriefingDay }) {
  return (
    <article className="rounded-2xl border border-sky bg-paper p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-sky pb-3">
        <div>
          <span className="rounded-full bg-sky px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-rail-deep">
            {day.destinationName}
          </span>
          <h4 className="mt-2 font-display text-xl text-ink">Day {day.day}</h4>
        </div>
        {day.date && <time className="text-sm text-ink-soft">{day.date}</time>}
      </header>
      {day.items.length === 0 ? (
        <p className="mt-4 text-sm italic text-ink-soft">Nothing scheduled — a free day.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {day.items.map((item) => (
            <li key={item.id} className="flex gap-3 text-sm">
              <span className="w-20 shrink-0 pt-0.5 text-xs uppercase tracking-wide text-ink-soft">
                {item.time ?? SLOT_META[item.slot].label}
              </span>
              <span>
                <span className="font-medium text-ink">
                  {KIND_EMOJI[item.kind] ? `${KIND_EMOJI[item.kind]} ` : ""}
                  {item.title}
                </span>
                {item.note && <span className="block text-xs text-ink-soft">{item.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function BriefingView({ briefing }: { briefing: Briefing }) {
  const [selected, setSelected] = useState(briefing.days[0]?.day ?? 1);

  return (
    <div className="space-y-10">
      <section className="rounded-2xl border border-sky bg-mist p-6">
        <h2 className="font-display text-3xl text-ink">{briefing.title}</h2>
        <p className="mt-1 text-ink-soft">{briefing.subtitle}</p>
        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          {briefing.dateRange && (
            <div className="rounded-xl bg-paper p-4">
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Dates</dt>
              <dd className="mt-1 font-medium text-ink">
                {briefing.dateRange.start} → {briefing.dateRange.end}
              </dd>
            </div>
          )}
          <div className="rounded-xl bg-paper p-4">
            <dt className="text-xs uppercase tracking-wide text-ink-soft">Party</dt>
            <dd className="mt-1 font-medium text-ink">
              {briefing.party.adults} adults
              {briefing.party.kids > 0 && `, ${briefing.party.kids} kids`}
            </dd>
          </div>
          <div className="rounded-xl bg-paper p-4">
            <dt className="text-xs uppercase tracking-wide text-ink-soft">Route</dt>
            <dd className="mt-1 font-medium text-ink">
              {briefing.cities.map((c) => c.name).join(" → ")}
            </dd>
          </div>
        </dl>
        {briefing.crew && (
          <p className="mt-4 text-xs text-ink-soft">
            {briefing.crew.members.join(", ")} · {briefing.crew.checkedCount} items ticked off
          </p>
        )}
      </section>

      <section>
        <h3 className="font-display text-2xl text-ink">The journey</h3>
        <div className="mt-4 grid gap-6 lg:grid-cols-12">
          <nav className="flex gap-2 overflow-x-auto lg:col-span-4 lg:flex-col lg:overflow-visible print:hidden">
            {briefing.days.map((d) => (
              <button
                key={d.day}
                type="button"
                onClick={() => setSelected(d.day)}
                aria-pressed={selected === d.day}
                className={`shrink-0 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                  selected === d.day
                    ? "border-rail bg-paper text-ink"
                    : "border-transparent bg-mist text-ink-soft hover:bg-sky"
                }`}
              >
                <span className="block text-xs text-ink-soft">{d.date ?? `Day ${d.day}`}</span>
                <span className="font-medium">{d.destinationName}</span>
              </button>
            ))}
          </nav>
          <div className="space-y-5 lg:col-span-8">
            {briefing.days.map((d) => (
              <div
                key={d.day}
                className={d.day === selected ? "lg:block" : "lg:hidden print:block"}
              >
                <DayPanel day={d} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h3 className="font-display text-2xl text-ink">At a glance</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <BarChart title="Days per city" slices={briefing.charts.daysPerCity} unit="days" />
          <BarChart title="Interest mix" slices={briefing.charts.interestMix} unit="tagged items" />
          <ColumnChart title="Daily pace" points={briefing.charts.pace} />
        </div>
      </section>

      {(briefing.logistics.bookings.length > 0 || briefing.logistics.tips.length > 0) && (
        <section>
          <h3 className="font-display text-2xl text-ink">Logistics</h3>
          {briefing.logistics.bookings.length > 0 && (
            <ul className="mt-4 grid gap-3 md:grid-cols-3">
              {briefing.logistics.bookings.map((b, i) => (
                <li
                  key={`${b.kind}-${b.title}-${i}`}
                  className="rounded-xl border-l-4 border-rail bg-paper p-4 shadow-sm"
                >
                  <div className="text-xs font-bold uppercase tracking-wide text-rail">
                    {ticketKindMeta(b.kind).emoji} {ticketKindMeta(b.kind).label}
                  </div>
                  <div className="mt-1 font-medium text-ink">{b.title}</div>
                  <div className="text-sm text-ink-soft">
                    {[b.date, b.time, b.from && b.to ? `${b.from} → ${b.to}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {b.confirmation && (
                    <div className="mt-2 font-mono text-xs text-ink">{b.confirmation}</div>
                  )}
                  {b.price && <div className="text-xs text-ink-soft">{b.price}</div>}
                  {b.notes && <div className="mt-1 text-xs italic text-ink-soft">{b.notes}</div>}
                </li>
              ))}
            </ul>
          )}
          {briefing.logistics.tips.length > 0 && (
            <ul className="mt-4 space-y-2">
              {briefing.logistics.tips.map((tip) => (
                <li key={tip} className="flex gap-2 text-sm text-ink-soft">
                  <span aria-hidden="true">·</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
