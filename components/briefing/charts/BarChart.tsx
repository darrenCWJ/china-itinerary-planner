import type { ChartSlice } from "@/lib/briefing";

type Props = {
  title: string;
  slices: ChartSlice[];
  /** Plural noun for the screen-reader summary, e.g. "days". */
  unit: string;
};

export function BarChart({ title, slices, unit }: Props) {
  if (slices.length === 0) return null;
  const max = Math.max(...slices.map((s) => s.value), 1);

  return (
    <figure className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-4">
      <figcaption className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-2)]">
        {title}
      </figcaption>
      <ul className="mt-3 space-y-2">
        {slices.map((s) => (
          <li
            key={s.label}
            className="grid grid-cols-[6rem_1fr_2rem] items-center gap-2 text-sm sm:grid-cols-[9rem_1fr_2rem]"
          >
            <span className="truncate text-[var(--ink-2)]" title={s.label}>
              {s.label}
            </span>
            <span className="h-2.5 rounded-full bg-[var(--line-1)]" aria-hidden="true">
              <span
                className="block h-full rounded-full bg-[var(--accent-ink)]"
                style={{ width: `${(s.value / max) * 100}%` }}
              />
            </span>
            <span className="text-right tabular-nums font-medium text-[var(--ink-0)]">{s.value}</span>
          </li>
        ))}
      </ul>
      <p className="sr-only">
        {slices.map((s) => `${s.label}: ${s.value} ${unit}`).join(", ")}
      </p>
    </figure>
  );
}
