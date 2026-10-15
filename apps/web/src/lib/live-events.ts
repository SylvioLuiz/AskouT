import type { ExploreEvent } from './types.ts';

/** Eventos que estão acontecendo em `now`, do mais perto para o mais longe (sem distância vão por último, pelo horário de início). */
export function liveEvents(events: readonly ExploreEvent[], now: Date): ExploreEvent[] {
  const t = now.getTime();
  return events
    .filter((e) => new Date(e.startsAt).getTime() <= t && t < new Date(e.endsAt).getTime())
    .sort((a, b) => {
      if (a.distanceM !== null && b.distanceM !== null && a.distanceM !== b.distanceM) return a.distanceM - b.distanceM;
      if (a.distanceM !== null && b.distanceM === null) return -1;
      if (a.distanceM === null && b.distanceM !== null) return 1;
      return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() || (a.id < b.id ? -1 : 1);
    });
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** "20:00 – 02:00", no relógio do aparelho. */
export function timeRange(startsAt: string, endsAt: string): string {
  return `${hhmm(new Date(startsAt))} – ${hhmm(new Date(endsAt))}`;
}
