import { distanceMeters } from './geo.ts';
import type { EventSearchQuery } from './ports.ts';
import type { PlaceEventRecord, VenueRecord } from './types.ts';

/** Minúsculas e sem acento, para comparar texto. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Hashtag normalizada (sem "#", minúscula, sem acento, só letras/números/_). Vazio se não sobrar nada. */
export function normalizeTag(raw: string): string {
  return fold(raw.replace(/^#+/, '')).replace(/[^a-z0-9_]/g, '');
}

export interface EventMatch {
  event: PlaceEventRecord;
  venue: VenueRecord;
  distanceM: number | null;
}

/** Filtro exato (tempo, tipo, grátis, hashtag, texto, distância). Usado pelo repositório em memória e pelo Prisma. */
export function matchEvent(event: PlaceEventRecord, venue: VenueRecord, q: EventSearchQuery): EventMatch | undefined {
  if (!(event.endsAt > q.from && event.startsAt < q.to)) return undefined;
  if (q.kind && event.kind !== q.kind) return undefined;
  if (q.freeOnly && !event.isFree) return undefined;
  if (q.venueIds && !q.venueIds.includes(event.venueId)) return undefined;
  if (q.tagPrefix && !event.tags.some((t) => t.startsWith(q.tagPrefix as string))) return undefined;
  if (q.text) {
    const needle = fold(q.text);
    const hay = [event.title, venue.name, ...event.tags].map(fold);
    if (!hay.some((h) => h.includes(needle))) return undefined;
  }
  let distanceM: number | null = null;
  if (q.center) {
    distanceM = distanceMeters(q.center, venue);
    if (q.radiusM !== undefined && distanceM > q.radiusM) return undefined;
  }
  return { event: { ...event, tags: [...event.tags] }, venue: { ...venue }, distanceM };
}

/** Mais cedo primeiro, depois mais perto, depois id (estável). */
export function compareMatches(a: EventMatch, b: EventMatch): number {
  return (
    a.event.startsAt.getTime() - b.event.startsAt.getTime() ||
    (a.distanceM ?? 0) - (b.distanceM ?? 0) ||
    (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0)
  );
}

/** Contagem de hashtags com o prefixo, mais usadas primeiro. */
export function countTags(events: PlaceEventRecord[], prefix: string, limit: number): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of events) for (const t of new Set(e.tags)) if (t.startsWith(prefix)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1)).slice(0, limit);
}

export function matchVenue(venue: VenueRecord, text: string, center: { lat: number; lng: number } | undefined, radiusM: number): { venue: VenueRecord; distanceM: number | null } | undefined {
  if (!fold(venue.name).includes(fold(text))) return undefined;
  let distanceM: number | null = null;
  if (center) {
    distanceM = distanceMeters(center, venue);
    if (distanceM > radiusM) return undefined;
  }
  return { venue: { ...venue }, distanceM };
}
