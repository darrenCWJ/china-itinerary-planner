import type { PacePoint } from "@/lib/briefing";

type Props = {
  title: string;
  points: PacePoint[];
};

const VIEW_W = 100;
const VIEW_H = 30;
const GAP = 1.2;

export function ColumnChart({ title, points }: Props) {
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.items), 1);
  const barW = (VIEW_W - GAP * (points.length - 1)) / points.length;

  return (
    <figure className="rounded-xl border border-sky bg-paper p-4">
      <figcaption className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
        {title}
      </figcaption>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="mt-3 h-20 w-full"
        role="img"
        aria-label={`Items per day: ${points.map((p) => `day ${p.day}, ${p.items}`).join("; ")}`}
      >
        {points.map((p, i) => {
          const h = (p.items / max) * VIEW_H;
          return (
            <rect
              key={p.day}
              x={i * (barW + GAP)}
              y={VIEW_H - h}
              width={barW}
              height={h}
              className="fill-rail"
            />
          );
        })}
      </svg>
      <p className="mt-1 flex justify-between text-[0.65rem] text-ink-soft">
        <span>Day {points[0].day}</span>
        <span>Day {points[points.length - 1].day}</span>
      </p>
    </figure>
  );
}
