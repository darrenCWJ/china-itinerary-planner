import type { Destination } from "../types";
import { NORTH_DESTINATIONS } from "./north";
import { EAST_DESTINATIONS } from "./east";
import { WEST_DESTINATIONS } from "./west";
import { SOUTH_DESTINATIONS } from "./south";

export const DESTINATIONS: Destination[] = [
  ...NORTH_DESTINATIONS,
  ...EAST_DESTINATIONS,
  ...WEST_DESTINATIONS,
  ...SOUTH_DESTINATIONS,
];

export function getDestination(id: string): Destination | undefined {
  return DESTINATIONS.find((d) => d.id === id);
}
