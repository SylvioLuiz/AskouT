import { conflict, forbidden, notFound, validationError } from './errors.ts';
import type { MatchReach, MatchService } from './match-service.ts';
import { MATCH_MAX_TAGS, MATCH_RADIUS_KM_OPTIONS } from './match.ts';
import type { CoreDeps } from './ports.ts';
import type { BoostAudience, BoostChannel, BoostRecord, BoostTarget, PlaceEventRecord, VenueRecord } from './types.ts';

/** Quantos dias o responsável pode comprar de uma vez. */
export const BOOST_DAY_OPTIONS: readonly number[] = [1, 3, 7, 14];
/** Valor padrão por dia, em centavos. Ajustável por configuração, sem mexer no código. */
export const BOOST_DEFAULT_PRICE_PER_DAY_CENTS = 1500;

const DAY_MS = 86_400_000;

/** Produto cadastrado na App Store e no Google Play para cada pacote de dias (consumível). */
export function boostProductId(days: number): string {
  return `askout.boost.${days}d`;
}

export interface BoostPricing {
  currency: 'BRL';
  /**
   * Chave geral: com `false` nenhum pedido novo é aceito (nem pela web, nem pelas lojas).
   * Anúncios já pagos continuam aparecendo até o fim, e pagamentos em andamento ainda são confirmados.
   */
  enabled: boolean;
  pricePerDayCents: number;
  dayOptions: number[];
  /** Compra dentro do app (iOS/Android): o valor vem da tabela de preços da loja, que costuma ser maior por causa da comissão. */
  store: { available: boolean; pricePerDayCents: number; products: Record<string, string> };
  /** Raios (km) e limite de hashtags do Match. */
  match: { radiusKmOptions: number[]; maxTags: number };
  /** Pagamento de teste: não cobra de verdade (a tela mostra “simular pagamento”). */
  sandbox: boolean;
}

/** Como o responsável enxerga o anúncio. */
export type BoostPhase = 'PENDING_PAYMENT' | 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED' | 'PAUSED';

export interface BoostView {
  id: string;
  venueId: string;
  channel: BoostChannel;
  /** Só nos pedidos das lojas: o produto que o app precisa comprar. */
  storeProductId: string | null;
  target: BoostTarget;
  eventId: string | null;
  /** Nome do evento impulsionado, quando for o caso. */
  eventTitle: string | null;
  days: number;
  amountCents: number;
  audience: BoostAudience;
  /** Só no Match. */
  radiusKm: number | null;
  matchTags: string[];
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
  private readonly storePricePerDayCents: number;
  private readonly enabled: boolean;
  private readonly match: MatchService;

  constructor(deps: CoreDeps, options: { pricePerDayCents?: number; storePricePerDayCents?: number; enabled?: boolean } = {}, match: MatchService) {
    this.deps = deps;
    this.match = match;
    this.pricePerDayCents = options.pricePerDayCents ?? BOOST_DEFAULT_PRICE_PER_DAY_CENTS;
    this.storePricePerDayCents = options.storePricePerDayCents ?? this.pricePerDayCents;
    this.enabled = options.enabled ?? true;
  }

  pricing(): BoostPricing {
    const products: Record<string, string> = {};
    for (const d of BOOST_DAY_OPTIONS) products[String(d)] = boostProductId(d);
    return {
      currency: 'BRL',
      enabled: this.enabled,
      pricePerDayCents: this.pricePerDayCents,
      dayOptions: [...BOOST_DAY_OPTIONS],
      store: { available: this.deps.storeVerifier !== undefined, pricePerDayCents: this.storePricePerDayCents, products },
      match: { radiusKmOptions: [...MATCH_RADIUS_KM_OPTIONS], maxTags: MATCH_MAX_TAGS },
      sandbox: this.deps.payments.sandbox,
    };
  }

