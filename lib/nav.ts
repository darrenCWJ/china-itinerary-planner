/**
 * The trip page's navigation, in one place.
 *
 * The redesign collapses seven tabs to four (spec §2.1), and the same four
 * have to drive the desktop rail and the mobile bottom bar. Two hardcoded tab
 * lists would drift the moment one surface gains an item, so both render from
 * this array and nothing else declares a tab — contract C1.
 */

export type TripTabId = "plan" | "today" | "money" | "kit";

export interface TripNavItem {
  id: TripTabId;
  /**
   * Shown under the icon. Kept to six characters or fewer: four tabs share a
   * 375px bottom bar, so a longer word wraps or truncates on the narrowest
   * phone the spec supports (C7).
   */
  label: string;
  /** Icon name, resolved by the rendering component — not a component ref, so
   * this module stays free of React and can be unit-tested in node. */
  icon: string;
  /**
   * What a screen reader announces. Deliberately fuller than `label`, which is
   * abbreviated to fit the tab, not to describe the destination.
   */
  ariaLabel: string;
}

export const TRIP_NAV: readonly TripNavItem[] = [
  { id: "plan", label: "Plan", icon: "route", ariaLabel: "Plan the trip" },
  { id: "today", label: "Today", icon: "sun", ariaLabel: "Today on this trip" },
  { id: "money", label: "Money", icon: "wallet", ariaLabel: "Money and expenses" },
  { id: "kit", label: "Kit", icon: "bag", ariaLabel: "Bookings and packing" },
] as const;

/** Narrows an untrusted `?tab=` value; anything unrecognised falls back to Plan. */
export function toTripTabId(value: string | null | undefined): TripTabId {
  return TRIP_NAV.some((item) => item.id === value) ? (value as TripTabId) : "plan";
}
