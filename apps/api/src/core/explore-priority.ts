import type { EventKind } from './types.ts';

/**
 * Prioridade de exibição no Explorar: bares, noite e baladas vêm primeiro dentro de cada dia (o dia manda: um evento de
 * hoje não fica atrás de uma balada do mês que vem). Dentro do mesmo grupo vale a hora de começo.
 */
const NIGHTLIFE_CATEGORY = /\b(bar|bares|pub|boteco|botequim|choperia|cervejaria|balada|boate|night|nightclub|club|casa noturna|danceteria|biergarten)\b/;

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[_\-]+/g, ' ');

/** 0 = noite/bar/balada (primeiro); 1 = o resto. */
export function nightlifeTier(event: { kind: EventKind; venue: { category: string | null } }): 0 | 1 {
  if (event.kind === 'NIGHT') return 0;
  return event.venue.category && NIGHTLIFE_CATEGORY.test(fold(event.venue.category)) ? 0 : 1;
}

/** Dia civil de São Paulo (UTC-3) de um instante ISO, como "2026-11-20". */
export function saoPauloDay(iso: string): string {
  return new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(0, 10);
}

type Prioritized = { id: string; startsAt: string; kind: EventKind; venue: { category: string | null } };

/** Ordena por dia, depois noite/bar/balada primeiro, depois hora de começo. Não altera a lista original. */
export function byDayAndNightlife<T extends Prioritized>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const da = saoPauloDay(a.startsAt);
    const db = saoPauloDay(b.startsAt);
    if (da !== db) return da < db ? -1 : 1;
    const ta = nightlifeTier(a);
    const tb = nightlifeTier(b);
    if (ta !== tb) return ta - tb;
    return a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : a.id < b.id ? -1 : 1;
  });
}