  /** Novos pedidos só com a chave ligada. Pagamentos que já estavam a caminho continuam sendo confirmados. */
  private ensureEnabled(): void {
    if (!this.enabled) throw conflict('O impulsionamento ainda não está disponível. Em breve!');
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
      channel: boost.channel,
      storeProductId: boost.channel !== 'WEB' && boost.status === 'PENDING_PAYMENT' ? boostProductId(boost.days) : null,
      target: boost.target,
      eventId: boost.eventId,
      eventTitle,
      days: boost.days,
      amountCents: boost.amountCents,
      audience: boost.audience,
      radiusKm: boost.radiusM === null ? null : boost.radiusM / 1000,
      matchTags: [...boost.matchTags],
      phase: boostPhase(boost, now),
      createdAt: boost.createdAt.toISOString(),
      startsAt: boost.startsAt?.toISOString() ?? null,
      endsAt: boost.endsAt?.toISOString() ?? null,
      payment: boost.status === 'PENDING_PAYMENT' ? { pixCode: boost.payCode, checkoutUrl: boost.payUrl } : null,
    };
  }

  /** Cria o pedido e a cobrança. O anúncio só passa a aparecer depois que o pagamento é confirmado. */
  /**
   * Confere o Match de um evento: raio da lista e de 1 a 5 hashtags que o próprio evento tem.
   * Sem hashtags no evento não há como alcançar ninguém por gosto.
   */
  private matchInput(event: PlaceEventRecord, input: { radiusKm?: unknown; tags?: unknown }): { radiusM: number; tags: string[] } {
    const radiusKm = input.radiusKm;
    if (typeof radiusKm !== 'number' || !MATCH_RADIUS_KM_OPTIONS.includes(radiusKm)) throw validationError('Raio inválido', { radiusKm: `Escolha ${MATCH_RADIUS_KM_OPTIONS.join(', ')} km` });
    if (event.tags.length === 0) throw validationError('Este evento não tem hashtags', { tags: 'Adicione hashtags ao evento (por exemplo #rock) para usar o Match' });
    const tags = input.tags;
    if (!Array.isArray(tags) || tags.length === 0 || tags.length > MATCH_MAX_TAGS || tags.some((t) => typeof t !== 'string')) {
      throw validationError('Escolha as hashtags', { tags: `Escolha de 1 a ${MATCH_MAX_TAGS} hashtags do evento` });
    }
    const unique = [...new Set(tags as string[])];
    if (unique.some((t) => !event.tags.includes(t))) throw validationError('Hashtag que o evento não tem', { tags: 'Use só hashtags do próprio evento' });
    return { radiusM: radiusKm * 1000, tags: unique };
  }

  /** Quantas pessoas combinam hoje com um Match, só como número agregado (nunca quem). */
  async estimate(ownerId: string, venueId: unknown, input: { eventId?: unknown; radiusKm?: unknown; tags?: unknown }): Promise<MatchReach> {
    const venue = await this.ownedVenue(ownerId, venueId);
    if (typeof input.eventId !== 'string' || input.eventId === '' || input.eventId.length > 64) throw validationError('Escolha o evento', { eventId: 'Informe o evento' });
    const found = await this.deps.places.findEvent(input.eventId);
    if (!found || found.venue.id !== venue.id) throw notFound('Evento não encontrado');
    const { radiusM, tags } = this.matchInput(found.event, input);
    return this.match.reach({ venue, radiusM, tags, ownerId });
  }

  async create(ownerId: string, venueId: unknown, input: { target?: unknown; eventId?: unknown; days?: unknown; audience?: unknown; radiusKm?: unknown; tags?: unknown; channel?: unknown }): Promise<BoostView> {
    const venue = await this.ownedVenue(ownerId, venueId);
    this.ensureEnabled();
    const now = this.deps.clock.now();

    if (input.channel !== undefined && input.channel !== 'WEB' && input.channel !== 'APPLE' && input.channel !== 'GOOGLE') {
      throw validationError('Forma de pagamento inválida', { channel: 'Use WEB, APPLE ou GOOGLE' });
    }
    const channel: BoostChannel = input.channel === 'APPLE' || input.channel === 'GOOGLE' ? input.channel : 'WEB';
    if (channel !== 'WEB' && !this.deps.storeVerifier) throw conflict('A compra pelo app ainda não está disponível.');

    const days = input.days;
    if (typeof days !== 'number' || !BOOST_DAY_OPTIONS.includes(days)) throw validationError('Duração inválida', { days: `Escolha ${BOOST_DAY_OPTIONS.join(', ')} dias` });
    if (input.target !== 'VENUE' && input.target !== 'EVENT') throw validationError('Escolha o que impulsionar', { target: 'Use VENUE ou EVENT' });
    const target: BoostTarget = input.target;
    if (input.audience !== undefined && input.audience !== 'ALL' && input.audience !== 'MATCH') throw validationError('Alcance inválido', { audience: 'Use ALL ou MATCH' });
    const audience: BoostAudience = input.audience === 'MATCH' ? 'MATCH' : 'ALL';
    if (audience === 'MATCH' && target !== 'EVENT') throw validationError('O Match vale para eventos', { audience: 'Escolha um evento para usar o Match' });
    let match: { radiusM: number; tags: string[] } | null = null;

    let eventId: string | null = null;
    let description = `Impulsionamento de ${venue.name}`;
    if (target === 'EVENT') {
      if (typeof input.eventId !== 'string' || input.eventId === '' || input.eventId.length > 64) throw validationError('Escolha o evento', { eventId: 'Informe o evento' });
      const found = await this.deps.places.findEvent(input.eventId);
      if (!found || found.venue.id !== venue.id) throw notFound('Evento não encontrado');
      if (found.event.endsAt.getTime() <= now.getTime()) throw conflict('Este evento já terminou', { eventId: 'Evento encerrado' });
      eventId = found.event.id;
      if (audience === 'MATCH') match = this.matchInput(found.event, input);
      description = `Impulsionamento do evento ${found.event.title}`;
    }

    // Um anúncio por vez para o mesmo alvo (evita pagar duas vezes pelo mesmo espaço).
    const existing = await this.deps.boosts.listByVenue(venue.id);
    const open = existing.find((b) => b.target === target && b.eventId === eventId && (b.status === 'PENDING_PAYMENT' || (b.status === 'PAID' && (b.endsAt?.getTime() ?? 0) > now.getTime())));
    if (open) throw conflict(open.status === 'PENDING_PAYMENT' ? 'Já existe um pedido aguardando pagamento para isto' : 'Isto já está impulsionado');

    const amountCents = days * (channel === 'WEB' ? this.pricePerDayCents : this.storePricePerDayCents);
    const id = this.deps.ids.next();
    // Nas lojas quem cobra é a loja: não existe cobrança no provedor, só o pedido esperando o recibo do app.
    const charge = channel === 'WEB' ? await this.deps.payments.createCharge({ reference: id, amountCents, description, returnPath: `/bares/${encodeURIComponent(venue.id)}/impulsionar` }) : { chargeId: null, pixCode: null, checkoutUrl: null };
    const boost: BoostRecord = {
      id,
      venueId: venue.id,
      channel,
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
      audience,
      radiusM: match?.radiusM ?? null,
      matchTags: match?.tags ?? [],
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
  async confirmCharge(chargeId: string, receivedCents?: number): Promise<{ confirmed: boolean }> {
    const boost = await this.deps.boosts.findByChargeId(chargeId);
    if (!boost) return { confirmed: false };
    // Valor diferente do pedido: não libera (protege contra cobrança alterada ou aviso trocado).
    if (receivedCents !== undefined && receivedCents !== boost.amountCents) return { confirmed: false };
    const now = this.deps.clock.now();
    const endsAt = new Date(now.getTime() + boost.days * DAY_MS);
    const confirmed = await this.deps.boosts.markPaid(boost.id, { paidAt: now, startsAt: now, endsAt });
    return { confirmed };
  }

  /** Aviso (webhook) do provedor de pagamento. Aviso inválido é ignorado (devolve false). */
  async handleWebhook(headers: Record<string, string | undefined>, rawBody: string): Promise<{ accepted: boolean }> {
    const parsed = await this.deps.payments.parseWebhook(headers, rawBody);
    if (!parsed) return { accepted: false };
    if (parsed.paid) await this.confirmCharge(parsed.chargeId, parsed.amountCents);
    return { accepted: true };
  }

  /** Só no ambiente de teste do provedor: marca o pedido como pago, para experimentar o fluxo sem dinheiro. */
  async simulatePayment(ownerId: string, boostId: unknown): Promise<BoostView> {
    if (!this.deps.payments.sandbox) throw forbidden('Simular pagamento só existe no ambiente de teste');
    this.ensureEnabled();
    const boost = await this.ownedBoost(ownerId, boostId);
    if (boost.channel !== 'WEB') throw conflict('Este pedido é pago pela loja do aplicativo');
    if (boost.chargeId) await this.confirmCharge(boost.chargeId);
    const fresh = (await this.deps.boosts.find(boost.id)) ?? boost;
    return this.view(fresh, this.deps.clock.now());
  }

  /**
   * Compra dentro do app: o app manda o recibo da loja e o servidor confere. Só uma confirmação válida libera o anúncio.
   * O mesmo recibo nunca paga dois pedidos, e repetir a chamada de um pedido já pago devolve o pedido como está.
   */
  async confirmStorePurchase(ownerId: string, boostId: unknown, input: { receipt?: unknown }): Promise<BoostView> {
    const boost = await this.ownedBoost(ownerId, boostId);
    const now = this.deps.clock.now();
    if (boost.channel === 'WEB') throw conflict('Este pedido é pago por Pix ou cartão, não pela loja');
    if (boost.status === 'PAID') return this.view(boost, now);
    if (boost.status !== 'PENDING_PAYMENT') throw conflict('Este pedido não está aguardando pagamento');
    const verifier = this.deps.storeVerifier;
    if (!verifier) throw conflict('A compra pelo app ainda não está disponível.');
    const receipt = input.receipt;
    if (typeof receipt !== 'string' || receipt === '' || receipt.length > 20_000) throw validationError('Recibo inválido', { receipt: 'Envie o recibo da compra' });

    const store = boost.channel;
    const purchase = await verifier.verify({ store, receipt });
    // Recibo falso, de outro produto ou já devolvido pela loja: nada é liberado.
    if (!purchase || !purchase.active || purchase.productId !== boostProductId(boost.days)) throw conflict('Não foi possível confirmar a compra na loja');

    const endsAt = new Date(now.getTime() + boost.days * DAY_MS);
    const chargeId = `${store.toLowerCase()}:${purchase.transactionId}`;
    const confirmed = await this.deps.boosts.markPaid(boost.id, { paidAt: now, startsAt: now, endsAt, chargeId });
    if (!confirmed) {
      const fresh = await this.deps.boosts.find(boost.id);
      if (fresh?.status === 'PAID') return this.view(fresh, now); // chamada repetida
      throw conflict('Este recibo já foi usado em outro pedido');
    }
    return this.view((await this.deps.boosts.find(boost.id)) ?? boost, now);
  }

  /**
   * Alvos impulsionados agora para TODOS, para o Explorar marcar “Patrocinado” e subir na lista.
   * Anúncios Match ficam de fora: só aparecem para quem combina, no “Para você”.
   */
  async activeTargets(now: Date): Promise<{ venueIds: Set<string>; eventIds: Set<string>; boosts: BoostRecord[] }> {
    const boosts = (await this.deps.boosts.listActive(now)).filter((b) => b.audience !== 'MATCH');
    return {
      venueIds: new Set(boosts.filter((b) => b.target === 'VENUE').map((b) => b.venueId)),
      eventIds: new Set(boosts.filter((b) => b.target === 'EVENT' && b.eventId).map((b) => b.eventId as string)),
      boosts,
    };
  }
}
