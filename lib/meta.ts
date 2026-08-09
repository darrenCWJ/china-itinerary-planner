import type { ItemKind } from "./itinerary";
import type { Interest, Season, TimeSlot } from "./types";

export const INTERESTS: { id: Interest; label: string; emoji: string }[] = [
  { id: "food", label: "Food & Street Eats", emoji: "🍜" },
  { id: "history", label: "History & Culture", emoji: "🏛️" },
  { id: "nature", label: "Nature & Scenery", emoji: "🏞️" },
  { id: "beach", label: "Beach & Islands", emoji: "🏖️" },
  { id: "themepark", label: "Theme Parks", emoji: "🎢" },
  { id: "arcade", label: "Arcades & Gaming", emoji: "🕹️" },
  { id: "shopping", label: "Shopping", emoji: "🛍️" },
  { id: "nightlife", label: "Nightlife & Shows", emoji: "🌃" },
  { id: "museums", label: "Museums & Art", emoji: "🖼️" },
  { id: "hiking", label: "Hiking & Adventure", emoji: "🥾" },
  { id: "family", label: "Family & Kids", emoji: "👨‍👩‍👧" },
];

export const SEASONS: { id: Season; label: string; months: string; emoji: string }[] = [
  { id: "spring", label: "Spring", months: "Mar – May", emoji: "🌸" },
  { id: "summer", label: "Summer", months: "Jun – Aug", emoji: "☀️" },
  { id: "autumn", label: "Autumn", months: "Sep – Nov", emoji: "🍁" },
  { id: "winter", label: "Winter", months: "Dec – Feb", emoji: "❄️" },
];

export const SEASON_EMOJI: Record<Season, string> = {
  spring: "🌸",
  summer: "☀️",
  autumn: "🍁",
  winter: "❄️",
};

export function interestMeta(id: Interest) {
  return INTERESTS.find((i) => i.id === id);
}

export const SLOT_META: Record<TimeSlot, { label: string; emoji: string }> = {
  morning: { label: "Morning", emoji: "🌅" },
  afternoon: { label: "Afternoon", emoji: "☀️" },
  evening: { label: "Evening", emoji: "🌙" },
};

export const KIND_EMOJI: Partial<Record<ItemKind, string>> = {
  travel: "🚄",
  arrival: "🛬",
  departure: "🛫",
};
