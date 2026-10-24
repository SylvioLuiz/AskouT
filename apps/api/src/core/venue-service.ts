import { decodeImageDataUrl } from './image.ts';
import { conflict, forbidden, notFound, validationError } from './errors.ts';
import { normalizeTag } from './explore-match.ts';
import type { CoreDeps } from './ports.ts';
import type { ClaimDocumentMime, ClaimStatus, EventKind, EventRef, PlaceEventRecord, PublicProfile, VenueClaimRecord, VenueHours, VenueRecord } from './types.ts';
import { EVENT_KINDS, toPublicProfile } from './types.ts';

export const CLAIM_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;
export const CLAIM_NOTE_MAX = 300;
export const CLAIM_REVIEW_NOTE_MAX = 300;
/** Quantos pedidos pendentes uma pessoa pode ter ao mesmo tempo. */
export const CLAIMS_PENDING_MAX = 5;
export const VENUE_EVENT_TITLE_MAX = 80;
export const VENUE_EVENT_DESCRIPTION_MAX = 1000;
export const VENUE_EVENT_TAGS_MAX = 5;
export const VENUE_EVENT_MAX_DAYS = 30;
export const VENUE_EVENTS_LIMIT = 100;
/** Capa enviada do aparelho (a tela reduz a foto antes de enviar). */
export const EVENT_COVER_MAX_BYTES = 256 * 1024;

/** Endereço da capa enviada; `v` muda a cada troca para o navegador não mostrar a antiga. */
export function eventCoverPath(eventId: string, version: number): string {
  return `/place-events/${eventId}/cover?v=${version}`;
}

type CoverChange = { mode: 'keep' } | { mode: 'none' } | { mode: 'url'; url: string } | { mode: 'upload'; mime: string; bytes: Uint8Array };

const PDF_RE = /^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/;

export type ClaimableState = 'FREE' | 'MINE' | 'TAKEN' | 'PENDING';

export interface ClaimableVenueView {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  sample: boolean;
  state: ClaimableState;
}

export interface VenueSummaryView {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  sample: boolean;
}

export interface ClaimView {
  id: string;
  venue: VenueSummaryView;
  status: ClaimStatus;
  reviewNote: string | null;
  createdAt: string;
}

export interface VenueEventView {
  id: string;
  title: string;
  description: string | null;
  kind: EventKind;
  startsAt: string;
  endsAt: string;
  isFree: boolean;
  imageUrl: string | null;
  tags: string[];
  /** Link https para comprar ingresso, se o local informou. */
  ticketUrl: string | null;
  /** Para a lista do painel: ainda vai acontecer, está acontecendo ou já passou. */
  phase: 'UPCOMING' | 'LIVE' | 'PAST';
  sample: boolean;
}

export const VENUE_NAME_MAX = 80;
export const VENUE_ADDRESS_MAX = 200;
export const VENUE_CATEGORY_MAX = 40;
export const VENUE_DESCRIPTION_MAX = 600;
export const VENUE_UPCOMING_LIMIT = 30;
/** Capa do estabelecimento enviada do aparelho (a tela reduz a foto antes). */
export const VENUE_COVER_MAX_BYTES = 256 * 1024;
const HOUR_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EXTERNAL_KEY_RE = /^(google|osm):[A-Za-z0-9_./:-]{1,200}$/;
/** Raio para conferir, na fonte externa, que o local mesmo existe onde o app diz. */
const EXTERNAL_CHECK_RADIUS_M = 150;

export function venueCoverPath(venueId: string, version: number): string {
  return `/venues/${venueId}/cover?v=${version}`;
}

/** Logo enviada do aparelho (a tela reduz para um quadrado antes de enviar). */
export const VENUE_LOGO_MAX_BYTES = 128 * 1024;

export function venueLogoPath(venueId: string, version: number): string {
  return `/venues/${venueId}/logo?v=${version}`;
}

/** Troca de uma imagem do perfil (capa ou logo): mantém, remove, usa link https ou guarda um arquivo enviado. */
function resolveImage(input: { url: unknown; data: unknown }, current: string | null, ownPrefix: string, maxBytes: number, maxLabel: string, ownPath: () => string): { url: string | null; upload?: { mime: string; bytes: Uint8Array } } {
  const own = current !== null && current.startsWith(ownPrefix) ? current : null;
  const badUrl = () => validationError('Dados inválidos', { imageUrl: 'Use um endereço de imagem que comece com https://' });
  if (input.data !== undefined && input.data !== null && input.data !== '') {
    const img = decodeImageDataUrl(input.data, maxBytes, maxLabel);
    return { url: ownPath(), upload: { mime: img.mime, bytes: img.bytes } };
  }
  if (input.url === null || input.url === '') return { url: null };
  if (input.url === undefined) return { url: current };
  if (typeof input.url !== 'string' || input.url.length > 500) throw badUrl();
  if (own !== null && input.url === own) return { url: own };
  if (/^https:\/\/[^\s]+$/.test(input.url)) return { url: input.url };
  throw badUrl();
}

