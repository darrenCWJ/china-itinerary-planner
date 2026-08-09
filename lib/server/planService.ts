import { buildItinerary, type TripInput } from "../itinerary";
import { buildPackingList } from "../packing";
import type { TripData } from "../tripShared";
import { resolveDestinations } from "./catalog";

/** Build the full stored trip snapshot (plan + packing + foods) server-side. */
export function buildTripData(args: {
  tripName: string;
  startDate: string | null;
  input: TripInput;
}): TripData {
  const destinations = resolveDestinations(args.input.destinationIds);
  const plan = buildItinerary(args.input, destinations);
  const packing = buildPackingList(args.input, destinations);
  return {
    tripName: args.tripName,
    startDate: args.startDate,
    input: args.input,
    plan,
    packing,
    foods: destinations
      .filter((d) => d.foods.length > 0)
      .map((d) => ({ destination: d.name, emoji: d.emoji, dishes: d.foods })),
    destinationNames: destinations.map((d) => d.name),
  };
}
