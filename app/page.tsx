import Link from "next/link";
import { TripsDashboard } from "@/components/home/TripsDashboard";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--accent-ink)]">
            Your trips
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold [text-wrap:balance]">
            Where are we going?
          </h1>
        </div>
        <Link
          href="/plan"
          className="flex min-h-[var(--tap-min)] items-center rounded-lg bg-[var(--accent-ink)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))]"
        >
          Plan a new trip →
        </Link>
      </div>
      <TripsDashboard />
    </main>
  );
}