/** Página pública de um estabelecimento (qualquer local, com ou sem dono). */
export interface VenueProfileView {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  description: string | null;
  hours: VenueHours | null;
  /** https ou caminho da capa enviada (a borda HTTP monta o endereço). */
  coverUrl: string | null;
  /** Logo: https ou caminho da logo enviada. */
  logoUrl: string | null;
  /** Foto do Google (referência opaca) e o crédito, quando o local veio de lá e não tem capa própria. */
  photoRef: string | null;
  photoAuthor: string | null;
  lat: number;
  lng: number;
  sample: boolean;
  /** Tem alguém administrando (a página é "oficial"). */
  claimed: boolean;
  isOwner: boolean;
  following: boolean;
  followerCount: number;
  rating: VenueRatingView;
  /** Eventos que ainda vão acontecer ou estão acontecendo, do mais cedo ao mais tarde. */
  upcomingEvents: VenueEventView[];
  /** Ranking de quem mais frequenta (só perfis que o visitante pode ver). */
  regulars: VenueRegularView[];
  /** Amigos (quem você segue e te segue de volta) que já confirmaram presença aqui: quantos são e até 3 para mostrar. */
  friendsWent: { count: number; sample: PublicProfile[] };
}

/** Quem mais frequenta o local: presenças confirmadas em eventos que já começaram. */
export interface VenueRegularView {
  rank: number;
  user: PublicProfile;
  visits: number;
}

export const VENUE_REGULARS_LIMIT = 10;

/** Nota do estabelecimento: média de 1 a 5 (uma casa decimal), quantas pessoas avaliaram e a nota de quem consulta. */
export interface VenueRatingView {
  average: number | null;
  count: number;
  mine: number | null;
}

export function ratingView(r: { count: number; sum: number; mine: number | null }): VenueRatingView {
  return { average: r.count === 0 ? null : Math.round((r.sum / r.count) * 10) / 10, count: r.count, mine: r.mine };
}

export interface VenueProfileInput {
  name?: unknown;
  address?: unknown;
  category?: unknown;
  description?: unknown;
  hours?: unknown;
  /** Ausente mantém a capa; vazio/nulo remove; https troca. */
  imageUrl?: unknown;
  /** Data URL (JPEG, PNG ou WebP, até 256 KB) enviada do aparelho. */
  imageData?: unknown;
  /** Logo: mesmas regras da capa (`logoUrl` https ou `logoData` até 128 KB). */
  logoUrl?: unknown;
  logoData?: unknown;
}

export const TICKET_URL_MAX = 500;

/**
 * Link de compra de ingresso. Só https, com domínio de verdade (nada de IP, localhost nem login embutido no
 * endereço), para o botão do evento nunca levar para um endereço de rede interna nem esconder o destino.
 * Ausente mantém o atual; vazio ou nulo remove.
 */
export function parseTicketUrl(value: unknown, current: string | null): string | null {
  if (value === undefined) return current;
  if (value === null) return null;
  const bad = () => validationError('Evento inválido', { ticketUrl: 'Use o endereço completo do ingresso, começando com https://' });
  if (typeof value !== 'string') throw bad();
  const raw = value.trim();
  if (raw === '') return null;
  if (raw.length > TICKET_URL_MAX || !/^https:\/\/[^\s]+$/.test(raw)) throw bad();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw bad();
  }
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || !host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[') || host.endsWith('.local') || host.endsWith('.internal')) throw bad();
  return raw;
}

function parseHours(value: unknown): VenueHours | null {
  if (value === undefined || value === null) return null;
  const bad = () => validationError('Horários inválidos', { hours: 'Use 7 dias, de domingo a sábado, com abre e fecha em HH:MM' });
  if (!Array.isArray(value) || value.length !== 7) throw bad();
  const out: VenueHours = [];
  for (const day of value as unknown[]) {
    if (day === null) {
      out.push(null);
      continue;
    }
    const d = day as { open?: unknown; close?: unknown } | undefined;
    if (typeof day !== 'object' || !d || typeof d.open !== 'string' || typeof d.close !== 'string' || !HOUR_RE.test(d.open) || !HOUR_RE.test(d.close) || d.open === d.close) throw bad();
    out.push({ open: d.open, close: d.close });
  }
  return out.every((d) => d === null) ? null : out;
}

export interface VenuePanelView {
  venue: VenueSummaryView;
  events: VenueEventView[];
}

export interface VenueEventInput {
  title?: unknown;
  description?: unknown;
  kind?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  isFree?: unknown;
  /** Endereço https de uma imagem da web; vazio/nulo tira a capa; ausente mantém a atual. */
  imageUrl?: unknown;
  /** Data URL (JPEG, PNG ou WebP, até 256 KB) de uma foto enviada do aparelho. */
  imageData?: unknown;
  tags?: unknown;
  /** Link https para comprar ingresso; vazio/nulo remove; ausente mantém o atual. */
  ticketUrl?: unknown;
}

