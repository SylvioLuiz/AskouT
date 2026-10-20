import type { BoostPhase, BoostView } from './types.ts';

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
  PENDING_PAYMENT: 'Aguardando pagamento',
  SCHEDULED: 'Agendado',
  ACTIVE: 'No ar',
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
  return boost.target === 'EVENT' ? (boost.eventTitle ?? 'Evento') : 'O rolê (página do local)';
}
