import type { ItemKind } from "./itinerary";
import type { TicketKind } from "./tripShared";
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

/**
 * The glyph for a city-to-city hop — two of them, because one was a lie.
 *
 * `🚄` is not decoration. It is a claim that this country has a rail network worth
 * putting a traveller on, which is exactly the claim `TransportProfile.railKmh`
 * makes and exactly the one `railKmh: null` withholds — lib/countryBaseProfile.ts's
 * neutral profile spells out what that null buys: *"no rail leg, no rail glyph,
 * and no rail booking copy for any country nobody has researched a network
 * for."* The glyph was the one clause of that sentence nothing implemented, so
 * a Chinese high-speed train was drawn over "Travel to Cusco" on all three plan
 * surfaces, the unauthenticated /b/[code] briefing included.
 *
 * **The replacement is deliberately not `✈️`.** The glyph resolves per COUNTRY, not
 * per leg: a `ScheduledItem` carries no mode, and the plans already persisted in
 * every saved trip never will. A plane would therefore be the same unsourced
 * claim pointing the other way — a short hop in a rail-less country is an
 * `overland` leg in lib/route.ts, which is flown by nobody. `🧭` names the act of
 * moving between cities and no vehicle at all, which is exactly as much as the
 * neutral hop title ("Travel to {city}") already says. Per-leg glyphs do exist
 * where per-leg modes do — components/map/MapExplorer.tsx draws `leg.mode` — and
 * that is the right shape wherever a `RouteLeg` is in hand.
 *
 * A compass and not the more obvious `🧳`, because `🧳` is already the wizard's
 * travellers chip in components/PlanStep.tsx ("🧳 2 adults + 1 kid"): a hop row
 * and a party count drawn with the same glyph is a worse page, and it would
 * also make "the Peru surface shows the neutral glyph" true whether or not a
 * hop was ever drawn. The jsdom gate pins the glyph against the hop title for
 * that reason rather than merely asserting its presence.
 *
 * China is unaffected: `CN_RAIL_KMH` is 230, so `travelEmoji` returns the rail
 * glyph and CN's hop keeps the train beside "High-speed rail or flight to …".
 */
export const RAIL_TRAVEL_EMOJI = "🚄";
export const NEUTRAL_TRAVEL_EMOJI = "🧭";

/**
 * Every item kind whose glyph is the same in every country.
 *
 * `travel` is deliberately absent, and the absence is the fix rather than a
 * side effect of it: `KIND_EMOJI.travel` is now `undefined`, so a renderer that
 * reaches for a travel glyph here gets nothing instead of getting China's.
 * `kindEmoji` below is the only way to obtain one, and it cannot be called
 * without saying which country is being drawn.
 *
 * `arrival`/`departure` stay aircraft on purpose. They mark entering and
 * leaving the trip's country rather than moving inside it, and no country
 * profile carries a claim about how a traveller arrives from abroad — so there
 * is nothing here to make country-aware.
 */
export const KIND_EMOJI: Partial<Record<ItemKind, string>> = {
  arrival: "🛬",
  departure: "🛫",
  custom: "📌",
};

/**
 * The hop glyph a country's transport profile has earned.
 *
 * Takes the number rather than the profile so lib/meta.ts stays a module with
 * no value imports at all: it is read by map, plan and briefing surfaces alike,
 * and an edge from here to lib/countryBaseProfile.ts would put every country's
 * copy into bundles that render one emoji. `railKmh` is the whole input — the
 * same field lib/route.ts branches on, so the glyph and the leg can never
 * disagree about whether this country has trains.
 */
export function travelEmoji(railKmh: number | null): string {
  return railKmh === null ? NEUTRAL_TRAVEL_EMOJI : RAIL_TRAVEL_EMOJI;
}

/**
 * The glyph for one itinerary row, or `undefined` when its kind has none.
 *
 * `travel` is answered by the caller's country (pass `travelEmoji(railKmh)`, or
 * the value a `Briefing` already carries); every other kind is universal. One
 * function rather than a lookup plus a special case at three call sites, so
 * "which glyph does a hop get" has exactly one answer in the codebase.
 */
export function kindEmoji(kind: ItemKind, travel: string): string | undefined {
  return kind === "travel" ? travel : KIND_EMOJI[kind];
}

export const TICKET_KINDS: { id: TicketKind; label: string; emoji: string }[] = [
  { id: "flight", label: "Flight", emoji: "✈️" },
  { id: "train", label: "Train", emoji: "🚄" },
  { id: "hotel", label: "Hotel", emoji: "🏨" },
  { id: "attraction", label: "Attraction", emoji: "🎟️" },
  { id: "other", label: "Other", emoji: "📌" },
];

export function ticketKindMeta(id: TicketKind) {
  return TICKET_KINDS.find((k) => k.id === id) ?? TICKET_KINDS[TICKET_KINDS.length - 1];
}
