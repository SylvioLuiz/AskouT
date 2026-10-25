import { t } from '../lib/i18n/index.ts';
import type { BoostPhase, BoostView, MatchReach } from './types.ts';

/** Valor em reais, no formato brasileiro (R$ 15,00). */
export function formatBrl(cents: number): string {
  const value = Math.max(0, Math.round(cents)) / 100;
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

export function boostTotalCents(pricePerDayCents: number, days: number): number {
  return Math.max(0, Math.round(pricePerDayCents)) * Math.max(0, Math.floor(days));
}

export function daysLabel(days: number): string {
  return days === 1 ? '1 dia' : `${days} dias`;
}

export const BOOST_PHASE_LABEL: Record<BoostPhase, string> = {
  PENDING_PAYMENT: t('Aguardando pagamento'),
  SCHEDULED: 'Agendado',
  ACTIVE: t('No ar'),
  ENDED: 'Encerrado',
  CANCELLED: 'Cancelado',
  PAUSED: 'Pausado',
};

/** Só dá para cancelar enquanto não foi pago. */
export function canCancelBoost(boost: Pick<BoostView, 'phase'>): boolean {
  return boost.phase === 'PENDING_PAYMENT';
}

/** Pedidos em aberto (aguardando pagamento ou no ar) vêm primeiro; o resto por data. */
export function sortBoosts(items: BoostView[]): BoostView[] {
  const rank = (b: BoostView): number => (b.phase === 'PENDING_PAYMENT' ? 0 : b.phase === 'ACTIVE' || b.phase === 'SCHEDULED' ? 1 : 2);
  return [...items].sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

export function boostTitle(boost: Pick<BoostView, 'target' | 'eventTitle'>): string {
  return boost.target === 'EVENT' ? (boost.eventTitle ?? 'Evento') : t('O rolê (página do local)');
}

/** Marca ou desmarca uma hashtag, sem passar do máximo. */
export function toggleTag(tags: readonly string[], tag: string, max: number): string[] {
  if (tags.includes(tag)) return tags.filter((t) => t !== tag);
  return tags.length >= max ? [...tags] : [...tags, tag];
}

/** “Match · 5 km · #rock #metal” para o anúncio que usa Match; nada para o destaque comum. */
export function matchLabel(boost: Pick<BoostView, 'audience' | 'radiusKm' | 'matchTags'>): string | null {
  if (boost.audience !== 'MATCH') return null;
  const parts = ['Match', boost.radiusKm === null ? null : `${boost.radiusKm} km`, boost.matchTags.map((t) => `#${t}`).join(' ') || null];
  return parts.filter((p): p is string => p !== null).join(' · ');
}

/** Frase da estimativa, sem nunca sugerir quem são as pessoas. */
export function reachText(reach: Pick<MatchReach, 'label' | 'partial'>): string {
  const label = reach.label.charAt(0).toUpperCase() + reach.label.slice(1);
  return `${label} combinam hoje com este Match${reach.partial ? ' (estimativa: só parte da região foi examinada)' : ''}.`;
}

/** Distância para a Home: “Pertinho de você” ou “A cerca de 3 km de você”. */
export function distanceText(km: number): string {
  return km <= 1 ? t('Pertinho de você') : t('A cerca de {km} km de você', { km: Math.round(km) });
}

/** Arredonda uma coordenada para ~1 km antes de enviar (o servidor também arredonda). */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}
