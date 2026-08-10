"use client";

import { useMemo, useState } from "react";
import { CatalogSearch } from "@/components/CatalogSearch";
import { MapExplorer } from "@/components/map/MapExplorer";
import { DESTINATIONS } from "@/lib/data";
import { SEASON_EMOJI } from "@/lib/meta";
import type { CatalogHit } from "@/lib/tripShared";
import type { Destination } from "@/lib/types";

interface Props {
  selected: string[];
  visited: string[];
  extras: Record<string, CatalogHit>;
  onToggleSelect: (id: string) => void;
  onToggleVisited: (id: string) => void;
  onAddCatalog: (hit: CatalogHit) => void;
  onRemoveCatalog: (qid: string) => void;
  onReorder: (ids: string[]) => void;
  onMonthPicked: (month: number) => void;
}

export function DestinationStep({
  selected,
  visited,
  extras,
  onToggleSelect,
  onToggleVisited,
  onAddCatalog,
  onRemoveCatalog,
  onReorder,
  onMonthPicked,
}: Props) {
  const [view, setView] = useState<"map" | "cards">("map");
  const [region, setRegion] = useState("All");
  const [announcement, setAnnouncement] = useState("");
  const regions = useMemo(
    () => ["All", ...Array.from(new Set(DESTINATIONS.map((d) => d.region)))],
    []
  );

  const available = DESTINATIONS.filter(
    (d) => !visited.includes(d.id) && (region === "All" || d.region === region)
  );
  const visitedDests = DESTINATIONS.filter((d) => visited.includes(d.id));

  // The clicked card unmounts when a destination moves between the available
  // and visited lists, so announce the change for screen-reader users.
  const handleToggleVisited = (dest: Destination) => {
    const nowVisited = !visited.includes(dest.id);
    setAnnouncement(
      nowVisited
        ? `${dest.name} marked as visited and removed from selection`
        : `${dest.name} restored to the destination list`
    );
    onToggleVisited(dest.id);
  };

  return (
    <section>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">Where to this time?</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {view === "map"
              ? "Zoom the map, drag the timeline to your month, and tap places to add them."
              : "Pick one or more destinations. Mark places you've already been and they'll drop out of the running."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex overflow-hidden rounded-full border border-sky"
            role="group"
            aria-label="Switch between map and card view"
          >
            {(["map", "cards"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`px-3.5 py-1 text-xs font-medium transition-colors ${
                  view === v ? "bg-rail text-white" : "bg-paper text-ink-soft hover:bg-sky"
                }`}
              >
                {v === "map" ? "🗺️ Map" : "🎴 Cards"}
              </button>
            ))}
          </div>
          {view === "cards" && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by region">
              {regions.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRegion(r)}
                  aria-pressed={region === r}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    region === r
                      ? "bg-rail text-white"
                      : "bg-paper text-ink-soft hover:bg-sky"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {view === "map" && (
        <MapExplorer
          selected={selected}
          visited={visited}
          onToggleSelect={onToggleSelect}
          onAddCatalog={onAddCatalog}
          onRemoveCatalog={onRemoveCatalog}
          onReorder={onReorder}
          onMonthPicked={onMonthPicked}
        />
      )}

      {view === "cards" && (
        <>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((dest) => (
              <DestinationCard
                key={dest.id}
                dest={dest}
                isSelected={selected.includes(dest.id)}
                onSelect={() => onToggleSelect(dest.id)}
                onVisited={() => handleToggleVisited(dest)}
              />
            ))}
          </div>
          {available.length === 0 && (
            <p className="mt-6 rounded-xl border border-sky bg-paper p-6 text-sm text-ink-soft">
              Nothing left in this region — you&apos;ve been everywhere here! Switch region
              or restore a visited place below.
            </p>
          )}

          <CatalogSearch
            selectedIds={selected}
            extras={extras}
            onAdd={onAddCatalog}
            onRemove={onRemoveCatalog}
          />
        </>
      )}

      {visitedDests.length > 0 && (
        <div className="mt-10">
          <h3 className="font-display text-lg font-semibold text-ink-soft">
            Already been ({visitedDests.length})
          </h3>
          <p className="mt-1 text-xs text-ink-soft">
            These are hidden from selection. Restore one to make it plannable again.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {visitedDests.map((dest) => (
              <div
                key={dest.id}
                className="relative flex items-center gap-3 rounded-xl border border-sky bg-paper/60 p-4 opacity-75"
              >
                <span className="stamp absolute -top-2 right-3">去过</span>
                <span className="text-2xl grayscale">{dest.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{dest.name}</p>
                  <button
                    type="button"
                    onClick={() => handleToggleVisited(dest)}
                    className="text-xs text-rail underline-offset-2 hover:underline"
                  >
                    Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function DestinationCard({
  dest,
  isSelected,
  onSelect,
  onVisited,
}: {
  dest: Destination;
  isSelected: boolean;
  onSelect: () => void;
  onVisited: () => void;
}) {
  return (
    <div
      className={`relative flex flex-col rounded-xl border bg-paper transition-shadow ${
        isSelected ? "border-rail shadow-md" : "border-sky hover:shadow-md"
      }`}
    >
      {isSelected && <span className="stamp absolute right-3 top-3 z-10">已选</span>}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        className="flex-1 rounded-t-xl p-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rail"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden className="text-3xl">
            {dest.emoji}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h3 className="font-display text-lg font-bold">{dest.name}</h3>
              <span className="font-kai text-seal">{dest.chineseName}</span>
            </div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink-soft">
              {dest.region} China
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-soft">{dest.tagline}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {dest.knownFor.slice(0, 4).map((k) => (
            <span key={k} className="rounded-full bg-sky/60 px-2.5 py-0.5 text-xs">
              {k}
            </span>
          ))}
          {dest.knownFor.length > 4 && (
            <span className="self-center text-xs text-ink-soft">
              +{dest.knownFor.length - 4} more
            </span>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-ink-soft">
          <span title={`Best seasons: ${dest.bestSeasons.join(", ")}`}>
            Best {dest.bestSeasons.map((s) => SEASON_EMOJI[s]).join(" ")}
          </span>
          <span className="font-mono uppercase tracking-wider">
            {dest.suggestedDays[0]}–{dest.suggestedDays[1]} days
          </span>
        </div>
      </button>
      <div className="flex justify-end border-t border-dashed border-sky px-5 py-2">
        <button
          type="button"
          onClick={onVisited}
          className="text-xs text-ink-soft transition-colors hover:text-seal"
        >
          Been here already? Mark visited
        </button>
      </div>
    </div>
  );
}
