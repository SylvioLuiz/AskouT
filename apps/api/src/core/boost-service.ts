import { conflict, forbidden, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { BoostRecord, BoostTarget, VenueRecord } from './types.ts';

/** Quantos dias o responsável pode comprar de uma vez. */
export const BOOST_DAY_OPTIONS: readonly number[] = [1, 3, 7, 14];
/** Valor padrão por dia, em centavos. Ajustável por configuração, sem mexer no código. */
export const BOOST_DEFAULT_PRICE_PER_DAY_CENTS = 1500;

const DAY_MS = 86_400_000;

export interface BoostPricing {
  currency: 'BRL';
  pricePerDayCents: number;
  dayOptions: number[];
  /** Pagamento de teste: não cobra de verdade (a tela mostra “simular pagamento”). */
  sandbox: boolean;
}

/** Como o responsável enxerga o anúncio. */
export type BoostPhase = 'PENDING_PAYMENT' | 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED' | 'PAUSED';

export interface BoostView {
  id: string;
  venueId: string;
  target: BoostTarget;
  eventId: string | null;
  /** Nome do evento impulsionado, quando for o caso. */
  eventTitle: string | null;
  days: number;
  amountCents: number;
  phase: BoostPhase;
  createdAt: string;
  startsAt: string | null;
  endsAt: string | null;
  /** Só enquanto aguarda o pagamento. */
  payment: { pixCode: string | null; checkoutUrl: string | null } | null;
}

export function boostPhase(boost: BoostRecord, now: Date): BoostPhase {
  if (boost.status === 'PENDING_PAYMENT') return 'PENDING_PAYMENT';
  if (boost.status === 'CANCELLED') return 'CANCELLED';
  if (boost.status === 'PAUSED') return 'PAUSED';
  if (boost.startsAt && boost.startsAt.getTime() > now.getTime()) return 'SCHEDULED';
  if (boost.endsAt && boost.endsAt.getTime() <= now.getTime()) return 'ENDED';
  return 'ACTIVE';
}

export class BoostService {
  private readonly deps: CoreDeps;
  private readonly pricePerDayCents: number;

  constructor(deps: CoreDeps, options: { pricePerDayCents?: number } = {}) {
    this.deps = deps;
    this.pricePerDayCents = options.pricePerDayCents ?? BOOST_DEFAULT_PRICE_PER_DAY_CENTS;
  }

  pricing(): BoostPricing {
    return { currency: 'BRL', pricePerDayCents: this.pricePerDayCents, dayOptions: [...BOOST_DAY_OPTIONS], sandbox: this.deps.payments.sandbox };
  }

  /** O local precisa existir e ser administrado por quem pede (senão “não encontrado”, sem revelar que existe). */
  private async ownedVenue(ownerId: string, venueId: unknown): Promise<VenueRecord> {
    if (typeof venueId !== 'string' || venueId === '' || venueId.length > 64) throw notFound('Local não encontrado');
    const venue = await this.deps.places.findVenue(venueId);
    if (!venue || venue.ownerId !== ownerId) throw notFound('Local não encontrado');
    return venue;
  }

  private async view(boost: BoostRecord, now: Date, titles?: Map<string, string>): Promise<BoostView> {
    let eventTitle: string | null = null;
    if (boost.eventId) {
      eventTitle = titles?.get(boost.eventId) ?? (await this.deps.places.findEvent(boost.eventId))?.event.title ?? null;
    }
    return {
      id: boost.id,
      venueId: boost.venueId,
      target: boost.target,
      eventId: boost.eventId,
      eventTitle,
      days: boost.days,
      amountCents: boost.amountCents,
      phase: boostPhase(boost, now),
      createdAt: boost.createdAt.toISOString(),
      startsAt: boost.startsAt?.toISOString() ?? null,
      endsAt: boost.endsAt?.toISOString() ?? null,
      payment: boost.status === 'PENDING_PAYMENT' ? { pixCode: boost.payCode, checkoutUrl: boost.payUrl } : null,
    };
  }

  /** Cria o pedido e a cobrança. O anúncio só passa a aparecer depois que o pagamento é confirmado. */
  async create(ownerId: string, venueId: unknown, input: { target?: unknown; eventId?: unknown; days?: unknown }): Promise<BoostView> {
    const venue = await this.ownedVenue(ownerId, venueId);
    const now = this.deps.clock.now();

    const days = input.days;
    if (typeof days !== 'number' || !BOOST_DAY_OPTIONS.includes(days)) throw validationError('Duração inválida', { days: `Escolha ${BOOST_DAY_OPTIONS.join(', ')} dias` });
    if (input.target !== 'VENUE' && input.target !== 'EVENT') throw validationError('Escolha o que impulsionar', { target: 'Use VENUE ou EVENT' });
    const target: BoostTarget = input.target;

    let eventId: string | null = null;
    let description = `Impulsionamento de ${venue.name}`;
    if (target === 'EVENT') {
      if (typeof input.eventId !== 'string' || input.eventId === '' || input.eventId.length > 64) throw validationError('Escolha o evento', { eventId: 'Informe o evento' });
      const found = await this.deps.places.findEvent(input.eventId);
      if (!found || found.venue.id !== venue.id) throw notFound('Evento não encontrado');
      if (found.event.endsAt.getTime() <= now.getTime()) throw conflict('Este evento já terminou', { eventId: 'Evento encerrado' });
      eventId = found.event.id;
      description = `Impulsionamento do evento ${found.event.title}`;
    }

    // Um anúncio por vez para o mesmo alvo (evita pagar duas vezes pelo mesmo espaço).
    const existing = await this.deps.boosts.listByVenue(venue.id);
    const open = existing.find((b) => b.target === target && b.eventId === eventId && (b.status === 'PENDING_PAYMENT' || (b.status === 'PAID' && (b.endsAt?.getTime() ?? 0) > now.getTime())));
    if (open) throw conflict(open.status === 'PENDING_PAYMENT' ? 'Já existe um pedido aguardando pagamento para isto' : 'Isto já está impulsionado');

    const amountCents = days * this.pricePerDayCents;
    const id = this.deps.ids.next();
    const charge = await this.deps.payments.createCharge({ reference: id, amountCents, description });
    const boost: BoostRecord = {
      id,
      venueId: venue.id,
      ownerId,
      target,
      eventId,
      days,
      amountCents,
      status: 'PENDING_PAYMENT',
      chargeId: charge.chargeId,
      payCode: charge.pixCode,
      payUrl: charge.checkoutUrl,
      createdAt: now,
      paidAt: null,
      startsAt: null,
      endsAt: null,
    };
    await this.deps.boosts.create(boost);
    return this.view(boost, now);
  }

  async list(ownerId: string, venueId: unknown): Promise<BoostView[]> {
    const venue = await this.ownedVenue(ownerId, venueId);
    const now = this.deps.clock.now();
    const rows = await this.deps.boosts.listByVenue(venue.id);
    return Promise.all(rows.map((b) => this.view(b, now)));
  }

  /** Só dá para cancelar o que ainda não foi pago. Depois de pago, o reembolso é tratado à parte (ver GOLIVE). */
  async cancel(ownerId: string, boostId: unknown): Promise<BoostView> {
    const boost = await this.ownedBoost(ownerId, boostId);
    if (boost.status !== 'PENDING_PAYMENT') throw conflict('Só dá para cancelar o que ainda não foi pago');
    await this.deps.boosts.transition(boost.id, ['PENDING_PAYMENT'], 'CANCELLED');
    return this.view({ ...boost, status: 'CANCELLED' }, this.deps.clock.now());
  }

  private async ownedBoost(ownerId: string, boostId: unknown): Promise<BoostRecord> {
    if (typeof boostId !== 'string' || boostId === '' || boostId.length > 64) throw notFound('Pedido não encontrado');
    const boost = await this.deps.boosts.find(boostId);
    if (!boost || boost.ownerId !== ownerId) throw notFound('Pedido não encontrado');
    return boost;
  }

  /** Confirma um pagamento (vindo do aviso do provedor). Repetir o aviso não paga duas vezes. */
  async confirmCharge(chargeId: string): Promise<{ confirmed: boolean }> {
    const boost = await this.deps.boosts.findByChargeId(chargeId);
    if (!boost) return { confirmed: false };
    const now = this.deps.clock.now();
    const endsAt = new Date(now.getTime() + boost.days * DAY_MS);
    const confirmed = await this.deps.boosts.markPaid(boost.id, { paidAt: now, startsAt: now, endsAt });
    return { confirmed };
  }

  /** Aviso (webhook) do provedor de pagamento. Aviso inválido é ignorado (devolve false). */
  async handleWebhook(headers: Record<string, string | undefined>, rawBody: string): Promise<{ accepted: boolean }> {
    const parsed = await this.deps.payments.parseWebhook(headers, rawBody);
    if (!parsed) return { accepted: false };
    if (parsed.paid) await this.confirmCharge(parsed.chargeId);
    return { accepted: true };
  }

  /** Só no ambiente de teste do provedor: marca o pedido como pago, para experimentar o fluxo sem dinheiro. */
  async simulatePayment(ownerId: string, boostId: unknown): Promise<BoostView> {
    if (!this.deps.payments.sandbox) throw forbidden('Simular pagamento só existe no ambiente de teste');
    const boost = await this.ownedBoost(ownerId, boostId);
    if (boost.chargeId) await this.confirmCharge(boost.chargeId);
    const fresh = (await this.deps.boosts.find(boost.id)) ?? boost;
    return this.view(fresh, this.deps.clock.now());
  }

  /** Alvos impulsionados agora, para o Explorar marcar “Patrocinado” e subir na lista. */
  async activeTargets(now: Date): Promise<{ venueIds: Set<string>; eventIds: Set<string>; boosts: BoostRecord[] }> {
    const boosts = await this.deps.boosts.listActive(now);
    return {
      venueIds: new Set(boosts.filter((b) => b.target === 'VENUE').map((b) => b.venueId)),
      eventIds: new Set(boosts.filter((b) => b.target === 'EVENT' && b.eventId).map((b) => b.eventId as string)),
      boosts,
    };
  }
}