export interface ClaimInput {
  /** Data URL do documento (PDF, JPEG, PNG ou WebP) de até 2 MB. */
  document?: unknown;
  note?: unknown;
}

function summary(v: VenueRecord): VenueSummaryView {
  return { id: v.id, name: v.name, address: v.address, category: v.category, sample: v.isSample };
}

function text(value: unknown, max: number, field: string, label: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw validationError('Dados inválidos', { [field]: `${label} é obrigatório` });
    return null;
  }
  if (typeof value !== 'string') throw validationError('Dados inválidos', { [field]: `${label} inválido` });
  const t = value.trim().replace(/\r\n/g, '\n');
  if (t === '') {
    if (required) throw validationError('Dados inválidos', { [field]: `${label} é obrigatório` });
    return null;
  }
  if (Array.from(t).length > max) throw validationError('Dados inválidos', { [field]: `${label} pode ter até ${max} caracteres` });
  return t;
}

/** Documento da reivindicação: imagem (confere os primeiros bytes) ou PDF (confere o "%PDF-"). */
export function decodeClaimDocument(value: unknown): { mime: ClaimDocumentMime; bytes: Uint8Array } {
  const fail = () => validationError('Documento inválido', { document: 'Envie um PDF ou uma imagem (JPEG, PNG ou WebP) de até 2 MB' });
  if (typeof value !== 'string' || value.length > Math.ceil((CLAIM_DOCUMENT_MAX_BYTES * 4) / 3) + 64) throw fail();
  const pdf = PDF_RE.exec(value);
  if (pdf) {
    const bytes = Buffer.from(pdf[1] as string, 'base64');
    if (bytes.length === 0 || bytes.length > CLAIM_DOCUMENT_MAX_BYTES || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw fail();
    return { mime: 'application/pdf', bytes: new Uint8Array(bytes) };
  }
  try {
    const img = decodeImageDataUrl(value, CLAIM_DOCUMENT_MAX_BYTES, '2 MB');
    return { mime: img.mime, bytes: new Uint8Array(img.bytes) };
  } catch {
    throw fail();
  }
}

export class VenueService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  /** Busca locais do AskouT pelo nome para reivindicar, dizendo o que dá para fazer com cada um. */
  async searchClaimable(userId: string, query: unknown): Promise<ClaimableVenueView[]> {
    const q = typeof query === 'string' ? query.trim() : '';
    if (Array.from(q).length < 2) return [];
    if (Array.from(q).length > 80) throw validationError('Busca inválida', { q: 'Use até 80 caracteres' });
    const found = await this.deps.places.searchVenues(q, undefined, 0, 20);
    const out: ClaimableVenueView[] = [];
    for (const { venue } of found) {
      let state: ClaimableState = 'FREE';
      if (venue.ownerId === userId) state = 'MINE';
      else if (venue.ownerId) state = 'TAKEN';
      else if (await this.deps.claims.hasPending(venue.id, userId)) state = 'PENDING';
      out.push({ ...summary(venue), state });
    }
    return out;
  }

  /** Meus locais e meus pedidos (do mais novo para o mais antigo). */
  async mine(userId: string): Promise<{ venues: VenueSummaryView[]; claims: ClaimView[] }> {
    const venues = (await this.deps.places.listVenuesByOwner(userId)).map(summary);
    const claims: ClaimView[] = [];
    for (const claim of await this.deps.claims.listByUser(userId)) {
      if (claim.status === 'APPROVED') continue;
      const venue = await this.deps.places.findVenue(claim.venueId);
      if (!venue) continue;
      claims.push({ id: claim.id, venue: summary(venue), status: claim.status, reviewNote: claim.reviewNote, createdAt: claim.createdAt.toISOString() });
    }
    return { venues, claims };
  }

  async requestClaim(userId: string, venueId: unknown, input: ClaimInput): Promise<ClaimView> {
    const venue = await this.venueOrThrow(venueId);
    if (venue.ownerId === userId) throw conflict('Você já administra este local');
    if (venue.ownerId) throw conflict('Este local já tem um responsável');
    if (await this.deps.claims.hasPending(venue.id, userId)) throw conflict('Você já tem um pedido em análise para este local');
    const pending = (await this.deps.claims.listByUser(userId)).filter((c) => c.status === 'PENDING').length;
    if (pending >= CLAIMS_PENDING_MAX) throw conflict(`Você já tem ${CLAIMS_PENDING_MAX} pedidos em análise. Espere a resposta antes de pedir outro`);
    const note = text(input.note, CLAIM_NOTE_MAX, 'note', 'Mensagem');
    const doc = decodeClaimDocument(input.document);
    const claim: VenueClaimRecord = { id: this.deps.ids.next(), venueId: venue.id, userId, status: 'PENDING', note, documentMime: doc.mime, reviewNote: null, reviewedBy: null, reviewedAt: null, createdAt: this.deps.clock.now() };
    await this.deps.claims.create(claim, doc.bytes);
    return { id: claim.id, venue: summary(venue), status: 'PENDING', reviewNote: null, createdAt: claim.createdAt.toISOString() };
  }

  /** Desiste de um pedido em análise (o do admin segue só até alguém decidir). */
  async cancelClaim(userId: string, claimId: unknown): Promise<{ cancelled: true }> {
    const claim = typeof claimId === 'string' && claimId.length <= 64 ? await this.deps.claims.findById(claimId) : undefined;
    if (!claim || claim.userId !== userId) throw notFound('Pedido não encontrado');
    if (!(await this.deps.claims.review(claim.id, 'REJECTED', userId, 'Cancelado por quem pediu', this.deps.clock.now()))) throw conflict('Este pedido já foi decidido');
    return { cancelled: true };
  }

  /** Decisão do admin. Aprovar torna a pessoa responsável pelo local e recusa os outros pedidos pendentes dele. */
  async reviewClaim(adminId: string, claimId: unknown, decision: unknown, reviewNote?: unknown): Promise<ClaimView> {
    const admin = await this.deps.users.findById(adminId);
    if (!admin || admin.role !== 'ADMIN') throw forbidden('Só administradores decidem pedidos');
    if (decision !== 'APPROVED' && decision !== 'REJECTED') throw validationError('Decisão inválida', { decision: 'Use APPROVED ou REJECTED' });
    const note = text(reviewNote, CLAIM_REVIEW_NOTE_MAX, 'reviewNote', 'Motivo');
    if (decision === 'REJECTED' && !note) throw validationError('Dados inválidos', { reviewNote: 'Explique o motivo da recusa' });
    const claim = typeof claimId === 'string' && claimId.length <= 64 ? await this.deps.claims.findById(claimId) : undefined;
    if (!claim) throw notFound('Pedido não encontrado');
    const venue = await this.venueOrThrow(claim.venueId);
    if (claim.status !== 'PENDING') throw conflict('Este pedido já foi decidido');
    if (decision === 'APPROVED' && venue.ownerId && venue.ownerId !== claim.userId) throw conflict('Este local já tem um responsável');
    const now = this.deps.clock.now();
    if (!(await this.deps.claims.review(claim.id, decision, adminId, note, now))) throw conflict('Este pedido já foi decidido');
    if (decision === 'APPROVED') {
      await this.deps.places.setVenueOwner(venue.id, claim.userId);
      // Quem passa a administrar o local já o segue: os posts dele entram no feed.
      await this.deps.places.followVenue(claim.userId, venue.id, now);
      for (const other of await this.deps.claims.listByStatus('PENDING', 200)) {
        if (other.venueId === venue.id) await this.deps.claims.review(other.id, 'REJECTED', adminId, 'Outro pedido foi aprovado para este local', now);
      }
    }
    await this.deps.notifier.notify({
      userId: claim.userId,
      type: 'VENUE_CLAIM',
      title: decision === 'APPROVED' ? `Você agora administra ${venue.name}` : `Pedido para ${venue.name} recusado`,
      body: decision === 'APPROVED' ? 'Crie os eventos do local no seu perfil' : (note as string),
      url: '/locais',
      dedupeKey: `venue-claim:${claim.id}`,
    });
    return { id: claim.id, venue: summary(venue), status: decision, reviewNote: note, createdAt: claim.createdAt.toISOString() };
  }

  async panel(userId: string, venueId: unknown): Promise<VenuePanelView> {
    const venue = await this.ownedOrThrow(userId, venueId);
    const events = (await this.deps.places.listVenueEvents(venue.id)).slice(0, VENUE_EVENTS_LIMIT);
    return { venue: summary(venue), events: events.map((e) => this.eventView(e)) };
  }

  async createEvent(userId: string, venueId: unknown, input: VenueEventInput): Promise<VenueEventView> {
    const venue = await this.ownedOrThrow(userId, venueId);
    const { cover, ...fields } = this.parseEvent(input);
    const id = this.deps.ids.next();
    const event: PlaceEventRecord = { id, venueId: venue.id, ...fields, imageUrl: cover.mode === 'url' ? cover.url : null, isSample: false };
    if (cover.mode === 'upload') event.imageUrl = eventCoverPath(id, this.deps.clock.now().getTime());
    await this.deps.places.createEvent(event);
    if (cover.mode === 'upload') await this.deps.places.setEventCover(id, cover.mime, cover.bytes);
    return this.eventView(event);
  }

  /**
   * Confere os campos de um evento sem criar nada (rascunhos da agenda). Foto enviada do aparelho não vale aqui: só endereço https.
   * `keepStart` deixa manter um início que já passou do prazo de "no futuro".
   */
  checkEventInput(input: VenueEventInput, keepStart?: Date): { title: string; description: string; kind: EventKind; startsAt: Date; endsAt: Date; isFree: boolean; tags: string[]; ticketUrl: string | null; imageUrl: string | null } {
    const { cover, ...f } = this.parseEvent(input, keepStart);
    if (cover.mode === 'upload') throw validationError('Evento inválido', { imageUrl: 'Aqui só dá para usar o endereço (https://) de uma imagem' });
    return { title: f.title, description: f.description ?? '', kind: f.kind, startsAt: f.startsAt, endsAt: f.endsAt, isFree: f.isFree, tags: f.tags, ticketUrl: f.ticketUrl ?? null, imageUrl: cover.mode === 'url' ? cover.url : null };
  }

  async updateEvent(userId: string, venueId: unknown, eventId: unknown, input: VenueEventInput): Promise<VenueEventView> {
    const venue = await this.ownedOrThrow(userId, venueId);
    const current = typeof eventId === 'string' && eventId.length <= 64 ? await this.deps.places.findEvent(eventId) : undefined;
    if (!current || current.event.venueId !== venue.id) throw notFound('Evento não encontrado');
    const { cover, ...fields } = this.parseEvent(input, current.event.startsAt, current.event);
    const event: PlaceEventRecord = { ...current.event, ...fields };
    if (cover.mode === 'url') event.imageUrl = cover.url;
    else if (cover.mode === 'none') event.imageUrl = null;
    else if (cover.mode === 'upload') event.imageUrl = eventCoverPath(event.id, this.deps.clock.now().getTime());
    if (!(await this.deps.places.updateEvent(venue.id, event))) throw notFound('Evento não encontrado');
    if (cover.mode === 'upload') await this.deps.places.setEventCover(event.id, cover.mime, cover.bytes);
    else if (cover.mode === 'url' || cover.mode === 'none') await this.deps.places.clearEventCover(event.id);
    return this.eventView(event);
  }

  async deleteEvent(userId: string, venueId: unknown, eventId: unknown): Promise<{ deleted: true }> {
    const venue = await this.ownedOrThrow(userId, venueId);
    if (typeof eventId !== 'string' || eventId.length > 64 || !(await this.deps.places.deleteEvent(venue.id, eventId))) throw notFound('Evento não encontrado');
    return { deleted: true };
  }

  /** Capa enviada de um evento, para o <img> (que não manda o token). */
  async eventCover(eventId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (typeof eventId !== 'string' || eventId === '' || eventId.length > 64) return undefined;
    return this.deps.places.findEventCover(eventId);
  }

  /** Página pública do local. Qualquer pessoa logada vê; quem administra também recebe `isOwner`. */
  async profile(viewerId: string, venueId: unknown): Promise<VenueProfileView> {
    const venue = await this.venueOrThrow(venueId);
    const now = this.deps.clock.now().getTime();
    const [following, followerCount, events, rating] = await Promise.all([this.deps.places.isFollowingVenue(viewerId, venue.id), this.deps.places.countVenueFollowers(venue.id), this.deps.places.listVenueEvents(venue.id), this.deps.places.venueRating(venue.id, viewerId)]);
    const upcoming = events
      .filter((e) => e.endsAt.getTime() > now)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.id < b.id ? -1 : 1))
      .slice(0, VENUE_UPCOMING_LIMIT)
      .map((e) => this.eventView(e));
    return {
      id: venue.id,
      name: venue.name,
      address: venue.address,
      category: venue.category,
      description: venue.description ?? null,
      hours: venue.hours ?? null,
      coverUrl: venue.coverUrl ?? null,
      logoUrl: venue.logoUrl ?? null,
      photoRef: venue.photoRef ?? null,
      photoAuthor: venue.photoAuthor ?? null,
      lat: venue.lat,
      lng: venue.lng,
      sample: venue.isSample,
      claimed: (venue.ownerId ?? null) !== null,
      isOwner: venue.ownerId === viewerId,
      following,
      followerCount,
      rating: ratingView(rating),
      upcomingEvents: upcoming,
      ...(await this.visitors(viewerId, venue.id, events, now)),
    };
  }

  /**
   * Ranking de quem mais confirmou presença em eventos do local que já começaram (eventos do Explorar e posts de evento feitos em nome do local).
   * Perfil privado só aparece para quem já o segue; bloqueio em qualquer sentido e conta suspensa ficam de fora. Empate: ordem alfabética do nome de usuário.
   */
  private async visitors(viewerId: string, venueId: string, events: PlaceEventRecord[], now: number): Promise<{ regulars: VenueRegularView[]; friendsWent: { count: number; sample: PublicProfile[] } }> {
    const posts = await this.deps.posts.listFor([], [], { limit: 200, offset: 0 }, undefined, { venueIds: [venueId] });
    const refs: EventRef[] = [
      ...events.filter((e) => e.startsAt.getTime() <= now).map((e) => ({ source: 'PLACE' as const, id: e.id })),
      ...posts.filter((p) => p.post.venueId === venueId && p.post.eventStartsAt && p.post.eventStartsAt.getTime() <= now && p.post.archivedAt === null).map((p) => ({ source: 'USER' as const, id: p.post.id })),
    ];
    if (refs.length === 0) return { regulars: [], friendsWent: { count: 0, sample: [] } };
    const counts = await this.deps.eventRoom.countGoingByUser(refs);
    const profiles = new Map((await this.deps.users.findProfilesByIds(counts.map((c) => c.userId))).map((p) => [p.userId, p] as const));
    const rows: { user: PublicProfile; visits: number; friend: boolean }[] = [];
    for (const c of counts) {
      const profile = profiles.get(c.userId);
      if (!profile) continue;
      if (c.userId !== viewerId) {
        const account = await this.deps.users.findById(c.userId);
        if (!account || account.status !== 'ACTIVE') continue;
        if (await this.deps.blocks.existsEitherWay(viewerId, c.userId)) continue;
        if (profile.isPrivate && (await this.deps.follows.get(viewerId, c.userId))?.status !== 'ACCEPTED') continue;
      }
      const friend = c.userId !== viewerId && (await this.deps.follows.get(viewerId, c.userId))?.status === 'ACCEPTED' && (await this.deps.follows.get(c.userId, viewerId))?.status === 'ACCEPTED';
      rows.push({ user: toPublicProfile(profile), visits: c.count, friend });
    }
    rows.sort((a, b) => b.visits - a.visits || (a.user.username < b.user.username ? -1 : 1));
    const friends = rows.filter((r) => r.friend);
    return {
      regulars: rows.slice(0, VENUE_REGULARS_LIMIT).map((r, i) => ({ rank: i + 1, user: r.user, visits: r.visits })),
      friendsWent: { count: friends.length, sample: friends.slice(0, 3).map((r) => r.user) },
    };
  }

  /** Dono edita nome, endereço, categoria, descrição, horários e capa. Só o que vier muda; vazio apaga o que é opcional. */
  async updateProfile(userId: string, venueId: unknown, input: VenueProfileInput): Promise<VenueProfileView> {
    const venue = await this.ownedOrThrow(userId, venueId);
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw validationError('Perfil inválido', { profile: 'Dados do perfil inválidos' });
    const name = input.name === undefined ? venue.name : (text(input.name, VENUE_NAME_MAX, 'name', 'Nome', true) as string);
    if (Array.from(name).length < 2) throw validationError('Dados inválidos', { name: 'O nome precisa de pelo menos 2 caracteres' });
    const address = input.address === undefined ? venue.address : text(input.address, VENUE_ADDRESS_MAX, 'address', 'Endereço');
    const category = input.category === undefined ? venue.category : text(input.category, VENUE_CATEGORY_MAX, 'category', 'Categoria');
    const description = input.description === undefined ? (venue.description ?? null) : text(input.description, VENUE_DESCRIPTION_MAX, 'description', 'Descrição');
    const hours = input.hours === undefined ? (venue.hours ?? null) : parseHours(input.hours);
    const now = this.deps.clock.now().getTime();
    const cover = resolveImage({ url: input.imageUrl, data: input.imageData }, venue.coverUrl ?? null, `/venues/${venue.id}/cover`, VENUE_COVER_MAX_BYTES, '250 KB', () => venueCoverPath(venue.id, now));
    const logo = resolveImage({ url: input.logoUrl, data: input.logoData }, venue.logoUrl ?? null, `/venues/${venue.id}/logo`, VENUE_LOGO_MAX_BYTES, '125 KB', () => venueLogoPath(venue.id, now));
    await this.deps.places.updateVenueProfile(venue.id, { name, address, category, description, hours, coverUrl: cover.url, logoUrl: logo.url });
    const ownCover = cover.url !== null && cover.url.startsWith(`/venues/${venue.id}/cover`);
    const ownLogo = logo.url !== null && logo.url.startsWith(`/venues/${venue.id}/logo`);
    if (cover.upload) await this.deps.places.setVenueCover(venue.id, cover.upload.mime, cover.upload.bytes);
    else if (!ownCover) await this.deps.places.clearVenueCover(venue.id);
    if (logo.upload) await this.deps.places.setVenueLogo(venue.id, logo.upload.mime, logo.upload.bytes);
    else if (!ownLogo) await this.deps.places.clearVenueLogo(venue.id);
    return this.profile(userId, venue.id);
  }

  /** Logo enviada do local, para o <img>. */
  async venueLogo(venueId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (typeof venueId !== 'string' || venueId === '' || venueId.length > 64) return undefined;
    return this.deps.places.findVenueLogo(venueId);
  }

  /** Capa enviada do local, para o <img> (que não manda o token). */
  async venueCover(venueId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (typeof venueId !== 'string' || venueId === '' || venueId.length > 64) return undefined;
    return this.deps.places.findVenueCover(venueId);
  }

  async follow(userId: string, venueId: unknown): Promise<{ following: true; followerCount: number }> {
    const venue = await this.venueOrThrow(venueId);
    await this.deps.places.followVenue(userId, venue.id, this.deps.clock.now());
    return { following: true, followerCount: await this.deps.places.countVenueFollowers(venue.id) };
  }

  /** Avalia o local de 1 a 5 estrelas (de novo = troca a nota). Quem administra o local não avalia o próprio. */
  async rate(userId: string, venueId: unknown, stars: unknown): Promise<VenueRatingView> {
    const venue = await this.venueOrThrow(venueId);
    if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) throw validationError('Nota inválida', { stars: 'Use um número inteiro de 1 a 5' });
    if (venue.ownerId === userId) throw forbidden('Você não pode avaliar o seu próprio estabelecimento');
    await this.deps.places.rateVenue(userId, venue.id, stars, this.deps.clock.now());
    return ratingView(await this.deps.places.venueRating(venue.id, userId));
  }

  async clearRating(userId: string, venueId: unknown): Promise<VenueRatingView> {
    const venue = await this.venueOrThrow(venueId);
    await this.deps.places.clearVenueRating(userId, venue.id);
    return ratingView(await this.deps.places.venueRating(venue.id, userId));
  }

  async unfollow(userId: string, venueId: unknown): Promise<{ following: false; followerCount: number }> {
    const venue = await this.venueOrThrow(venueId);
    await this.deps.places.unfollowVenue(userId, venue.id);
    return { following: false, followerCount: await this.deps.places.countVenueFollowers(venue.id) };
  }

  /**
   * Página de um lugar que só existe na fonte externa (Google): confere lá que o lugar existe ali perto e cria o local
   * na primeira vez. Nunca confia no nome vindo do app. Devolve o id para abrir `/bares/:id`.
   */
  async openExternal(input: { key?: unknown; lat?: unknown; lng?: unknown }): Promise<{ venueId: string }> {
    const key = input.key;
    if (typeof key !== 'string' || !EXTERNAL_KEY_RE.test(key)) throw validationError('Local inválido', { key: 'Identificador de local inválido' });
    const known = await this.deps.places.findVenueByExternalKey(key);
    if (known) return { venueId: known.id };
    const { lat, lng } = input;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw validationError('Local inválido', { lat: 'Posição inválida' });
    const found = await this.deps.placeSource.nearby({ lat, lng }, EXTERNAL_CHECK_RADIUS_M, 40);
    const place = found.places.find((p) => `${p.source.toLowerCase()}:${p.externalId}` === key);
    if (!place) throw notFound('Local não encontrado');
    const venue: VenueRecord = {
      id: this.deps.ids.next(),
      name: place.name.slice(0, VENUE_NAME_MAX),
      address: null,
      category: place.category ? place.category.slice(0, VENUE_CATEGORY_MAX) : null,
      lat: place.lat,
      lng: place.lng,
      isSample: false,
      ownerId: null,
      externalKey: key,
      photoRef: place.photoRef ?? null,
      photoAuthor: place.photoAuthor ?? null,
    };
    try {
      await this.deps.places.createVenue(venue);
    } catch (error) {
      const again = await this.deps.places.findVenueByExternalKey(key);
      if (again) return { venueId: again.id };
      throw error;
    }
    return { venueId: venue.id };
  }

  /** Documento de um pedido, só para admin. */
  async claimDocument(adminId: string, claimId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    const admin = await this.deps.users.findById(adminId);
    if (!admin || admin.role !== 'ADMIN') throw forbidden('Só administradores veem o documento');
    if (typeof claimId !== 'string' || claimId.length > 64) return undefined;
    return this.deps.claims.findDocument(claimId);
  }

  private async venueOrThrow(venueId: unknown): Promise<VenueRecord> {
    const venue = typeof venueId === 'string' && venueId !== '' && venueId.length <= 64 ? await this.deps.places.findVenue(venueId) : undefined;
    if (!venue) throw notFound('Local não encontrado');
    return venue;
  }

  /** Quem não é responsável recebe "não encontrado", para não revelar quais locais têm dono. */
  private async ownedOrThrow(userId: string, venueId: unknown): Promise<VenueRecord> {
    const venue = await this.venueOrThrow(venueId);
    if (venue.ownerId !== userId) throw notFound('Local não encontrado');
    return venue;
  }

  private eventView(e: PlaceEventRecord): VenueEventView {
    const now = this.deps.clock.now().getTime();
    const phase = e.endsAt.getTime() <= now ? 'PAST' : e.startsAt.getTime() <= now ? 'LIVE' : 'UPCOMING';
    return { id: e.id, title: e.title, description: e.description, kind: e.kind, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(), isFree: e.isFree, imageUrl: e.imageUrl, tags: e.tags, ticketUrl: e.ticketUrl ?? null, phase, sample: e.isSample };
  }

  private parseEvent(input: VenueEventInput, keepStart?: Date, current?: PlaceEventRecord): Omit<PlaceEventRecord, 'id' | 'venueId' | 'isSample' | 'imageUrl'> & { cover: CoverChange } {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw validationError('Evento inválido', { event: 'Dados do evento inválidos' });
    const title = text(input.title, VENUE_EVENT_TITLE_MAX, 'title', 'Nome do evento', true) as string;
    const description = text(input.description, VENUE_EVENT_DESCRIPTION_MAX, 'description', 'Descrição');
    let kind: EventKind = 'OTHER';
    if (input.kind !== undefined && input.kind !== null) {
      if (typeof input.kind !== 'string' || !(EVENT_KINDS as readonly string[]).includes(input.kind)) throw validationError('Evento inválido', { kind: 'Tipo de evento inválido' });
      kind = input.kind as EventKind;
    }
    if (input.isFree !== undefined && typeof input.isFree !== 'boolean') throw validationError('Evento inválido', { isFree: 'Informe se é grátis ou não' });
    const isFree = input.isFree === true;
    let cover: CoverChange = current ? { mode: 'keep' } : { mode: 'none' };
    if (input.imageData !== undefined && input.imageData !== null && input.imageData !== '') {
      const img = decodeImageDataUrl(input.imageData, EVENT_COVER_MAX_BYTES, '250 KB');
      cover = { mode: 'upload', mime: img.mime, bytes: img.bytes };
    } else if (input.imageUrl === null || input.imageUrl === '') {
      cover = { mode: 'none' };
    } else if (input.imageUrl !== undefined) {
      if (typeof input.imageUrl !== 'string' || input.imageUrl.length > 500) throw validationError('Evento inválido', { imageUrl: 'Use um endereço de imagem que comece com https://' });
      if (current && input.imageUrl === current.imageUrl && input.imageUrl.startsWith(`/place-events/${current.id}/cover`)) cover = { mode: 'keep' };
      else if (/^https:\/\/[^\s]+$/.test(input.imageUrl)) cover = { mode: 'url', url: input.imageUrl };
      else throw validationError('Evento inválido', { imageUrl: 'Use um endereço de imagem que comece com https://' });
    }
    let tags: string[] = [];
    if (input.tags !== undefined && input.tags !== null) {
      if (!Array.isArray(input.tags) || input.tags.some((t) => typeof t !== 'string') || input.tags.length > VENUE_EVENT_TAGS_MAX * 2) throw validationError('Evento inválido', { tags: `Use até ${VENUE_EVENT_TAGS_MAX} hashtags` });
      tags = [...new Set((input.tags as string[]).map((t) => normalizeTag(t)).filter((t) => t !== ''))];
      if (tags.length > VENUE_EVENT_TAGS_MAX) throw validationError('Evento inválido', { tags: `Use até ${VENUE_EVENT_TAGS_MAX} hashtags` });
    }
    const date = (v: unknown, label: string, field: string): Date => {
      const d = typeof v === 'string' && v.length <= 40 ? new Date(v) : new Date(Number.NaN);
      if (Number.isNaN(d.getTime())) throw validationError('Evento inválido', { [field]: `${label} inválido` });
      return d;
    };
    const now = this.deps.clock.now().getTime();
    const startsAt = date(input.startsAt, 'Início', 'startsAt');
    const unchanged = keepStart !== undefined && keepStart.getTime() === startsAt.getTime();
    if (!unchanged && startsAt.getTime() < now - 5 * 60_000) throw validationError('Evento inválido', { startsAt: 'O início precisa ser no futuro' });
    if (startsAt.getTime() > now + 2 * 365 * 24 * 3_600_000) throw validationError('Evento inválido', { startsAt: 'Início distante demais' });
    const endsAt = input.endsAt === undefined || input.endsAt === null || input.endsAt === '' ? new Date(startsAt.getTime() + 3 * 3_600_000) : date(input.endsAt, 'Fim', 'endsAt');
    if (endsAt.getTime() <= startsAt.getTime()) throw validationError('Evento inválido', { endsAt: 'O fim precisa ser depois do início' });
    if (endsAt.getTime() - startsAt.getTime() > VENUE_EVENT_MAX_DAYS * 24 * 3_600_000) throw validationError('Evento inválido', { endsAt: `O evento pode durar até ${VENUE_EVENT_MAX_DAYS} dias` });
    const ticketUrl = parseTicketUrl(input.ticketUrl, current?.ticketUrl ?? null);
    return { title, description, kind, startsAt, endsAt, isFree, tags, ticketUrl, cover };
  }
}
