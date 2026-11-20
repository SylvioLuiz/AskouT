import { randomBytes, timingSafeEqual } from 'node:crypto';
import { decodeImageDataUrl } from './image.ts';
import { conflict, forbidden, notFound, rateLimited, validationError } from './errors.ts';
import { normalizeTag } from './explore-match.ts';
import type { CoreDeps } from './ports.ts';
import type { ClaimDocumentMime, ClaimStatus, EventKind, EventRef, ExternalPlace, PlaceEventRecord, Profile, PublicProfile, VenueClaimRecord, VenueHours, VenueRecord } from './types.ts';
import { EVENT_KINDS, toPublicProfile } from './types.ts';
import { canManageVenue, venueRoleOf, type VenueRole } from './venue-access.ts';

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
export const ORGANIZATION_NAME_MAX = 80;
export const ORGANIZATION_TYPE_MAX = 40;
export const ORGANIZATION_CAMPUS_MAX = 120;
export const ORGANIZATION_DESCRIPTION_MAX = 500;
/** Categoria quando quem pede não diz o tipo (bateria, atlética...). */
export const ORGANIZATION_DEFAULT_TYPE = 'Organização';
/** Quantos avisos de evento novo saem ao mesmo tempo (o resto espera a vez). */
const ANNOUNCE_BATCH = 25;
/** Intervalo mínimo entre dois check-ins da mesma pessoa no mesmo local. */
export const CHECKIN_COOLDOWN_HOURS = 6;
/** Quanto um check-in pesa no ranking em relação a uma presença confirmada (que vale 1). */
export const CHECKIN_WEIGHT = 2;

const ANNOUNCE_WHEN = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

