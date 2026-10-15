import { decodeImageDataUrl } from './image.ts';
import { conflict, forbidden, notFound, validationError } from './errors.ts';
import { normalizeTag } from './explore-match.ts';
import type { CoreDeps } from './ports.ts';
import type { ClaimDocumentMime, ClaimStatus, EventKind, PlaceEventRecord, VenueClaimRecord, VenueRecord } from './types.ts';
import { EVENT_KINDS } from './types.ts';

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
  /** Para a lista do painel: ainda vai acontecer, está acontecendo ou já passou. */
  phase: 'UPCOMING' | 'LIVE' | 'PAST';
  sample: boolean;
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
  imageUrl?: unknown;
  tags?: unknown;
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
    const fields = this.parseEvent(input);
    const event: PlaceEventRecord = { id: this.deps.ids.next(), venueId: venue.id, ...fields, isSample: false };
    await this.deps.places.createEvent(event);
    return this.eventView(event);
  }

  async updateEvent(userId: string, venueId: unknown, eventId: unknown, input: VenueEventInput): Promise<VenueEventView> {
    const venue = await this.ownedOrThrow(userId, venueId);
    const current = typeof eventId === 'string' && eventId.length <= 64 ? await this.deps.places.findEvent(eventId) : undefined;
    if (!current || current.event.venueId !== venue.id) throw notFound('Evento não encontrado');
    const fields = this.parseEvent(input, current.event.startsAt);
    const event: PlaceEventRecord = { ...current.event, ...fields };
    if (!(await this.deps.places.updateEvent(venue.id, event))) throw notFound('Evento não encontrado');
    return this.eventView(event);
  }

  async deleteEvent(userId: string, venueId: unknown, eventId: unknown): Promise<{ deleted: true }> {
    const venue = await this.ownedOrThrow(userId, venueId);
    if (typeof eventId !== 'string' || eventId.length > 64 || !(await this.deps.places.deleteEvent(venue.id, eventId))) throw notFound('Evento não encontrado');
    return { deleted: true };
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
    return { id: e.id, title: e.title, description: e.description, kind: e.kind, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(), isFree: e.isFree, imageUrl: e.imageUrl, tags: e.tags, phase, sample: e.isSample };
  }

  private parseEvent(input: VenueEventInput, keepStart?: Date): Omit<PlaceEventRecord, 'id' | 'venueId' | 'isSample'> {
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
    let imageUrl: string | null = null;
    if (input.imageUrl !== undefined && input.imageUrl !== null && input.imageUrl !== '') {
      if (typeof input.imageUrl !== 'string' || input.imageUrl.length > 500 || !/^https:\/\/[^\s]+$/.test(input.imageUrl)) throw validationError('Evento inválido', { imageUrl: 'Use um endereço de imagem que comece com https://' });
      imageUrl = input.imageUrl;
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
    return { title, description, kind, startsAt, endsAt, isFree, imageUrl, tags };
  }
}
