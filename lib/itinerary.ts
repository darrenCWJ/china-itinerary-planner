import {
  CN_DEPARTURE_AFTERNOON,
  CN_DEPARTURE_EVENING,
  CN_GENERAL_TIPS,
  CN_HOP_NOTE,
  CN_HOP_TITLE,
  CN_KIDS_TIP,
} from "./countryData/cn";
import { newId } from "./id";
import type { Activity, CountryCode, Destination, Interest, Season, TimeSlot } from "./types";

export interface TripInput {
  destinationIds: string[];
  days: number;
  season: Season;
  adults: number;
  kids: number;
  interests: Interest[];
  /**
   * ISO alpha-2. Optional because trips saved before the field existed do not
   * carry it — read it through `tripCountry`, never directly.
   */
  country?: CountryCode;
}

export type ItemKind = "activity" | "travel" | "arrival" | "departure" | "free" | "custom";

export interface ScheduledItem {
  /** Stable identity — survives edits and reorders; check keys hang off it. */
  id: string;
  slot: TimeSlot;
  /** True when the item fills both morning and afternoon. */
  fullDay?: boolean;
  kind: ItemKind;
  title: string;
  /** Free-text time, e.g. "19:00" — only on member-added items. */
  time?: string;
  /**
   * Minutes from midnight (0-1439). Optional *and* nullable: items saved before
   * time blocks existed carry no key at all, so a required-nullable field would
   * make every stored plan type-lie. Absent means untimed, and an untimed item
   * is never given a start it did not have.
   */
  startMinutes?: number | null;
  /** Block length in minutes. Absent/null alongside `startMinutes` = untimed. */
  durationMinutes?: number | null;
  note?: string;
  interests?: Interest[];
}

/** Item under construction — the id is stamped on when the day is finalised. */
type DraftItem = Omit<ScheduledItem, "id">;

export interface DayPlan {
  day: number;
  destinationId: string;
  destinationName: string;
  items: ScheduledItem[];
}

export interface TripPlan {
  days: DayPlan[];
  tips: string[];
}

/** Scores below this are treated as "do not schedule" (e.g. wrong season). */
const EXCLUDED = -50;

/**
 * China's tips, under the name generation has always used. The strings live in
 * countryData/cn.ts so lib/countryProfile.ts can read them without importing
 * this module — which it would otherwise have to, while this module has to
 * import the profile.
 */
export const GENERAL_TIPS = CN_GENERAL_TIPS;

/**
 * Substitute `{city}` in a copy template.
 *
 * split/join rather than String.replace: the city name is the *replacement*
 * argument, where a `$` sequence is a substitution pattern rather than text,
 * so a place name containing one would expand instead of appearing. (Written
 * after that exact footgun mangled this file during the refactor that moved
 * the template out.)
 */
function fillCity(template: string, city: string): string {
  return template.split("{city}").join(city);
}

export function scoreActivity(a: Activity, input: TripInput): number {
  if (a.avoidSeasons?.includes(input.season)) return EXCLUDED - 1;
  let score = 0;
  const overlap = a.interests.filter((i) => input.interests.includes(i)).length;
  score += overlap * 3;
  if (a.mustSee) score += 2.5;
  if (a.bestSeasons?.includes(input.season)) score += 1;
  if (input.kids > 0) {
    if (a.interests.includes("family") || a.interests.includes("themepark")) score += 2;
    if (a.interests.includes("nightlife")) score -= 1;
  }
  return score;
}

/**
 * Split totalDays across destinations proportionally to their suggested trip
 * length. Every destination gets at least one day; callers must pass at most
 * `totalDays` destinations.
 */
export function allocateDays(destinations: Destination[], totalDays: number): number[] {
  if (destinations.length === 0) return [];
  const weights = destinations.map((d) => (d.suggestedDays[0] + d.suggestedDays[1]) / 2);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const alloc = weights.map((w) => Math.max(1, Math.floor((totalDays * w) / totalWeight)));

  let diff = totalDays - alloc.reduce((a, b) => a + b, 0);
  const byWeight = destinations.map((_, i) => i).sort((a, b) => weights[b] - weights[a]);
  let k = 0;
  while (diff !== 0) {
    const i = byWeight[k % byWeight.length];
    if (diff > 0) {
      alloc[i] += 1;
      diff -= 1;
    } else if (alloc[i] > 1) {
      alloc[i] -= 1;
      diff += 1;
    } else if (alloc.every((x) => x <= 1)) {
      break; // cannot shrink below one day per destination
    }
    k += 1;
  }
  return alloc;
}

function canFill(a: Activity, slot: TimeSlot, freeSlots: number): boolean {
  if (a.timeOfDay === "evening") return false;
  if (a.slots === 2) {
    return freeSlots >= 2 && (a.timeOfDay === "day" || a.timeOfDay === "any");
  }
  if (a.timeOfDay === "day" || a.timeOfDay === "any") return true;
  return a.timeOfDay === slot;
}

