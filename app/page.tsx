"use client";

import { useEffect, useMemo, useState } from "react";
import { DestinationStep } from "@/components/DestinationStep";
import { DetailsStep } from "@/components/DetailsStep";
import { PlanStep } from "@/components/PlanStep";
import { TripsDashboard } from "@/components/home/TripsDashboard";
import { DESTINATIONS } from "@/lib/data";
import { seasonOfMonth } from "@/lib/months";
import type { TripInput } from "@/lib/itinerary";
import type { CatalogHit } from "@/lib/tripShared";
import type { Destination, Interest, Season } from "@/lib/types";

const STEPS = ["Destinations", "Trip details", "Your plan"] as const;
const VISITED_KEY = "cip-visited-v1";
const MAX_DAYS = 21;

export default function Home() {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [visited, setVisited] = useState<string[]>([]);
  const [season, setSeason] = useState<Season>("autumn");
  const [days, setDays] = useState(5);
  const [adults, setAdults] = useState(2);
  const [kids, setKids] = useState(0);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [extras, setExtras] = useState<Record<string, CatalogHit>>({});
  const [extraDestinations, setExtraDestinations] = useState<Destination[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(VISITED_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setVisited(parsed.filter((x): x is string => typeof x === "string"));
        }
      }
    } catch {
      // Corrupted storage — start fresh rather than crash.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      localStorage.setItem(VISITED_KEY, JSON.stringify(visited));
    }
  }, [visited, hydrated]);

  const toggleSelect = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const toggleVisited = (id: string) => {
    const isVisited = visited.includes(id);
    setVisited(isVisited ? visited.filter((x) => x !== id) : [...visited, id]);
    if (!isVisited) setSelected(selected.filter((x) => x !== id));
  };

  const toggleInterest = (id: Interest) =>
    setInterests((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const addCatalog = (hit: CatalogHit) => {
    setExtras((prev) => ({ ...prev, [hit.qid]: hit }));
    setSelected((prev) => (prev.includes(hit.qid) ? prev : [...prev, hit.qid]));
  };

  const removeCatalog = (qid: string) => {
    setSelected((prev) => prev.filter((x) => x !== qid));
  };

  /** Catalog picks need their full activity data fetched before planning. */
  const goToPlan = async () => {
    const qids = selected.filter((id) => !DESTINATIONS.some((d) => d.id === id));
    if (qids.length === 0) {
      setExtraDestinations([]);
      setStep(2);
      return;
    }
    setResolving(true);
    setResolveError(null);
    try {
      const res = await fetch(`/api/destinations/resolve?ids=${qids.join(",")}`);
      if (!res.ok) throw new Error(`Resolve failed (${res.status})`);
      const json: { destinations: Destination[] } = await res.json();
      setExtraDestinations(json.destinations);
      setStep(2);
    } catch {
      setResolveError("Couldn't load catalog destinations — try again.");
    } finally {
      setResolving(false);
    }
  };

  const tripInput = useMemo<TripInput>(
    () => ({ destinationIds: selected, days, season, adults, kids, interests }),
    [selected, days, season, adults, kids, interests]
  );

  const canNext = step === 0 ? selected.length > 0 : step === 1;

  const restart = () => {
    setStep(0);
    setSelected([]);
    setInterests([]);
    setExtras({});
    setExtraDestinations([]);
    setResolveError(null);
  };

  return (
    <div className="min-h-screen pb-24">
      <header className="border-b border-sky bg-paper print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-seal font-kai text-xl text-white">
              游
            </span>
            <div>
              <h1 className="font-display text-xl font-bold leading-tight">
                China Itinerary Planner
              </h1>
              <p className="text-xs text-ink-soft">
                Pick places → tune the trip → get your day-by-day plan
              </p>
            </div>
          </div>
          <span className="hidden font-kai text-lg text-seal sm:block">一路平安</span>
        </div>
      </header>

      <nav aria-label="Progress" className="mx-auto max-w-6xl px-4 pt-6 print:hidden">
        <ol className="flex items-center gap-1 sm:gap-2">
          {STEPS.map((label, i) => {
            const isDone = i < step;
            const isCurrent = i === step;
            return (
              <li key={label} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => isDone && setStep(i)}
                  disabled={!isDone && !isCurrent}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rail sm:gap-2 sm:px-3.5 ${
                    isCurrent
                      ? "bg-rail text-white"
                      : isDone
                        ? "bg-sky text-rail-deep hover:bg-sky/70"
                        : "bg-paper text-ink-soft"
                  }`}
                >
                  <span className="font-mono text-xs">{isDone ? "✓" : i + 1}</span>
                  {label}
                </button>
                {i < STEPS.length - 1 && (
                  <span aria-hidden className="h-px w-6 bg-sky sm:w-10" />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="mx-auto max-w-6xl px-4 pt-6">
        {step === 0 && <TripsDashboard />}
        {step === 0 && (
          <DestinationStep
            selected={selected}
            visited={visited}
            extras={extras}
            onToggleSelect={toggleSelect}
            onToggleVisited={toggleVisited}
            onAddCatalog={addCatalog}
            onRemoveCatalog={removeCatalog}
            onReorder={setSelected}
            onMonthPicked={(m) => setSeason(seasonOfMonth(m))}
          />
        )}
        {step === 1 && (
          <DetailsStep
            season={season}
            onSeason={setSeason}
            days={days}
            onDays={(d) => setDays(Math.min(MAX_DAYS, Math.max(1, d)))}
            maxDays={MAX_DAYS}
            adults={adults}
            onAdults={(n) => setAdults(Math.min(12, Math.max(1, n)))}
            kids={kids}
            onKids={(n) => setKids(Math.min(12, Math.max(0, n)))}
            interests={interests}
            onToggleInterest={toggleInterest}
          />
        )}
        {step === 2 && <PlanStep input={tripInput} extraDestinations={extraDestinations} />}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-sky bg-paper/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={() => (step === 0 ? undefined : setStep(step - 1))}
            disabled={step === 0}
            className="rounded-lg border border-sky px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:border-rail hover:text-rail disabled:opacity-40 disabled:hover:border-sky disabled:hover:text-ink-soft"
          >
            ← Back
          </button>
          <p className="hidden text-sm text-ink-soft sm:block">
            {step === 0 &&
              (selected.length === 0
                ? "Select at least one destination to continue"
                : `${selected.length} destination${selected.length > 1 ? "s" : ""} selected`)}
            {step === 1 && `${days} day${days > 1 ? "s" : ""} · ${adults + kids} traveller${adults + kids > 1 ? "s" : ""}`}
            {step === 2 && "Print it or go back to tweak the trip"}
          </p>
          {step < 2 ? (
            <div className="flex items-center gap-3">
              {resolveError && <span className="text-xs text-seal">{resolveError}</span>}
              <button
                type="button"
                onClick={() => {
                  if (!canNext || resolving) return;
                  if (step === 1) void goToPlan();
                  else setStep(step + 1);
                }}
                disabled={!canNext || resolving}
                className="rounded-lg bg-rail px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-rail-deep disabled:opacity-40 disabled:hover:bg-rail"
              >
                {step === 1 ? (resolving ? "Loading…" : "Build my plan →") : "Next →"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={restart}
              className="rounded-lg border border-seal px-5 py-2 text-sm font-semibold text-seal transition-colors hover:bg-seal hover:text-white"
            >
              Plan another trip
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
