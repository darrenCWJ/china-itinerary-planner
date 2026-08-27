"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DestinationStep } from "@/components/DestinationStep";
import { DetailsStep } from "@/components/DetailsStep";
import { GeoNamesCredit } from "@/components/plan/GeoNamesCredit";
import { PlanStep } from "@/components/PlanStep";
import { mergeCatalogHit, shouldFetchEnrichment } from "@/lib/catalogExtras";
import { DESTINATIONS } from "@/lib/data";
import { resolveTripSeason } from "@/lib/tripSeason";
import { WIZARD_STEPS, canAdvance } from "@/lib/wizard";
import type { TripInput } from "@/lib/itinerary";
import type { CatalogHit } from "@/lib/tripShared";
import type { Destination, Interest, Season } from "@/lib/types";

const VISITED_KEY = "cip-visited-v1";
const MAX_DAYS = 21;

export default function PlanPage() {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [visited, setVisited] = useState<string[]>([]);
  const [season, setSeason] = useState<Season>("autumn");
  /**
   * The month the user picked on the destinations map, when they picked one.
   *
   * Season is kept as its own state rather than derived from this, because a
   * user who never touches the map has a season and no month. When they do
   * touch it, the season is re-derived through `resolveTripSeason` — the same
   * function the write route calls (app/api/trips/route.ts), so the preview on
   * step 2 and the trip that gets saved cannot disagree. They did, for every
   * southern-hemisphere country: this file called the bare northern
   * `seasonOfMonth`, so a June Peru trip previewed summer and saved winter.
   */
  const [month, setMonth] = useState<number | null>(null);
  /**
   * The country being planned. Lifted out of DestinationStep, where it was local
   * state that never left the component — so the world picker's choice was
   * discarded at the write boundary and TripInputSchema defaulted every trip to
   * "CN". That silently reverted the season derivation to China's hemisphere and
   * pinned the accent and hero to China. Found by review, not by a test.
   */
  const [country, setCountry] = useState("CN");
  const [days, setDays] = useState(5);
  const [adults, setAdults] = useState(2);
  const [kids, setKids] = useState(0);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [extras, setExtras] = useState<Record<string, CatalogHit>>({});
  const [extraDestinations, setExtraDestinations] = useState<Destination[]>([]);
  /**
   * Hand-typed places (spec §3.2.7). Held separately from `extras` because those
   * are catalog hits that `goToPlan` resolves through the API, and these have
   * nothing to resolve — they exist only here, so they are merged into the
   * generator's input directly.
   */
  const [offMap, setOffMap] = useState<Destination[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  /**
   * Ids the lazy enrichment fetch has already been fired for, this session.
   *
   * Never cleared. A city Wikidata has nothing for resolves to a cached miss,
   * which leaves `description` null forever — so without this the guard in
   * `shouldFetchEnrichment` stays true and every re-pick re-asks. A ref rather
   * than state because nothing renders from it and a write must be visible to
   * the very next `addCatalog` call in the same tick.
   */
  const enrichRequested = useRef<Set<string>>(new Set());

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

  /**
   * Adds a catalog city to the trip and remembers what the producer knew.
   *
   * `mergeCatalogHit`, not a wholesale overwrite: search and the map both write
   * this key, and only the map's hit carries a population, a blurb and an
   * attraction count. See lib/catalogExtras.ts — the rule lives there because
   * no test file may live under app/.
   *
   * `selected` is still deduped by id alone, and that is deliberate. A Wikidata
   * `Q…` and a GeoNames `G…` for the same city are two ids, but a `CatalogHit`
   * carries no coordinates, so the only key available here is the name — and
   * `PlaceSearch`'s measurements against the committed data say name alone
   * folds 32 genuinely different Chinese cities into one (the two Yushus are
   * 2,852 km apart). Both producers already dedupe on strictly better keys:
   * search on name-plus-province (Task 13), the map on 25 km of haversine
   * distance (Task 14). A third, blinder pass here would drop real cities to
   * catch the residue.
   */
  const addCatalog = (hit: CatalogHit) => {
    // Read for the fetch decision only; the state writes below use the updater
    // form so they cannot race a second pick in the same tick.
    const merged = mergeCatalogHit(extras[hit.qid], hit);
    setExtras((prev) => ({ ...prev, [hit.qid]: mergeCatalogHit(prev[hit.qid], hit) }));
    setSelected((prev) => (prev.includes(hit.qid) ? prev : [...prev, hit.qid]));
    // A city outside the build-time top 30 arrives with no description; the
    // first time anyone selects it, fetch one (spec §4). Fire-and-forget: the
    // pick is already committed above and a missing blurb is an accepted
    // state, so nothing here is allowed to block or to fail loudly.
    //
    // The three refusals live in `shouldFetchEnrichment` — see lib/catalogExtras.ts
    // for why each one exists and why the guard is not inline here.
    if (!shouldFetchEnrichment(merged, enrichRequested.current)) return;
    enrichRequested.current.add(hit.qid);
    void fetch(`/api/cities/enrich?ids=${encodeURIComponent(hit.qid)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { enrichment?: Record<string, { description: string | null }> } | null) => {
        const description = json?.enrichment?.[hit.qid]?.description ?? null;
        if (description === null) return;
        setExtras((prev) =>
          prev[hit.qid] ? { ...prev, [hit.qid]: { ...prev[hit.qid], description } } : prev
        );
      })
      .catch(() => {});
  };

  const removeCatalog = (qid: string) => {
    setSelected((prev) => prev.filter((x) => x !== qid));
    setOffMap((prev) => prev.filter((d) => d.id !== qid));
  };

  /**
   * A place the user typed that no dataset knows. It gets no coordinates, the
   * off-map default range (spec §5.6), and no activities — the generator gives
   * it days without inventing things to do there.
   */
  const addOffMap = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = `offmap:${trimmed.toLowerCase().replace(/\s+/g, "-")}`;
    if (selected.includes(id)) return;
    const place: Destination = {
      id,
      name: trimmed,
      localName: null,
      // Region is required — a plain string now that PR3 retired the Region
      // union. Nothing reads it for a place with no coordinates, so this is a
      // placeholder, not a claim.
      region: "",
      // The country that is actually open. Hard-coding "CN" here put every
      // hand-typed place in China regardless of the trip it was typed into.
      country,
      lat: null,
      lon: null,
      emoji: "📍",
      tagline: "Added by hand — no map pin.",
      knownFor: [],
      bestSeasons: [],
      seasonNotes: {},
      foods: [],
      suggestedDays: [1, 2],
      activities: [],
    };
    setOffMap((prev) => [...prev, place]);
    setSelected((prev) => [...prev, id]);
  };

  /** Catalog picks need their full activity data fetched before planning. */
  const goToPlan = async () => {
    // Off-map picks are already complete objects — only catalog qids need the
    // resolve call, so they are excluded from it and re-attached after.
    const offMapIds = new Set(offMap.map((d) => d.id));
    const qids = selected.filter(
      (id) => !DESTINATIONS.some((d) => d.id === id) && !offMapIds.has(id)
    );
    if (qids.length === 0) {
      setExtraDestinations([...offMap]);
      setStep(2);
      return;
    }
    setResolving(true);
    setResolveError(null);
    try {
      const res = await fetch(`/api/destinations/resolve?ids=${qids.join(",")}`);
      if (!res.ok) throw new Error(`Resolve failed (${res.status})`);
      const json: { destinations: Destination[] } = await res.json();
      setExtraDestinations([...json.destinations, ...offMap]);
      setStep(2);
    } catch {
      setResolveError("Couldn't load catalog destinations — try again.");
    } finally {
      setResolving(false);
    }
  };

  const tripInput = useMemo<TripInput>(
    () => ({ destinationIds: selected, days, season, adults, kids, interests, country }),
    [selected, days, season, adults, kids, interests, country]
  );

  const canNext = canAdvance(step, { selectedCount: selected.length, days });

  const restart = () => {
    setStep(0);
    setSelected([]);
    setInterests([]);
    setExtras({});
    setExtraDestinations([]);
    setResolveError(null);
    setMonth(null);
    setOffMap([]);
    setCountry("CN");
  };

  return (
    /* pb-24 removed with the fixed footer — nothing overlays the content now. */
    <div className="min-h-screen">
      <nav aria-label="Progress" className="mx-auto max-w-6xl px-4 pt-6 print:hidden">
        <ol className="flex items-center gap-1 sm:gap-2">
          {WIZARD_STEPS.map((label, i) => {
            const isDone = i < step;
            const isCurrent = i === step;
            return (
              <li key={label} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => isDone && setStep(i)}
                  disabled={!isDone && !isCurrent}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ink)] sm:gap-2 sm:px-3.5 ${
                    isCurrent
                      ? "bg-[var(--accent-ink)] text-[var(--paper)]"
                      : isDone
                        ? "bg-[var(--line-1)] text-[var(--accent-ink)] hover:bg-[var(--line-1)]/70"
                        : "bg-[var(--paper)] text-[var(--ink-2)]"
                  }`}
                >
                  <span className="font-mono text-xs">{isDone ? "✓" : i + 1}</span>
                  {label}
                </button>
                {i < WIZARD_STEPS.length - 1 && (
                  <span aria-hidden className="h-px w-6 bg-[var(--line-1)] sm:w-10" />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="mx-auto max-w-6xl px-4 pt-6">
        {/*
          Details first (spec §3.2.1): the feasibility counter on the next step
          cannot say whether five cities fit until the trip has a day count.
        */}
        {step === 0 && (
          <DetailsStep
            season={season}
            onSeason={setSeason}
            /*
              The season chips caption themselves with this country's months.
              Step 0 runs before the picker on step 1, so this is "CN" on a
              first pass — but the wizard lets a completed step be reopened,
              and coming back to Details after choosing Peru used to show a
              Peruvian traveller Mar–May under the word Spring.
            */
            country={country}
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
        {step === 1 && (
          <DestinationStep
            selected={selected}
            visited={visited}
            extras={extras}
            days={days}
            onToggleSelect={toggleSelect}
            onToggleVisited={toggleVisited}
            onAddCatalog={addCatalog}
            onRemoveCatalog={removeCatalog}
            onReorder={setSelected}
            country={country}
            onCountryChange={(next) => {
              setCountry(next);
              // Picking the month and then switching country is the same
              // hemisphere bug in the other order: the month was read through
              // the country that was open at the time. Re-derive, so the two
              // orders of the same two clicks end on the same season.
              if (month !== null) setSeason(resolveTripSeason(season, month, next));
            }}
            onAddOffMap={addOffMap}
            offMap={offMap}
            /*
              Dragging the month slider now happens *after* the season control on
              step 0, so it wins. That is deliberate: moving the slider is an
              explicit act, and a user who sets it to January means January.

              Derived through `resolveTripSeason`, which is the rule the write
              route (app/api/trips/route.ts) applies to the very same month — not
              `lib/months.ts`'s bare `seasonOfMonth`, whose table is hardcoded
              northern. C8 in lib/contracts.test.ts scans this file for a
              relapse, because no test file may live under app/.
            */
            onMonthPicked={(m) => {
              setMonth(m);
              setSeason(resolveTripSeason(season, m, country));
            }}
          />
        )}
        {step === 2 && (
          <PlanStep input={tripInput} extraDestinations={extraDestinations} month={month} />
        )}
      </main>

      {/*
        C2: not `fixed`. The shell owns the bottom edge, and two pinned bottom
        elements cannot coexist — the mobile bottom bar lands where this used to
        sit. In normal flow it also stops covering the last row of a long
        destination list, which the pinned version did at short viewport heights.
        lib/contracts.test.ts scans for any reintroduction.
      */}
      <footer className="mx-auto mt-8 max-w-6xl border-t border-[var(--line-1)] px-4 py-3 print:hidden">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => (step === 0 ? undefined : setStep(step - 1))}
            disabled={step === 0}
            className="rounded-lg border border-[var(--line-1)] px-4 py-2 text-sm font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)] disabled:opacity-40 disabled:hover:border-[var(--line-1)] disabled:hover:text-[var(--ink-2)]"
          >
            ← Back
          </button>
          <p className="hidden text-sm text-[var(--ink-2)] sm:block">
            {step === 0 &&
              `${days} day${days > 1 ? "s" : ""} · ${adults + kids} traveller${adults + kids > 1 ? "s" : ""}`}
            {step === 1 &&
              (selected.length === 0
                ? "Select at least one destination to continue"
                : `${selected.length} destination${selected.length > 1 ? "s" : ""} selected`)}
            {step === 2 && "Print it or go back to tweak the trip"}
          </p>
          {step < 2 ? (
            <div className="flex items-center gap-3">
              {resolveError && <span className="text-xs text-[var(--seal)]">{resolveError}</span>}
              <button
                type="button"
                onClick={() => {
                  if (!canNext || resolving) return;
                  if (step === 1) void goToPlan();
                  else setStep(step + 1);
                }}
                disabled={!canNext || resolving}
                className="rounded-lg bg-[var(--accent-ink)] px-5 py-2 text-sm font-semibold text-[var(--paper)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))] disabled:opacity-40 disabled:hover:bg-[var(--accent-ink)]"
              >
                {step === 1 ? (resolving ? "Loading…" : "Build my plan →") : "Next →"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={restart}
              className="rounded-lg border border-[var(--seal)] px-5 py-2 text-sm font-semibold text-[var(--seal)] transition-colors hover:bg-[var(--seal)] hover:text-[var(--paper)]"
            >
              Plan another trip
            </button>
          )}
        </div>
      </footer>

      {/*
        Beside the footer, not inside it — and NOT inside DestinationStep alone.

        Two separate reasons stack here. DestinationStep is mounted under
        `{step === 1 && (`, so step 0 and the generated plan on step 2 would
        carry no credit at all, and step 2 is full of GeoNames city names, day
        counts and route legs. And the footer above is `print:hidden`, while the
        app has its own "Print / save as PDF" button in components/PlanStep.tsx
        — so a credit nested in that footer is absent from the one artifact a
        traveller actually carries around. `display: none` on the footer wins
        over any `print:block` written on a descendant, so the fix is to be a
        sibling of the footer rather than a child of it.

        lib/contracts.test.ts (C7) scans for a `<GeoNamesCredit` that sits
        inside a `print:hidden` container, so moving it back fails CI.
      */}
      <div className="mx-auto max-w-6xl px-4 pb-6">
        <GeoNamesCredit />
      </div>
    </div>
  );
}