interface Ranked {
  a: Activity;
  s: number;
}

function activityItem(a: Activity, slot: TimeSlot, fullDay: boolean): DraftItem {
  return {
    slot,
    fullDay: fullDay || undefined,
    kind: "activity",
    title: a.name,
    note: a.note,
    interests: a.interests,
  };
}

function pickEvening(ranked: Ranked[], used: Set<string>): DraftItem | null {
  const evening = ranked.find((x) => !used.has(x.a.name) && x.a.timeOfDay === "evening");
  const pick =
    evening ??
    ranked.find((x) => !used.has(x.a.name) && x.a.timeOfDay === "any" && x.a.slots === 1);
  if (!pick) return null;
  used.add(pick.a.name);
  return activityItem(pick.a, "evening", false);
}

export function buildItinerary(input: TripInput, all: Destination[]): TripPlan {
  const chosen = input.destinationIds
    .map((id) => all.find((d) => d.id === id))
    .filter((d): d is Destination => Boolean(d));
  if (chosen.length === 0 || input.days < 1) {
    return { days: [], tips: [] };
  }

  // Never plan more destinations than there are days.
  const active = chosen.slice(0, Math.min(chosen.length, input.days));
  const alloc = allocateDays(active, input.days);

  const days: DayPlan[] = [];
  let dayNum = 1;

  active.forEach((dest, di) => {
    const ranked: Ranked[] = dest.activities
      .map((a) => ({ a, s: scoreActivity(a, input) }))
      .filter((x) => x.s > EXCLUDED)
      .sort((x, y) => y.s - x.s);
    const used = new Set<string>();

    for (let d = 0; d < alloc[di]; d += 1) {
      const isFirstOfTrip = dayNum === 1;
      const isNewCity = d === 0 && di > 0;
      const isLastOfTrip = dayNum === input.days;
      const items: DraftItem[] = [];
      let free: TimeSlot[] = ["morning", "afternoon"];

      if (isFirstOfTrip) {
        items.push({
          slot: "morning",
          kind: "arrival",
          title: `Arrive in ${dest.name} — check in, drop bags and get your bearings`,
        });
        free = ["afternoon"];
      } else if (isNewCity) {
        items.push({
          slot: "morning",
          kind: "travel",
          title: fillCity(CN_HOP_TITLE, dest.name),
          note: CN_HOP_NOTE,
        });
        free = ["afternoon"];
      }

      // On the last day, departure normally takes the afternoon — but if
      // transit already consumed the morning, keep the afternoon free for one
      // activity and leave in the evening instead, so a city that only gets a
      // single day still gets something to do.
      const morningIsTransit = isFirstOfTrip || isNewCity;
      let departure: DraftItem | null = null;
      if (isLastOfTrip) {
        if (morningIsTransit) {
          departure = {
            slot: "evening",
            kind: "departure",
            title: CN_DEPARTURE_EVENING,
          };
        } else {
          free = free.filter((s) => s !== "afternoon");
          departure = {
            slot: "afternoon",
            kind: "departure",
            title: CN_DEPARTURE_AFTERNOON,
          };
        }
      }

      while (free.length > 0) {
        const slot = free[0];
        const pick = ranked.find((x) => !used.has(x.a.name) && canFill(x.a, slot, free.length));
        if (pick) {
          used.add(pick.a.name);
          const isFullDay = pick.a.slots === 2;
          items.push(activityItem(pick.a, slot, isFullDay));
          free = free.slice(isFullDay ? 2 : 1);
        } else {
          items.push({
            slot,
            kind: "free",
            title: `Free time — wander ${dest.name} at your own pace`,
          });
          free = free.slice(1);
        }
      }

      if (departure) items.push(departure);

      if (!isLastOfTrip) {
        const dish =
          dest.foods.length > 0 ? dest.foods[d % dest.foods.length] : "the local speciality";
        const evening =
          pickEvening(ranked, used) ??
          ({
            slot: "evening",
            kind: "free",
            title: `Dinner at a local spot — try ${dish.toLowerCase()}`,
          } satisfies DraftItem);
        items.push(evening);
      }

      days.push({
        day: dayNum,
        destinationId: dest.id,
        destinationName: dest.name,
        items: items.map((it): ScheduledItem => ({ ...it, id: newId() })),
      });
      dayNum += 1;
    }
  });

  return { days, tips: buildTips(input, active) };
}

function buildTips(input: TripInput, destinations: Destination[]): string[] {
  const tips = [...GENERAL_TIPS];
  destinations.forEach((d) => {
    const note = d.seasonNotes[input.season];
    if (note) tips.push(`${d.name} in ${input.season}: ${note}`);
  });
  if (input.kids > 0) {
    tips.push(CN_KIDS_TIP);
  }
  return tips;
}
