export interface LatLon {
  lat: number;
  lon: number;
}

/** A place that may not have been located yet — nulls mean "off the map". */
export interface MaybeLatLon {
  lat: number | null;
  lon: number | null;
}

/**
 * Narrow a possibly-unlocated place to a point, or null if it has none.
 *
 * The single narrowing every consumer of nullable coordinates goes through, so
 * "no coordinates" reliably becomes "no estimate" instead of a made-up
 * position. Explicit null checks rather than truthiness: 0,0 is a real point.
 */
export function latLonOf(place: MaybeLatLon): LatLon | null {
  if (place.lat === null || place.lon === null) return null;
  return { lat: place.lat, lon: place.lon };
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km between two points. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
