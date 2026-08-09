import type { TripInput, TripPlan } from "./itinerary";
import type { PackingGroup } from "./packing";

/** Snapshot stored per trip and served to every member. */
export interface TripData {
  tripName: string;
  startDate: string | null;
  input: TripInput;
  plan: TripPlan;
  packing: PackingGroup[];
  foods: { destination: string; emoji: string; dishes: string[] }[];
  destinationNames: string[];
}

export interface TripMember {
  name: string;
  joinedAt: number;
}

export interface TripCheck {
  key: string;
  by: string;
}

/** GET /api/trips/:id response. */
export interface TripPayload {
  id: string;
  version: number;
  updatedAt: number;
  data: TripData;
  members: TripMember[];
  checks: TripCheck[];
  /** Only present when the requesting member is part of the trip. */
  joinCode?: string;
}

/** Compact catalog search hit shown in the destination search UI. */
export interface CatalogHit {
  qid: string;
  name: string;
  chineseName: string | null;
  province: string | null;
  description: string | null;
  population: number | null;
  attractionCount: number;
}

export function scheduleCheckKey(day: number, itemIndex: number): string {
  return `day:${day}:${itemIndex}`;
}

export function packingCheckKey(group: string, item: string): string {
  return `pack:${group}:${item}`;
}