function clipTitle(value: string, max: number): string {
  const chars = Array.from(value.trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

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

/** Convite para administrar um local, como a pessoa convidada o vê. */
export interface TeamInviteView {
  venue: VenueSummaryView;
  invitedBy: PublicProfile | null;
  createdAt: string;
}

export interface TeamMemberView {
  user: PublicProfile;
  role: 'OWNER' | 'MANAGER';
  status: 'ACCEPTED' | 'PENDING';
  since: string | null;
}

export interface TeamView {
  /** O que quem pergunta é no local: só o dono mexe na equipe. */
  role: Exclude<VenueRole, null>;
  members: TeamMemberView[];
}

/** Limite de administradores adicionais (com convites pendentes) por local. */
export const VENUE_TEAM_MAX = 10;

export interface VenueSummaryView {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  sample: boolean;
  /** Organização (bateria, atlética...) em vez de estabelecimento. */
  organization: boolean;
}

/** Local criado do zero em "Meus locais": ainda não existe no AskouT nem veio do Google. */
export interface VenueRequestInput {
  name?: unknown;
  /** Bar, balada, restaurante... (opcional). */
  category?: unknown;
  address?: unknown;
  /** Onde fica, para o local ter lugar no mapa. */
  lat?: unknown;
  lng?: unknown;
  /** Data URL de um documento que mostre que o local é da pessoa (CNPJ, alvará ou comprovante; PDF ou imagem até 2 MB). */
  document?: unknown;
  note?: unknown;
}

/** Pedido para criar a página de uma organização (da facul ou não: atlética, coletivo, produtora, empresa...). */
export interface OrganizationRequestInput {
  name?: unknown;
  /** Tipo: bateria, atlética, centro acadêmico... (vira a categoria). */
  type?: unknown;
  /** Faculdade e campus, ou bairro/cidade/sede (vira o endereço da página). */
  campus?: unknown;
  description?: unknown;
  /** Onde fica a sede (campus, sede ou point), para a página ter lugar no mapa. */
  lat?: unknown;
  lng?: unknown;
  /** Data URL de um comprovante de que a pessoa representa a organização (PDF ou imagem até 2 MB). */
  document?: unknown;
  note?: unknown;
}

export interface VenueBellView {
  following: boolean;
  /** Sininho: aviso de cada evento novo. */
  notify: boolean;
  followerCount: number;
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
/** Quantos eventos que já terminaram a página do local mostra em "Já rolou aqui". */
export const VENUE_PAST_LIMIT = 20;
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
  /** Dono ou administrador adicional: vê as ferramentas do estabelecimento. */
  canManage: boolean;
  role: VenueRole;
  following: boolean;
  /** Sininho ligado: quem consulta recebe aviso de cada evento novo. */
  notify: boolean;
  /** Organização (bateria, atlética...) em vez de estabelecimento. */
  organization: boolean;
  followerCount: number;
  rating: VenueRatingView;
  /** Eventos que ainda vão acontecer ou estão acontecendo, do mais cedo ao mais tarde. */
  upcomingEvents: VenueEventView[];
  /** Eventos que já terminaram, do mais recente ao mais antigo (até VENUE_PAST_LIMIT), com quantas pessoas confirmaram presença. */
  pastEvents: (VenueEventView & { goingCount: number })[];
  /** Ranking de quem mais frequenta (só perfis que o visitante pode ver). */
  regulars: VenueRegularView[];
  /** Amigos (quem você segue e te segue de volta) que já confirmaram presença aqui: quantos são e até 3 para mostrar. */
  friendsWent: { count: number; sample: PublicProfile[] };
}

/** Quem mais frequenta o local: check-ins por QR (peso maior) e presenças confirmadas em eventos que já começaram. */
export interface VenueRegularView {
  rank: number;
  user: PublicProfile;
  /** Idas ao local: check-ins mais presenças confirmadas. */
  visits: number;
  /** Quantas dessas foram check-ins por QR. */
  checkins: number;
}

/** QR do local para o dono: o código secreto que vai dentro do link impresso. */
export interface VenueCheckinCodeView {
  code: string;
}

export interface VenueCheckinResult {
  venueId: string;
  venueName: string;
  at: string;
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

function clipName(name: string): string {
  return Array.from(name).length > 40 ? `${Array.from(name).slice(0, 39).join('')}…` : name;
}

function summary(v: VenueRecord): VenueSummaryView {
  return { id: v.id, name: v.name, address: v.address, category: v.category, sample: v.isSample, organization: v.isOrganization === true };
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
  async mine(userId: string): Promise<{ venues: VenueSummaryView[]; managed: VenueSummaryView[]; invites: TeamInviteView[]; claims: ClaimView[] }> {
    const [ownedRows, managedRows, inviteRows] = await Promise.all([this.deps.places.listVenuesByOwner(userId), this.deps.places.listVenuesManagedBy(userId), this.deps.places.listVenueManagerInvites(userId)]);
    const venues = ownedRows.map(summary);
    const managed = managedRows.map(summary);
    const inviterIds = [...new Set(inviteRows.map((i) => i.record.invitedById))];
    const inviters = new Map((inviterIds.length > 0 ? await this.deps.users.findProfilesByIds(inviterIds) : []).map((p) => [p.userId, p]));
    const invites: TeamInviteView[] = inviteRows.map((i) => ({ venue: summary(i.venue), invitedBy: inviters.has(i.record.invitedById) ? toPublicProfile(inviters.get(i.record.invitedById) as Profile) : null, createdAt: i.record.createdAt.toISOString() }));
    const claims: ClaimView[] = [];
    for (const claim of await this.deps.claims.listByUser(userId)) {
      if (claim.status === 'APPROVED') continue;
      const venue = await this.deps.places.findVenue(claim.venueId);
      if (!venue) continue;
      claims.push({ id: claim.id, venue: summary(venue), status: claim.status, reviewNote: claim.reviewNote, createdAt: claim.createdAt.toISOString() });
    }
    return { venues, managed, invites, claims };
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
      body: decision === 'APPROVED' ? (venue.isOrganization ? 'Crie os eventos da organização: quem ligar o sininho recebe o aviso' : 'Crie os eventos do local no seu perfil') : (note as string),
      url: '/locais',
      dedupeKey: `venue-claim:${claim.id}`,
    });
    return { id: claim.id, venue: summary(venue), status: decision, reviewNote: note, createdAt: claim.createdAt.toISOString() };
  }

  async panel(userId: string, venueId: unknown): Promise<VenuePanelView> {
    const venue = await this.managedOrThrow(userId, venueId);
    const events = (await this.deps.places.listVenueEvents(venue.id)).slice(0, VENUE_EVENTS_LIMIT);
    return { venue: summary(venue), events: events.map((e) => this.eventView(e)) };
  }

  async createEvent(userId: string, venueId: unknown, input: VenueEventInput): Promise<VenueEventView> {
    const venue = await this.managedOrThrow(userId, venueId);
    const { cover, ...fields } = this.parseEvent(input);
    const id = this.deps.ids.next();
    const event: PlaceEventRecord = { id, venueId: venue.id, ...fields, imageUrl: cover.mode === 'url' ? cover.url : null, isSample: false };
    if (cover.mode === 'upload') event.imageUrl = eventCoverPath(id, this.deps.clock.now().getTime());
    await this.deps.places.createEvent(event);
    if (cover.mode === 'upload') await this.deps.places.setEventCover(id, cover.mime, cover.bytes);
    await this.announceEvent(venue, event);
    return this.eventView(event);
  }

  /** Avisa quem segue o local com o sininho ligado (menos quem administra). Falha de um aviso não atrapalha os outros. */
  private async announceEvent(venue: VenueRecord, event: PlaceEventRecord): Promise<void> {
    const followers = (await this.deps.places.listVenueNotifyFollowers(venue.id)).filter((id) => id !== venue.ownerId);
    const title = `${clipTitle(venue.name, 40)} tem evento novo`;
    const body = `${clipTitle(event.title, 60)} · ${ANNOUNCE_WHEN.format(event.startsAt).replace(',', '')}`;
    for (let i = 0; i < followers.length; i += ANNOUNCE_BATCH) {
      await Promise.all(
        followers.slice(i, i + ANNOUNCE_BATCH).map((userId) =>
          this.deps.notifier.notify({ userId, type: 'VENUE_EVENT', title, body, url: `/eventos/${event.id}`, dedupeKey: `venue-event:${event.id}` }).catch(() => undefined),
        ),
      );
    }
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
    const venue = await this.managedOrThrow(userId, venueId);
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
    const venue = await this.managedOrThrow(userId, venueId);
    if (typeof eventId !== 'string' || eventId.length > 64 || !(await this.deps.places.deleteEvent(venue.id, eventId))) throw notFound('Evento não encontrado');
    return { deleted: true };
  }

  /** Capa enviada de um evento, para o <img> (que não manda o token). */
  async eventCover(eventId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (typeof eventId !== 'string' || eventId === '' || eventId.length > 64) return undefined;
    return this.deps.places.findEventCover(eventId);
  }

  /** Código do QR do local (gera na primeira vez). Só quem administra. */
  async checkinCode(userId: string, venueId: unknown): Promise<VenueCheckinCodeView> {
    const venue = await this.ownedOrThrow(userId, venueId);
    const current = await this.deps.places.venueCheckinCode(venue.id);
    if (current) return { code: current };
    return this.renewCheckinCode(venue.id);
  }

  /** Troca o código: o QR impresso antes deixa de valer. */
  async rotateCheckinCode(userId: string, venueId: unknown): Promise<VenueCheckinCodeView> {
    const venue = await this.ownedOrThrow(userId, venueId);
    return this.renewCheckinCode(venue.id);
  }

  private async renewCheckinCode(venueId: string): Promise<VenueCheckinCodeView> {
    const code = randomBytes(18).toString('base64url');
    await this.deps.places.setVenueCheckinCode(venueId, code, this.deps.clock.now());
    return { code };
  }

  /** "Estive aqui": vale com o código atual do QR e no máximo uma vez a cada CHECKIN_COOLDOWN_HOURS por pessoa e local. */
  async checkIn(userId: string, venueId: unknown, code: unknown): Promise<VenueCheckinResult> {
    const venue = await this.venueOrThrow(venueId);
    const expected = await this.deps.places.venueCheckinCode(venue.id);
    const given = typeof code === 'string' ? Buffer.from(code.slice(0, 128)) : Buffer.alloc(0);
    const want = Buffer.from(expected ?? '');
    // Mesma resposta para código errado, antigo ou local sem QR: nada a descobrir por tentativa.
    if (!expected || given.length !== want.length || !timingSafeEqual(given, want)) throw validationError('QR code inválido ou desatualizado');
    const now = this.deps.clock.now();
    const last = await this.deps.places.lastVenueCheckin(venue.id, userId);
    const waitMs = last ? last.getTime() + CHECKIN_COOLDOWN_HOURS * 3_600_000 - now.getTime() : 0;
    if (waitMs > 0) throw rateLimited(`Você já fez check-in aqui há pouco. Tente de novo em ${CHECKIN_COOLDOWN_HOURS} horas.`, waitMs / 1000);
    await this.deps.places.addVenueCheckin({ id: this.deps.ids.next(), venueId: venue.id, userId, createdAt: now });
    return { venueId: venue.id, venueName: venue.name, at: now.toISOString() };
  }

  /** Página pública do local. Qualquer pessoa logada vê; quem administra também recebe `isOwner`. */
  async profile(viewerId: string, venueId: unknown, opts: { withVisitors?: boolean } = {}): Promise<VenueProfileView> {
    const venue = await this.venueOrThrow(venueId);
    const now = this.deps.clock.now().getTime();
    const role = await venueRoleOf(this.deps.places, viewerId, venue);
    const [following, notify, followerCount, events, rating] = await Promise.all([this.deps.places.isFollowingVenue(viewerId, venue.id), this.deps.places.isVenueNotifyOn(viewerId, venue.id), this.deps.places.countVenueFollowers(venue.id), this.deps.places.listVenueEvents(venue.id), this.deps.places.venueRating(venue.id, viewerId)]);
    const upcoming = events
      .filter((e) => e.endsAt.getTime() > now)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.id < b.id ? -1 : 1))
      .slice(0, VENUE_UPCOMING_LIMIT)
      .map((e) => this.eventView(e));
    const past = events
      .filter((e) => e.endsAt.getTime() <= now)
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || (a.id < b.id ? -1 : 1))
      .slice(0, VENUE_PAST_LIMIT);
    const pastGoing = past.length === 0 ? new Map<string, number>() : await this.deps.eventRoom.countGoing(past.map((e) => ({ source: 'PLACE' as const, id: e.id })));
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
      isOwner: role === 'OWNER',
      canManage: role !== null,
      role,
      following,
      notify: following && notify,
      organization: venue.isOrganization === true,
      followerCount,
      rating: ratingView(rating),
      upcomingEvents: upcoming,
      pastEvents: past.map((e) => ({ ...this.eventView(e), goingCount: pastGoing.get(e.id) ?? 0 })),
      ...(opts.withVisitors === false ? { regulars: [], friendsWent: { count: 0, sample: [] } } : await this.visitors(viewerId, venue.id, events, now)),
    };
  }

  /**
   * Ranking de quem mais frequenta o local: check-ins por QR (peso CHECKIN_WEIGHT) e presenças confirmadas em eventos do local que já começaram
   * (eventos do Explorar e posts de evento feitos em nome do local).
   * Perfil privado só aparece para quem já o segue; bloqueio em qualquer sentido e conta suspensa ficam de fora. Empate: ordem alfabética do nome de usuário.
   */
  private async visitors(viewerId: string, venueId: string, events: PlaceEventRecord[], now: number): Promise<{ regulars: VenueRegularView[]; friendsWent: { count: number; sample: PublicProfile[] } }> {
    const posts = await this.deps.posts.listFor([], [], { limit: 200, offset: 0 }, undefined, { venueIds: [venueId] });
    const refs: EventRef[] = [
      ...events.filter((e) => e.startsAt.getTime() <= now).map((e) => ({ source: 'PLACE' as const, id: e.id })),
      ...posts.filter((p) => p.post.venueId === venueId && p.post.eventStartsAt && p.post.eventStartsAt.getTime() <= now && p.post.archivedAt === null).map((p) => ({ source: 'USER' as const, id: p.post.id })),
    ];
    const [going, checkins] = await Promise.all([refs.length === 0 ? Promise.resolve([]) : this.deps.eventRoom.countGoingByUser(refs), this.deps.places.countVenueCheckinsByUser(venueId)]);
    const tally = new Map<string, { going: number; checkins: number }>();
    for (const c of going) tally.set(c.userId, { going: c.count, checkins: 0 });
    for (const c of checkins) tally.set(c.userId, { going: tally.get(c.userId)?.going ?? 0, checkins: c.count });
    if (tally.size === 0) return { regulars: [], friendsWent: { count: 0, sample: [] } };
    const profiles = new Map((await this.deps.users.findProfilesByIds([...tally.keys()])).map((p) => [p.userId, p] as const));
    const rows: { user: PublicProfile; visits: number; checkins: number; score: number; friend: boolean }[] = [];
    for (const [userId, t] of tally) {
      const profile = profiles.get(userId);
      if (!profile) continue;
      if (userId !== viewerId) {
        const account = await this.deps.users.findById(userId);
        if (!account || account.status !== 'ACTIVE') continue;
        if (await this.deps.blocks.existsEitherWay(viewerId, userId)) continue;
        if (profile.isPrivate && (await this.deps.follows.get(viewerId, userId))?.status !== 'ACCEPTED') continue;
      }
      const friend = userId !== viewerId && (await this.deps.follows.get(viewerId, userId))?.status === 'ACCEPTED' && (await this.deps.follows.get(userId, viewerId))?.status === 'ACCEPTED';
      rows.push({ user: toPublicProfile(profile), visits: t.going + t.checkins, checkins: t.checkins, score: t.going + t.checkins * CHECKIN_WEIGHT, friend });
    }
    rows.sort((a, b) => b.score - a.score || (a.user.username < b.user.username ? -1 : 1));
    const friends = rows.filter((r) => r.friend);
    return {
      regulars: rows.slice(0, VENUE_REGULARS_LIMIT).map((r, i) => ({ rank: i + 1, user: r.user, visits: r.visits, checkins: r.checkins })),
      friendsWent: { count: friends.length, sample: friends.slice(0, 3).map((r) => r.user) },
    };
  }

  /** Dono edita nome, endereço, categoria, descrição, horários e capa. Só o que vier muda; vazio apaga o que é opcional. */
  async updateProfile(userId: string, venueId: unknown, input: VenueProfileInput): Promise<VenueProfileView> {
    const venue = await this.managedOrThrow(userId, venueId);
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

  async follow(userId: string, venueId: unknown): Promise<{ following: true; notify: boolean; followerCount: number }> {
    const venue = await this.venueOrThrow(venueId);
    await this.deps.places.followVenue(userId, venue.id, this.deps.clock.now());
    const [notify, followerCount] = await Promise.all([this.deps.places.isVenueNotifyOn(userId, venue.id), this.deps.places.countVenueFollowers(venue.id)]);
    return { following: true, notify, followerCount };
  }

  /**
   * Sininho: liga ou desliga o aviso de cada evento novo do local. Ligar sem seguir já segue (o sininho fica ao lado
   * do botão Seguir); desligar mantém a pessoa seguindo.
   */
  async setNotify(userId: string, venueId: unknown, on: unknown): Promise<VenueBellView> {
    if (typeof on !== 'boolean') throw validationError('Dados inválidos', { notify: 'Use true ou false' });
    const venue = await this.venueOrThrow(venueId);
    if (on) await this.deps.places.followVenue(userId, venue.id, this.deps.clock.now());
    await this.deps.places.setVenueNotify(userId, venue.id, on);
    const [following, notify, followerCount] = await Promise.all([this.deps.places.isFollowingVenue(userId, venue.id), this.deps.places.isVenueNotifyOn(userId, venue.id), this.deps.places.countVenueFollowers(venue.id)]);
    return { following, notify: following && notify, followerCount };
  }

  /**
   * Pede a página de uma organização (atlética, bateria, coletivo, produtora, empresa...). A página nasce sem dono e
   * fora das buscas; um admin confere o comprovante no painel de pedidos e, ao aprovar, a pessoa passa a administrá-la.
   */
  async requestOrganization(userId: string, input: OrganizationRequestInput): Promise<ClaimView> {
    if (typeof input !== 'object' || input === null) throw validationError('Dados inválidos', { name: 'Preencha os dados da organização' });
    const name = text(input.name, ORGANIZATION_NAME_MAX, 'name', 'Nome da organização', true) as string;
    const type = text(input.type, ORGANIZATION_TYPE_MAX, 'type', 'Tipo') ?? ORGANIZATION_DEFAULT_TYPE;
    const campus = text(input.campus, ORGANIZATION_CAMPUS_MAX, 'campus', 'Onde fica', true) as string;
    const description = text(input.description, ORGANIZATION_DESCRIPTION_MAX, 'description', 'Descrição');
    const note = text(input.note, CLAIM_NOTE_MAX, 'note', 'Mensagem');
    const { lat, lng } = input;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw validationError('Dados inválidos', { location: 'Informe onde fica a organização (use a localização do aparelho no campus, na sede ou no point)' });
    }
    const pending = (await this.deps.claims.listByUser(userId)).filter((c) => c.status === 'PENDING').length;
    if (pending >= CLAIMS_PENDING_MAX) throw conflict(`Você já tem ${CLAIMS_PENDING_MAX} pedidos em análise. Espere a resposta antes de pedir outro`);
    const doc = decodeClaimDocument(input.document);
    const now = this.deps.clock.now();
    const venue: VenueRecord = { id: this.deps.ids.next(), name, address: campus, category: type, lat, lng, isSample: false, ownerId: null, description, isOrganization: true };
    await this.deps.places.createVenue(venue);
    const claim: VenueClaimRecord = { id: this.deps.ids.next(), venueId: venue.id, userId, status: 'PENDING', note, documentMime: doc.mime, reviewNote: null, reviewedBy: null, reviewedAt: null, createdAt: now };
    await this.deps.claims.create(claim, doc.bytes);
    return { id: claim.id, venue: summary(venue), status: 'PENDING', reviewNote: null, createdAt: now.toISOString() };
  }

  /**
   * Cria um local do zero (não está no AskouT nem no Google) e já pede para administrá-lo. O local nasce sem dono e
   * fora das buscas; um admin confere o documento no painel de pedidos e, ao aprovar, a pessoa passa a administrá-lo.
   */
  async requestVenue(userId: string, input: VenueRequestInput): Promise<ClaimView> {
    if (typeof input !== 'object' || input === null) throw validationError('Dados inválidos', { name: 'Preencha os dados do local' });
    const name = text(input.name, VENUE_NAME_MAX, 'name', 'Nome do local', true) as string;
    const category = text(input.category, VENUE_CATEGORY_MAX, 'category', 'Tipo');
    const address = text(input.address, VENUE_ADDRESS_MAX, 'address', 'Endereço', true) as string;
    const note = text(input.note, CLAIM_NOTE_MAX, 'note', 'Mensagem');
    const { lat, lng } = input;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw validationError('Dados inválidos', { location: 'Informe onde fica o local (use a localização do aparelho no local)' });
    }
    const pending = (await this.deps.claims.listByUser(userId)).filter((c) => c.status === 'PENDING').length;
    if (pending >= CLAIMS_PENDING_MAX) throw conflict(`Você já tem ${CLAIMS_PENDING_MAX} pedidos em análise. Espere a resposta antes de pedir outro`);
    const doc = decodeClaimDocument(input.document);
    const now = this.deps.clock.now();
    const venue: VenueRecord = { id: this.deps.ids.next(), name, address, category, lat, lng, isSample: false, ownerId: null, isUserCreated: true };
    await this.deps.places.createVenue(venue);
    const claim: VenueClaimRecord = { id: this.deps.ids.next(), venueId: venue.id, userId, status: 'PENDING', note, documentMime: doc.mime, reviewNote: null, reviewedBy: null, reviewedAt: null, createdAt: now };
    await this.deps.claims.create(claim, doc.bytes);
    return { id: claim.id, venue: summary(venue), status: 'PENDING', reviewNote: null, createdAt: now.toISOString() };
  }

  /** Avalia o local de 1 a 5 estrelas (de novo = troca a nota). Quem administra o local não avalia o próprio. */
  async rate(userId: string, venueId: unknown, stars: unknown): Promise<VenueRatingView> {
    const venue = await this.venueOrThrow(venueId);
    if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) throw validationError('Nota inválida', { stars: 'Use um número inteiro de 1 a 5' });
    if (await canManageVenue(this.deps.places, userId, venue)) throw forbidden('Você não pode avaliar o seu próprio estabelecimento');
    await this.deps.places.rateVenue(userId, venue.id, stars, this.deps.clock.now());
    return ratingView(await this.deps.places.venueRating(venue.id, userId));
  }

  async clearRating(userId: string, venueId: unknown): Promise<VenueRatingView> {
    const venue = await this.venueOrThrow(venueId);
    await this.deps.places.clearVenueRating(userId, venue.id);
    return ratingView(await this.deps.places.venueRating(venue.id, userId));
  }

  async unfollow(userId: string, venueId: unknown): Promise<{ following: false; notify: false; followerCount: number }> {
    const venue = await this.venueOrThrow(venueId);
    await this.deps.places.unfollowVenue(userId, venue.id);
    return { following: false, notify: false, followerCount: await this.deps.places.countVenueFollowers(venue.id) };
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
    // A busca de perto só traz bares e restaurantes; um lugar achado pelo nome ou endereço (casa de show, parque...)
    // é conferido direto na fonte pelo id.
    const place = found.places.find((p) => `${p.source.toLowerCase()}:${p.externalId}` === key) ?? (await this.lookupExternal(key));
    if (!place) throw notFound('Local não encontrado');
    const venue: VenueRecord = {
      id: this.deps.ids.next(),
      name: place.name.slice(0, VENUE_NAME_MAX),
      address: place.address ? place.address.slice(0, 200) : null,
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

  private async lookupExternal(key: string): Promise<ExternalPlace | undefined> {
    const [source, ...rest] = key.split(':');
    const externalId = rest.join(':');
    if (!this.deps.placeSource.lookup || !externalId) return undefined;
    const place = await this.deps.placeSource.lookup(externalId);
    return place && place.source.toLowerCase() === source && place.externalId === externalId ? place : undefined;
  }

  /** Documento de um pedido, só para admin. */
  async claimDocument(adminId: string, claimId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    const admin = await this.deps.users.findById(adminId);
    if (!admin || admin.role !== 'ADMIN') throw forbidden('Só administradores veem o documento');
    if (typeof claimId !== 'string' || claimId.length > 64) return undefined;
    return this.deps.claims.findDocument(claimId);
  }

  // ---- Equipe: só o dono convida e remove; quem aceita vira administrador adicional ----

  /** Equipe do local. O dono vê também os convites pendentes; o administrador adicional vê quem já aceitou. */
  async team(userId: string, venueId: unknown): Promise<TeamView> {
    const venue = await this.managedOrThrow(userId, venueId);
    const role = (await venueRoleOf(this.deps.places, userId, venue)) as Exclude<VenueRole, null>;
    const records = (await this.deps.places.listVenueManagers(venue.id)).filter((m) => role === 'OWNER' || m.status === 'ACCEPTED');
    const ids = [...new Set([...(venue.ownerId ? [venue.ownerId] : []), ...records.map((m) => m.userId)])];
    const profiles = new Map((await this.deps.users.findProfilesByIds(ids)).map((p) => [p.userId, p]));
    const members: TeamMemberView[] = [];
    const owner = venue.ownerId ? profiles.get(venue.ownerId) : undefined;
    if (owner) members.push({ user: toPublicProfile(owner), role: 'OWNER', status: 'ACCEPTED', since: null });
    for (const m of records) {
      const profile = profiles.get(m.userId);
      if (profile) members.push({ user: toPublicProfile(profile), role: 'MANAGER', status: m.status, since: (m.acceptedAt ?? m.createdAt).toISOString() });
    }
    return { role, members };
  }

  /** O dono convida uma pessoa pelo @usuário. A pessoa só vira administradora ao aceitar. */
  async inviteManager(ownerId: string, venueId: unknown, username: unknown): Promise<TeamView> {
    const venue = await this.ownedOrThrow(ownerId, venueId);
    const name = typeof username === 'string' ? username.trim().replace(/^@/, '').toLowerCase() : '';
    if (name === '' || name.length > 40) throw validationError('Usuário inválido', { username: 'Informe o @usuário da pessoa' });
    const profile = await this.deps.users.findProfileByUsername(name);
    const target = profile ? await this.deps.users.findById(profile.userId) : undefined;
    if (!profile || !target || target.status !== 'ACTIVE' || (await this.deps.blocks.existsEitherWay(ownerId, profile.userId))) throw notFound('Pessoa não encontrada');
    if (profile.userId === ownerId) throw conflict('Você já é o responsável por este local');
    const current = await this.deps.places.findVenueManager(venue.id, profile.userId);
    if (current?.status === 'ACCEPTED') throw conflict('Essa pessoa já está na equipe');
    if (current?.status === 'PENDING') throw conflict('Esse convite já foi enviado');
    if ((await this.deps.places.listVenueManagers(venue.id)).length >= VENUE_TEAM_MAX) throw conflict(`A equipe pode ter até ${VENUE_TEAM_MAX} administradores adicionais`);
    const now = this.deps.clock.now();
    await this.deps.places.saveVenueManager({ venueId: venue.id, userId: profile.userId, status: 'PENDING', invitedById: ownerId, createdAt: now, acceptedAt: null });
    await this.notifyTeam(profile.userId, ownerId, `Convite para administrar ${clipName(venue.name)}`, 'Toque para aceitar ou recusar. Quem administra edita o perfil, os eventos, a agenda, os posts e a chapelaria do local.', '/locais', `venue-team:${venue.id}:${profile.userId}:${now.getTime()}`);
    return this.team(ownerId, venue.id);
  }

  /** A pessoa convidada aceita ou recusa. Recusar apaga o convite. */
  async respondInvite(userId: string, venueId: unknown, accept: unknown): Promise<{ accepted: boolean }> {
    if (typeof accept !== 'boolean') throw validationError('Resposta inválida', { accept: 'Informe se aceita ou recusa' });
    const venue = await this.venueOrThrow(venueId);
    const record = await this.deps.places.findVenueManager(venue.id, userId);
    if (!record || record.status !== 'PENDING') throw notFound('Convite não encontrado');
    if (!accept) {
      await this.deps.places.deleteVenueManager(venue.id, userId);
      return { accepted: false };
    }
    await this.deps.places.saveVenueManager({ ...record, status: 'ACCEPTED', acceptedAt: this.deps.clock.now() });
    if (venue.ownerId && venue.ownerId !== userId) {
      const who = await this.deps.users.findProfilesByIds([userId]);
      await this.notifyTeam(venue.ownerId, userId, `${who[0]?.displayName ?? 'Alguém'} aceitou administrar ${clipName(venue.name)}`, 'Ela já aparece na equipe do local.', `/bares/${venue.id}`, `venue-team:${venue.id}:${userId}:accepted`);
    }
    return { accepted: true };
  }

  /** O dono tira uma pessoa da equipe (ou cancela o convite). */
  async removeManager(ownerId: string, venueId: unknown, targetId: unknown): Promise<TeamView> {
    const venue = await this.ownedOrThrow(ownerId, venueId);
    if (typeof targetId !== 'string' || targetId === '' || targetId.length > 64) throw notFound('Pessoa não encontrada na equipe');
    if (!(await this.deps.places.deleteVenueManager(venue.id, targetId))) throw notFound('Pessoa não encontrada na equipe');
    return this.team(ownerId, venue.id);
  }

  /** O administrador adicional sai da equipe por conta própria. */
  async leaveTeam(userId: string, venueId: unknown): Promise<{ left: true }> {
    const venue = await this.venueOrThrow(venueId);
    if (!(await this.deps.places.deleteVenueManager(venue.id, userId))) throw notFound('Você não está na equipe deste local');
    return { left: true };
  }

  private async notifyTeam(userId: string, actorId: string, title: string, body: string, url: string, dedupeKey: string): Promise<void> {
    try {
      await this.deps.notifier.notify({ userId, type: 'VENUE_TEAM', title, body, url, dedupeKey, actorId });
    } catch {
      // aviso que falha não derruba o convite
    }
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

  /** Dono ou administrador adicional (dia a dia do local). Quem não é recebe "não encontrado". */
  private async managedOrThrow(userId: string, venueId: unknown): Promise<VenueRecord> {
    const venue = await this.venueOrThrow(venueId);
    if (!(await canManageVenue(this.deps.places, userId, venue))) throw notFound('Local não encontrado');
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
