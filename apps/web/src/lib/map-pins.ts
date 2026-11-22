import { distanceMeters } from './flash.ts';
import type { ExploreEvent, ExplorePlace } from './types.ts';

/** Evento e local a menos disto (em metros) são o mesmo lugar, quando o local não tem a página do AskouT ligada. */
const SAME_PLACE_M = 40;

export interface LooseSpot {
  eventId: string;
  venueId: string | undefined;
  name: string;
  lat: number;
  lng: number;
  count: number;
}

/**
 * Junta os próximos eventos aos locais do mapa: pelo local do AskouT ou, sem ele, pelo lugar (a menos de 40 m).
 * O que não bate com nenhum local vira um pin próprio, um por lugar, com a soma dos eventos.
 */
export function eventsByPlace(places: readonly ExplorePlace[], events: readonly ExploreEvent[]): { countByPlace: Map<string, number>; loose: LooseSpot[] } {
  const countByPlace = new Map<string, number>();
  const byVenue = new Map(places.flatMap((p) => (p.venue ? [[p.venue.id, p.key] as const] : [])));
  const spots = new Map<string, LooseSpot>();
  for (const e of events) {
    const { lat, lng } = e.venue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = (e.venue.id && byVenue.get(e.venue.id)) || places.find((p) => distanceMeters(p, { lat, lng }) <= SAME_PLACE_M)?.key;
    if (key) {
      countByPlace.set(key, (countByPlace.get(key) ?? 0) + 1);
      continue;
    }
    const spotKey = e.venue.id || `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const spot = spots.get(spotKey);
    if (spot) spot.count += 1;
    else spots.set(spotKey, { eventId: e.id, venueId: e.venue.id || undefined, name: e.venue.name, lat, lng, count: 1 });
  }
  return { countByPlace, loose: [...spots.values()] };
}
