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

/** Está acontecendo em `now`? (já começou e ainda não terminou) */
export function isLiveNow(event: Pick<ExploreEvent, 'startsAt' | 'endsAt'>, now: Date): boolean {
  const t = now.getTime();
  return new Date(event.startsAt).getTime() <= t && t < new Date(event.endsAt).getTime();
}

/**
 * Põe primeiro o que está rolando agora, mantendo a ordem de todo o resto. O patrocinado segue no topo (é o espaço pago),
 * depois vêm os que estão rolando e, por fim, o restante.
 */
export function liveFirst<T extends Pick<ExploreEvent, 'startsAt' | 'endsAt'> & { sponsored?: boolean }>(events: readonly T[], now: Date): T[] {
  const rank = (e: T) => (e.sponsored ? 0 : isLiveNow(e, now) ? 1 : 2);
  return events.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e);
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** "20:00 – 02:00", no relógio do aparelho. */
export function timeRange(startsAt: string, endsAt: string): string {
  return `${hhmm(new Date(startsAt))} – ${hhmm(new Date(endsAt))}`;
}
