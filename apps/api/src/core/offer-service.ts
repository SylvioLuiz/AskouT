import { conflict, notFound, validationError } from './errors.ts';
import { OFFENSIVE_MESSAGE, hasOffensiveText } from './content-filter.ts';
import { boundingBox, distanceMeters } from './geo.ts';
import { MATCH_ESTIMATE_SCAN, audienceBucket } from './match.ts';
import type { MatchReach } from './match-service.ts';
import type { CoreDeps } from './ports.ts';
import type { VenueOfferRecord, VenueRecord } from './types.ts';

/** Tamanho do texto da oferta. */
export const OFFER_TEXT_MAX = 80;
export const OFFER_TEXT_MIN = 5;
/** Duração: de 15 minutos a 4 horas. */
export const OFFER_MIN_MINUTES = 15;
export const OFFER_MAX_MINUTES = 240;
/** Quantas ofertas o mesmo local pode publicar nas últimas 24 horas (as encerradas também contam). */
export const OFFER_MAX_PER_DAY = 3;
/** Quem está a até este raio do local recebe a oferta (NOW ligado com área, ou região salva). */
export const OFFER_RADIUS_M = 5000;
/** Quantas ofertas aparecem de uma vez para a mesma pessoa. */
export const OFFER_MAX_PER_VIEW = 1;
/**
 * Preço: por enquanto a oferta é GRÁTIS. Se o produto decidir cobrar, o pedido deve passar pela chave de pagamentos
 * (`PaymentsSwitch`), como o impulsionamento. Pendência registrada no GOLIVE.md.
 */
export const OFFER_FREE = true;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const LIST_LIMIT = 20;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

/** Como o responsável enxerga a oferta. */
export interface OfferView {
  id: string;
  venueId: string;
  venueName: string;
  text: string;
  startsAt: string;
  endsAt: string;
  phase: 'ACTIVE' | 'ENDED';
  /** Quantas pessoas estão no alcance hoje, como faixa (nunca quem). Só na oferta no ar. */
  reach: MatchReach | null;
}

export interface OfferLimits {
  textMax: number;
  textMin: number;
  minMinutes: number;
  maxMinutes: number;
  maxPerDay: number;
  radiusKm: number;
  free: boolean;
}

/** O que a pessoa perto do local vê na Home e na tela do NOW. Nada sobre quem mais recebeu. */
export interface NearbyOfferView {
  id: string;
  venueId: string;
  venueName: string;
  text: string;
  endsAt: string;
  /** Etiqueta obrigatória na tela. */
  label: 'Patrocinado';
}

/**
 * Oferta relâmpago do bar: texto curto com hora de fim, para quem está perto.
 * "Perto" = NOW ligado (com área) ou região salva, dentro de `OFFER_RADIUS_M` do local (mesma conta de distância do Match).
 */
export class OfferService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  limits(): OfferLimits {
    return { textMax: OFFER_TEXT_MAX, textMin: OFFER_TEXT_MIN, minMinutes: OFFER_MIN_MINUTES, maxMinutes: OFFER_MAX_MINUTES, maxPerDay: OFFER_MAX_PER_DAY, radiusKm: OFFER_RADIUS_M / 1000, free: OFFER_FREE };
  }

  /** O local precisa existir e ser administrado por quem pede (senão “não encontrado”, sem revelar que existe). */
  private async ownedVenue(ownerId: string, venueId: unknown): Promise<VenueRecord> {
    if (typeof venueId !== 'string' || venueId === '' || venueId.length > 64) throw notFound('Local não encontrado');
    const venue = await this.deps.places.findVenue(venueId);
    if (!venue || venue.ownerId !== ownerId) throw notFound('Local não encontrado');
    return venue;
  }

  private async view(offer: VenueOfferRecord, venue: VenueRecord, now: Date): Promise<OfferView> {
    const active = offer.endedAt === null && offer.endsAt.getTime() > now.getTime();
    return {
      id: offer.id,
      venueId: offer.venueId,
      venueName: venue.name,
      text: offer.text,
      startsAt: offer.startsAt.toISOString(),
      endsAt: offer.endsAt.toISOString(),
      phase: active ? 'ACTIVE' : 'ENDED',
      reach: active ? await this.reach(venue, offer.ownerId) : null,
    };
  }

  /** Quantas pessoas com região salva estão no raio (fora o dono e bloqueios): só faixa, como no Match. */
  async reach(venue: VenueRecord, ownerId: string): Promise<MatchReach> {
    const center = { lat: venue.lat, lng: venue.lng };
    const rows = await this.deps.regions.listInBox(boundingBox(center, OFFER_RADIUS_M), MATCH_ESTIMATE_SCAN + 1);
    const partial = rows.length > MATCH_ESTIMATE_SCAN;
    let count = 0;
    for (const r of rows.slice(0, MATCH_ESTIMATE_SCAN)) {
      if (r.userId === ownerId || distanceMeters(center, r) > OFFER_RADIUS_M) continue;
      const user = await this.deps.users.findById(r.userId);
      if (!user || user.status !== 'ACTIVE') continue;
      if (await this.deps.blocks.existsEitherWay(ownerId, r.userId)) continue;
      count += 1;
    }
    return { ...audienceBucket(count), partial };
  }

  async list(ownerId: string, venueId: unknown): Promise<{ items: OfferView[]; limits: OfferLimits; remainingToday: number }> {
    const venue = await this.ownedVenue(ownerId, venueId);
    const now = this.deps.clock.now();
    const rows = await this.deps.offers.listByVenue(venue.id, LIST_LIMIT);
    const used = await this.deps.offers.countSince(venue.id, new Date(now.getTime() - DAY_MS));
    const items = await Promise.all(rows.map((o) => this.view(o, venue, now)));
    return { items, limits: this.limits(), remainingToday: Math.max(0, OFFER_MAX_PER_DAY - used) };
  }

  async create(ownerId: string, venueId: unknown, input: { text?: unknown; minutes?: unknown }): Promise<OfferView> {
    const venue = await this.ownedVenue(ownerId, venueId);
    const now = this.deps.clock.now();

    const raw = input.text;
    if (typeof raw !== 'string') throw validationError('Escreva a oferta', { text: 'Informe o texto da oferta' });
    const text = raw.trim().replace(/\s+/g, ' ');
    if (text.length < OFFER_TEXT_MIN || text.length > OFFER_TEXT_MAX) throw validationError('Texto inválido', { text: `De ${OFFER_TEXT_MIN} a ${OFFER_TEXT_MAX} caracteres` });
    if (CONTROL_CHARS_RE.test(text)) throw validationError('Texto inválido', { text: 'Caracteres inválidos' });
    if (hasOffensiveText(text, true)) throw validationError(OFFENSIVE_MESSAGE, { text: OFFENSIVE_MESSAGE });

    const minutes = input.minutes;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < OFFER_MIN_MINUTES || minutes > OFFER_MAX_MINUTES) {
      throw validationError('Duração inválida', { minutes: `De ${OFFER_MIN_MINUTES} minutos a ${OFFER_MAX_MINUTES / 60} horas` });
    }

    if (await this.deps.offers.findActiveByVenue(venue.id, now)) throw conflict('Este local já tem uma oferta no ar. Encerre-a para publicar outra.');
    const used = await this.deps.offers.countSince(venue.id, new Date(now.getTime() - DAY_MS));
    if (used >= OFFER_MAX_PER_DAY) throw conflict(`Limite de ${OFFER_MAX_PER_DAY} ofertas por dia atingido. Tente de novo mais tarde.`);

    const offer: VenueOfferRecord = { id: this.deps.ids.next(), venueId: venue.id, ownerId, text, createdAt: now, startsAt: now, endsAt: new Date(now.getTime() + minutes * MINUTE_MS), endedAt: null };
    await this.deps.offers.create(offer, now);
    return this.view(offer, venue, now);
  }

  /** Encerra antes do fim. Só o responsável do local da oferta. */
  async end(ownerId: string, offerId: unknown): Promise<OfferView> {
    if (typeof offerId !== 'string' || offerId === '' || offerId.length > 64) throw notFound('Oferta não encontrada');
    const offer = await this.deps.offers.find(offerId);
    if (!offer || offer.ownerId !== ownerId) throw notFound('Oferta não encontrada');
    const venue = await this.deps.places.findVenue(offer.venueId);
    if (!venue || venue.ownerId !== ownerId) throw notFound('Oferta não encontrada');
    const now = this.deps.clock.now();
    await this.deps.offers.end(offer.id, now);
    return this.view((await this.deps.offers.find(offer.id)) ?? offer, venue, now);
  }

  /**
   * Ofertas que valem para a pessoa agora: a mais próxima dentro do raio do local.
   * Conta como "perto" quem está com o NOW ligado (usa a área do NOW) ou tem região salva.
   * Sem NOW com área nem região, nenhuma. Respeita bloqueios nos dois sentidos.
   */
  async forViewer(viewerId: string, now: Date): Promise<NearbyOfferView[]> {
    const active = (await this.deps.offers.listActive(now)).filter((o) => o.ownerId !== viewerId);
    if (active.length === 0) return [];
    const viewer = await this.deps.users.findById(viewerId);
    if (!viewer || viewer.status !== 'ACTIVE') return [];
    const points: { lat: number; lng: number }[] = [];
    const session = await this.deps.flash.findActiveSession(viewerId, now);
    if (session?.area) points.push(session.area);
    const region = await this.deps.regions.find(viewerId);
    if (region) points.push(region);
    if (points.length === 0) return [];

    const picks: { offer: VenueOfferRecord; venue: VenueRecord; distanceM: number }[] = [];
    for (const offer of active) {
      const venue = await this.deps.places.findVenue(offer.venueId);
      if (!venue || venue.ownerId !== offer.ownerId) continue;
      const distanceM = Math.min(...points.map((p) => distanceMeters(p, venue)));
      if (distanceM > OFFER_RADIUS_M) continue;
      if (await this.deps.blocks.existsEitherWay(viewerId, offer.ownerId)) continue;
      picks.push({ offer, venue, distanceM });
    }
    return picks
      .sort((a, b) => a.distanceM - b.distanceM || (a.offer.id < b.offer.id ? -1 : 1))
      .slice(0, OFFER_MAX_PER_VIEW)
      .map(({ offer, venue }) => ({ id: offer.id, venueId: venue.id, venueName: venue.name, text: offer.text, endsAt: offer.endsAt.toISOString(), label: 'Patrocinado' as const }));
  }
}
