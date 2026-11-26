import { MIN_ACCOUNT_AGE, parseBirthDate } from './age-service.ts';
import { ActivityService } from './activity-service.ts';
import type { ActivityPage } from './activity-service.ts';
import { bioProblem, displayNameProblem, normalizeBio, normalizeDisplayName, normalizeUsername, usernameProblem } from './validation.ts';
import { buildRetentionReport } from './retention.ts';
import type { RetentionReport } from './retention.ts';
import { DomainError, conflict, forbidden, notFound, unauthorized, validationError } from './errors.ts';
import type { AuthResult, AuthService, LoginInput, MfaChallenge, SocialLoginInput } from './auth-service.ts';
import type { CoreDeps } from './ports.ts';
import { fold } from './explore-match.ts';
import { distanceMeters } from './geo.ts';
import type { VenueEventInput, VenueProfileInput, VenueService } from './venue-service.ts';
import type { PaymentsState, PaymentsSwitch } from './payments-switch.ts';
import { EVENT_EXTRA_ICONS, EventExtrasCatalog } from './event-extras.ts';
import type { EventExtraInput, EventExtraOption } from './event-extras.ts';
import { TastesCatalog } from './tastes.ts';
import type { TasteInput, TasteOption } from './tastes.ts';
import { buildExperimentReport } from './reco-experiment.ts';
import type { ExperimentReport, RecoExperiment, RecoExperimentState } from './reco-experiment.ts';
import type { Actor, AdminPlaceEventExtras, AdminPostDetail, AdminUserExtras, AdminUserStats, AdminVenueExtras, FeedPolicy, AdminFeedCommentRow, AdminFeedPlace, AdminFeedPostRow, AdminFeedReportRow, FeedPostStatus, FeedPostWithImages, FeedTarget, AdminConversationReportRow, AdminUserReportRow, AdminPlaceEventRow, AdminPostReportRow, AdminPostRow, AdminStats, AdminStoryReportRow, AdminUserRow, AdminVenueRow, AuditAction, AuditChange, AuditFilter, AuditRecord, AuditRow, Page, PageSort, ReportResolution, UserStatus, VenueRecord } from './types.ts';
import { ADMIN_SORTS, AUDIT_ACTOR_KINDS, AUDIT_TARGET_TYPES, REPORT_RESOLUTIONS } from './types.ts';

export const ADMIN_PAGE_DEFAULT = 25;
export const ADMIN_PAGE_MAX = 100;
export const ADMIN_NOTE_MAX = 300;
export const ADMIN_QUERY_MAX = 80;

/** Detalhe de um local na gestão: o cadastro, de onde veio, quem responde por ele e os eventos. */
export interface AdminVenueDetail {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  lat: number;
  lng: number;
  isSample: boolean;
  isOrganization: boolean;
  isUserCreated: boolean;
  /** De onde o local entrou: Google, OpenStreetMap, importação de agenda ou cadastro no app (`null`). */
  source: 'GOOGLE' | 'OSM' | 'IMPORT' | null;
  description: string | null;
  coverUrl: string | null;
  logoUrl: string | null;
  instagram: string | null;
  owner: { id: string; username: string; displayName: string } | null;
  followers: number;
  eventsTotal: number;
  upcomingCount: number;
  /** Próximos eventos (até 15) e os últimos que já passaram (até 5), do mais novo para o mais antigo dentro de cada grupo. */
  events: { id: string; title: string; startsAt: string; endsAt: string; kind: string; isFree: boolean; isSample: boolean; upcoming: boolean }[];
  /** O resto do cadastro e os vínculos (equipe, pedidos, contagens). */
  extra: AdminVenueExtras | null;
}

/** Detalhe de um evento de local na gestão: o cadastro, o local, quem responde por ele e quem confirmou presença. */
export interface AdminEventDetail {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  kind: string;
  isFree: boolean;
  isSample: boolean;
  imageUrl: string | null;
  tags: string[];
  ticketUrl: string | null;
  /** Já começou e ainda não acabou / já acabou. */
  status: 'UPCOMING' | 'LIVE' | 'PAST';
  venue: { id: string; name: string; address: string | null; owner: { id: string; username: string } | null };
  goingCount: number;
  /** Primeiras pessoas que confirmaram (até 20), na ordem da confirmação. */
  going: { id: string; username: string; displayName: string; avatarUrl: string | null; at: string }[];
  /** Outras datas do mesmo evento: eventos do mesmo local com o mesmo nome (sem contar este), as mais próximas primeiro. */
  sameTitle: { id: string; startsAt: string; endsAt: string; upcoming: boolean }[];
  /** Quantos eventos o local tem com o mesmo nome, contando este. */
  sameTitleTotal: number;
  /** O resto do cadastro e os vínculos (feed, chapelaria, lista, Hunter). */
  extra: AdminPlaceEventExtras | null;
}

/** Uma pessoa inteira na gestão: o que dá para editar, o resto do cadastro e os vínculos. */
export interface AdminUserDetail {
  id: string;
  email: string;
  username: string;
  displayName: string;
  bio: string | null;
  status: UserStatus;
  role: string;
  createdAt: Date;
  birthDate: string | null;
  extra: AdminUserExtras | null;
}

/** Edição de local pela gestão: os campos do perfil (como o dono) e os que só a gestão troca. */
export type AdminVenueEditInput = VenueProfileInput & { lat?: unknown; lng?: unknown; isSample?: unknown; feedPolicy?: unknown; note?: unknown };
/** Cadastro de local pela gestão: os mesmos campos da edição. Sem `lat`/`lng`, a posição sai do endereço. */
export type AdminVenueCreateInput = AdminVenueEditInput & { googlePlaceId?: unknown };

/** Tipo do Google (campo `types`, grátis) para o "Tipo" do local, na ordem de preferência. */
const GOOGLE_TYPE_LABEL: [string, string][] = [
  ['night_club', 'balada'], ['karaoke', 'karaokê'], ['wine_bar', 'bar de vinhos'], ['pub', 'pub'], ['bar_and_grill', 'bar'], ['bar', 'bar'],
  ['brewery', 'cervejaria'], ['concert_hall', 'casa de shows'], ['performing_arts_theater', 'teatro'], ['event_venue', 'casa de eventos'],
  ['dance_hall', 'casa de dança'], ['comedy_club', 'comedy club'], ['pizza_restaurant', 'pizzaria'], ['brazilian_restaurant', 'restaurante'],
  ['steak_house', 'churrascaria'], ['restaurant', 'restaurante'], ['coffee_shop', 'café'], ['cafe', 'café'], ['bakery', 'padaria'],
  ['ice_cream_shop', 'sorveteria'], ['stadium', 'estádio'], ['park', 'parque'], ['museum', 'museu'], ['movie_theater', 'cinema'], ['food', 'restaurante'],
];
export const categoryFromGoogleTypes = (types: string[]): string | null => GOOGLE_TYPE_LABEL.find(([t]) => types.includes(t))?.[1] ?? null;
const GOOGLE_PLACE_ID_RE = /^[A-Za-z0-9_-]{1,300}$/;

/** Um lugar da busca no Google do Hunter: novo, já vinculado a um local do AskouT ou com o mesmo nome ali perto. */
export interface GoogleVenueHit {
  placeId: string;
  name: string;
  address: string | null;
  category: string | null;
  lat: number;
  lng: number;
  mapsUri: string | null;
  status: 'NEW' | 'LINKED' | 'DUPLICATE';
  existing: { id: string; name: string } | null;
}

/** Uma linha da planilha de importação de locais (como veio; tudo é conferido). */
export interface AdminVenueImportRow {
  name?: unknown;
  address?: unknown;
  category?: unknown;
  description?: unknown;
  instagram?: unknown;
  imageUrl?: unknown;
  logoUrl?: unknown;
  lat?: unknown;
  lng?: unknown;
  isSample?: unknown;
}

/** Como ficou cada linha na prévia (ou na importação). */
export interface AdminVenueImportLine {
  /** Linha da planilha (a primeira de dados é a 2, depois do cabeçalho). */
  line: number;
  status: 'OK' | 'ERROR' | 'DUPLICATE' | 'CREATED';
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** De onde veio a posição: da planilha, da busca gratuita (OpenStreetMap) ou do Google. */
  located: 'SHEET' | 'FREE' | 'GOOGLE' | null;
  /** Problema por coluna. */
  problems: Record<string, string>;
  /** Local que já existe (ou linha anterior da planilha) com o mesmo nome ali perto. */
  duplicateOf: { id: string | null; name: string; line?: number } | null;
  /** Id do local criado (só na importação). */
  venueId?: string;
}

export interface AdminVenueImportResult {
  dryRun: boolean;
  lines: AdminVenueImportLine[];
  counts: { ok: number; errors: number; duplicates: number; created: number };
}

/** Linhas por importação: cada linha sem posição faz uma busca de endereço. */
export const VENUE_IMPORT_MAX_ROWS = 200;
/** Mesmo nome a menos disto é o mesmo local. */
const VENUE_DUPLICATE_RADIUS_M = 250;

/** Nome comparável: sem acento, maiúscula, pontuação e espaços. */
const venueNameKey = (name: string) => fold(name).replace(/[^a-z0-9]/g, '');

/** Edição de evento de local pela gestão: os campos de quem administra e os que só a gestão troca. */
export type AdminEventEditInput = VenueEventInput & { isSample?: unknown; feedPolicy?: unknown; note?: unknown };

const FEED_POLICIES: readonly FeedPolicy[] = ['OPEN', 'MODERATED', 'OWNER_ONLY'];

function feedPolicyOf(value: unknown, current: FeedPolicy): FeedPolicy {
  if (value === undefined) return current;
  if (typeof value !== 'string' || !(FEED_POLICIES as readonly string[]).includes(value)) throw validationError('Dados inválidos', { feedPolicy: 'Use OPEN, MODERATED ou OWNER_ONLY' });
  return value as FeedPolicy;
}

function flagOf(value: unknown, current: boolean, field: string): boolean {
  if (value === undefined) return current;
  if (typeof value !== 'boolean') throw validationError('Dados inválidos', { [field]: 'Use sim ou não' });
  return value;
}

function coordOf(value: unknown, current: number, field: 'lat' | 'lng'): number {
  if (value === undefined) return current;
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  const max = field === 'lat' ? 90 : 180;
  if (!Number.isFinite(n) || Math.abs(n) > max) throw validationError('Dados inválidos', { [field]: field === 'lat' ? 'Latitude entre -90 e 90' : 'Longitude entre -180 e 180' });
  return n;
}

/** Valor de um campo como a auditoria guarda (texto, até 500 caracteres; nulo quando vazio). */
function auditValue(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (Array.isArray(v)) return v.length ? v.join(', ').slice(0, 500) : null;
  return String(v).slice(0, 500);
}

/** Cada campo que mudou, com o valor de antes e o de depois (inteiros, para a auditoria). */
function diffOf(labels: Record<string, string>, before: Record<string, unknown>, after: Record<string, unknown>): AuditChange[] {
  const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : JSON.stringify(a ?? null) === JSON.stringify(b ?? null));
  return Object.entries(labels).filter(([k]) => !same(before[k], after[k])).map(([k, field]) => ({ field, before: auditValue(before[k]), after: auditValue(after[k]) }));
}

/** "campo: antes → depois" de cada campo que mudou, para o resumo da auditoria. */
function changesText(changes: AuditChange[]): string[] {
  const show = (v: string | null) => (v === null ? '(vazio)' : v.slice(0, 60));
  return changes.map((c) => `${c.field}: ${show(c.before)} → ${show(c.after)}`);
}

/** Trecho curto de um texto, para identificar o que foi apagado. */
function snippet(text: string | null | undefined, max = 80): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return Array.from(t).length > max ? `${Array.from(t).slice(0, max - 1).join('')}…` : t;
}

/** Filtros da auditoria vindos da URL. */
function auditFilterOf(query: AuditQuery): AuditFilter {
  const pick = <T extends string>(v: unknown, allowed: readonly T[], field: string): T | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw validationError('Filtro inválido', { [field]: 'Valor inválido' });
    return v as T;
  };
  const id = (v: unknown, field: string): string | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string' || v.length > 64) throw validationError('Filtro inválido', { [field]: 'Valor inválido' });
    return v;
  };
  const day = (v: unknown, field: string, end: boolean): Date | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw validationError('Filtro inválido', { [field]: 'Use AAAA-MM-DD' });
    const d = new Date(`${v}T00:00:00-03:00`);
    if (Number.isNaN(d.getTime())) throw validationError('Filtro inválido', { [field]: 'Data inválida' });
    return end ? new Date(d.getTime() + 24 * 3600 * 1000) : d;
  };
  const text = queryText(query.q);
  const action = id(query.action, 'action') as AuditAction | undefined;
  const actorKind = pick(query.actorKind, AUDIT_ACTOR_KINDS, 'actorKind');
  const targetType = pick(query.targetType, AUDIT_TARGET_TYPES, 'targetType');
  const actorId = id(query.actorId, 'actorId');
  const targetId = id(query.targetId, 'targetId');
  const from = day(query.from, 'from', false);
  const to = day(query.to, 'to', true);
  return { ...(action ? { action } : {}), ...(actorKind ? { actorKind } : {}), ...(targetType ? { targetType } : {}), ...(actorId ? { actorId } : {}), ...(targetId ? { targetId } : {}), ...(text ? { text } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

/** Linha da lista de eventos de locais, com quantas pessoas confirmaram presença. */
export type AdminPlaceEventListRow = AdminPlaceEventRow & { goingCount: number };

export interface AdminPage<T> {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
  /** Quantos registros a lista tem com o mesmo filtro (a gestão mostra embaixo da tabela). */
  total: number;
}

function parsePage(query: { limit?: unknown; offset?: unknown }): Page {
  const num = (v: unknown, fallback: number) => (typeof v === 'string' && /^\d{1,6}$/.test(v) ? Number(v) : typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback);
  return { limit: Math.min(Math.max(num(query.limit, ADMIN_PAGE_DEFAULT), 1), ADMIN_PAGE_MAX), offset: num(query.offset, 0) };
}

/** `sort` (uma das colunas da lista) e `dir` (`asc`/`desc`, padrão `asc`). Sem `sort`, a lista usa a ordem de sempre. */
export function parseSort(query: { sort?: unknown; dir?: unknown }, keys: readonly string[]): PageSort | undefined {
  if (query.sort === undefined || query.sort === null || query.sort === '') return undefined;
  if (typeof query.sort !== 'string' || !keys.includes(query.sort)) throw validationError('Ordenação inválida', { sort: `Use uma destas: ${keys.join(', ')}` });
  if (query.dir !== undefined && query.dir !== 'asc' && query.dir !== 'desc') throw validationError('Ordenação inválida', { dir: 'Use asc ou desc' });
  return { key: query.sort, dir: query.dir === 'desc' ? 'desc' : 'asc' };
}

type ListQuery = { limit?: unknown; offset?: unknown; sort?: unknown; dir?: unknown };
type AuditQuery = ListQuery & { q?: unknown; action?: unknown; actorKind?: unknown; targetType?: unknown; actorId?: unknown; targetId?: unknown; from?: unknown; to?: unknown };
type AuditExtra = { targetLabel?: string | null; changes?: AuditChange[] | null };

function queryText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw validationError('Busca inválida', { q: 'Busca inválida' });
  const t = value.trim();
  if (Array.from(t).length > ADMIN_QUERY_MAX) throw validationError('Busca inválida', { q: `Use até ${ADMIN_QUERY_MAX} caracteres` });
  return t;
}

function noteText(value: unknown, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw validationError('Dados inválidos', { note: 'Explique o motivo' });
    return null;
  }
  if (typeof value !== 'string') throw validationError('Dados inválidos', { note: 'Motivo inválido' });
  const t = value.trim();
  if (t === '') {
    if (required) throw validationError('Dados inválidos', { note: 'Explique o motivo' });
    return null;
  }
  if (Array.from(t).length > ADMIN_NOTE_MAX) throw validationError('Dados inválidos', { note: `O motivo pode ter até ${ADMIN_NOTE_MAX} caracteres` });
  return t;
}

/** Gestão do aplicativo. Todo método exige papel ADMIN (vindo do banco a cada requisição) e as ações ficam no registro de auditoria. */
/** Teto de linhas lidas por consulta do painel. Acima disso, o painel avisa que cortou os dados mais antigos. */
export const RETENTION_MAX_ROWS = 200_000;

const STATUS_LABEL: Record<UserStatus, string> = { ACTIVE: 'ativa', SUSPENDED: 'suspensa', DELETION_REQUESTED: 'exclusão pedida' };
const EXTRA_FIELDS = { label: 'nome', icon: 'ícone', type: 'tipo' };
const TASTE_FIELDS = { label: 'nome', icon: 'ícone', hint: 'dica', keywords: 'palavras-chave', kinds: 'tipos de evento' };

export class AdminService {
  private readonly deps: CoreDeps;
  private readonly venues: VenueService;
  private readonly auth: AuthService;
  private readonly paymentsSwitch: PaymentsSwitch;
  private readonly recoExperiment: RecoExperiment;

  constructor(deps: CoreDeps, venues: VenueService, auth: AuthService, paymentsSwitch: PaymentsSwitch, recoExperiment: RecoExperiment) {
    this.recoExperiment = recoExperiment;
    this.deps = deps;
    this.venues = venues;
    this.auth = auth;
    this.paymentsSwitch = paymentsSwitch;
  }

  /**
   * Entrada do painel. Mesma senha da conta, mas só entra quem é admin; para os demais a resposta é a mesma de
   * senha errada, sem revelar que a conta existe ou que não é admin.
   */
  async login(input: LoginInput): Promise<AuthResult | MfaChallenge> {
    const result = await this.auth.login(input, { requireRole: 'ADMIN' });
    if ('mfaRequired' in result) return result;
    if (result.user.role !== 'ADMIN') throw unauthorized();
    await this.logLogin(result.user.id, 'senha');
    return result;
  }

  /** Segunda etapa da entrada no painel (conta com verificação em duas etapas). */
  async verifyMfaLogin(input: { mfaToken: unknown; code: unknown }): Promise<AuthResult> {
    const result = await this.auth.verifyMfaLogin(input, { requireRole: 'ADMIN' });
    await this.logLogin(result.user.id, 'senha + verificação em duas etapas');
    return result;
  }

  /**
   * Entrada do painel pela plataforma (Apple). Nunca cria conta: nome de usuário e aceite do cadastro não são repassados,
   * então conta externa nova para em `needsProfile` e é recusada. Quem não é admin também não entra.
   */
  async socialLogin(input: Pick<SocialLoginInput, 'provider' | 'idToken'>): Promise<AuthResult | MfaChallenge> {
    const result = await this.auth.socialLogin({ provider: input.provider, idToken: input.idToken }, { requireRole: 'ADMIN' });
    if ('mfaRequired' in result) return result;
    if ('needsProfile' in result || result.user.role !== 'ADMIN') throw unauthorized('Essa conta não tem acesso à gestão');
    await this.logLogin(result.user.id, input.provider === 'APPLE' ? 'Apple' : String(input.provider));
    return result;
  }

  /** Troca a própria senha pelo painel. */
  async changeOwnPassword(actor: Actor, input: { currentPassword: unknown; newPassword: unknown }): Promise<{ token: string }> {
    this.assertAdmin(actor);
    const result = await this.auth.changePassword(actor.userId, input);
    await this.log(actor.userId, 'ADMIN_PASSWORD_CHANGED', 'USER', actor.userId, null, { targetLabel: await this.userLabel(actor.userId) });
    return result;
  }

  private async logLogin(userId: string, how: string): Promise<void> {
    await this.log(userId, 'ADMIN_LOGIN', 'USER', userId, `Entrou na gestão (${how})`, { targetLabel: await this.userLabel(userId) });
  }

  /** "@usuário" de uma conta, para o nome do alvo na auditoria. */
  private async userLabel(userId: string): Promise<string | null> {
    const profile = await this.deps.users.findProfileById(userId);
    return profile ? `@${profile.username}` : null;
  }

  private assertAdmin(actor: Actor): void {
    if (actor.role !== 'ADMIN') throw forbidden('Acesso restrito a administradores');
  }

  private async log(adminId: string, action: AuditAction, targetType: AuditRecord['targetType'], targetId: string, note: string | null, extra: AuditExtra = {}): Promise<void> {
    await this.deps.admin.addAudit({
      id: this.deps.ids.next(), adminId, actorKind: 'ADMIN', action, targetType, targetId, note, createdAt: this.deps.clock.now(),
      targetLabel: extra.targetLabel ?? null, changes: extra.changes && extra.changes.length > 0 ? extra.changes : null,
    });
  }

  private async paged<T>(query: ListQuery, fetch: (page: Page) => Promise<T[]>, count: () => Promise<number>, sortKeys: readonly string[] = []): Promise<AdminPage<T>> {
    const page = parsePage(query);
    const sort = parseSort(query, sortKeys);
    const [rows, total] = await Promise.all([fetch({ limit: page.limit + 1, offset: page.offset, ...(sort ? { sort } : {}) }), count()]);
    return { items: rows.slice(0, page.limit), limit: page.limit, offset: page.offset, hasMore: rows.length > page.limit, total };
  }

  async stats(actor: Actor): Promise<AdminStats> {
    this.assertAdmin(actor);
    const [base, openFeedReports, pendingFeedPosts] = await Promise.all([this.deps.admin.stats(), this.deps.feed.countOpenReports(), this.deps.feed.countAllPosts('PENDING')]);
    return { ...base, openFeedReports, pendingFeedPosts };
  }

  /** Painel de retenção: bloco "Para você" contra o feed, e quem volta depois de um dia com atividade. */
  async retention(actor: Actor, query: { days?: unknown }): Promise<RetentionReport & { experiment: ExperimentReport | null }> {
    this.assertAdmin(actor);
    const days = query.days === undefined ? 14 : Number(query.days);
    if (!Number.isInteger(days) || days < 1 || days > 60) throw validationError('Período inválido', { days: 'Entre 1 e 60 dias' });
    const now = this.deps.clock.now();
    // Margem de um dia por causa do fuso; o corte exato é feito na montagem.
    const rows = await this.deps.dwell.listAllSince(new Date(now.getTime() - (days + 1) * 86_400_000), RETENTION_MAX_ROWS + 1);
    const truncated = rows.length > RETENTION_MAX_ROWS;
    const used = truncated ? rows.slice(0, RETENTION_MAX_ROWS) : rows;
    const config = await this.recoExperiment.config();
    return { ...buildRetentionReport(used, now, days, truncated), experiment: config ? buildExperimentReport(used, now, config) : null };
  }

  // ---------- Pedidos de donos ----------

  async listClaims(actor: Actor, query: { status?: unknown; limit?: unknown }) {
    this.assertAdmin(actor);
    const status = query.status === 'APPROVED' || query.status === 'REJECTED' ? query.status : 'PENDING';
    const claims = await this.deps.claims.listByStatus(status, parsePage({ limit: query.limit }).limit);
    const out = [];
    for (const c of claims) {
      const venue = await this.deps.places.findVenue(c.venueId);
      const profile = await this.deps.users.findProfileById(c.userId);
      const user = await this.deps.users.findById(c.userId);
      if (!venue || !profile) continue;
      out.push({
        id: c.id, status: c.status, note: c.note, documentMime: c.documentMime, reviewNote: c.reviewNote, createdAt: c.createdAt, reviewedAt: c.reviewedAt,
        venue: { id: venue.id, name: venue.name, address: venue.address, isSample: venue.isSample, ownerId: venue.ownerId ?? null, isOrganization: venue.isOrganization === true, isUserCreated: venue.isUserCreated === true, category: venue.category, description: venue.description ?? null },
        user: { id: c.userId, username: profile.username, displayName: profile.displayName, email: user?.email ?? '' },
      });
    }
    return out;
  }

  async claimDocument(actor: Actor, claimId: unknown) {
    this.assertAdmin(actor);
    const doc = await this.venues.claimDocument(actor.userId, claimId);
    // Documento pessoal de quem pediu: cada vez que alguém da gestão abre, fica registrado.
    if (doc && typeof claimId === 'string') {
      const claim = await this.deps.claims.findById(claimId);
      const venue = claim ? await this.deps.places.findVenue(claim.venueId) : undefined;
      await this.log(actor.userId, 'CLAIM_DOCUMENT_VIEWED', 'CLAIM', claimId, null, { targetLabel: venue?.name ?? null });
    }
    return doc;
  }

  async reviewClaim(actor: Actor, claimId: unknown, decision: unknown, note: unknown) {
    this.assertAdmin(actor);
    const result = await this.venues.reviewClaim(actor.userId, claimId, decision, note);
    await this.log(actor.userId, result.status === 'APPROVED' ? 'CLAIM_APPROVED' : 'CLAIM_REJECTED', 'CLAIM', result.id, result.reviewNote, {
      targetLabel: result.venue.name, changes: [{ field: 'situação', before: 'em análise', after: result.status === 'APPROVED' ? 'aprovado' : 'recusado' }],
    });
    return result;
  }

  // ---------- Pessoas ----------

  async searchUsers(actor: Actor, query: ListQuery & { q?: unknown; status?: unknown }): Promise<AdminPage<AdminUserRow>> {
    this.assertAdmin(actor);
    const status: UserStatus | undefined = query.status === 'ACTIVE' || query.status === 'SUSPENDED' || query.status === 'DELETION_REQUESTED' ? query.status : undefined;
    const text = queryText(query.q);
    return this.paged(query, (page) => this.deps.admin.searchUsers(text, status, page), () => this.deps.admin.countList('USERS', { text, ...(status ? { status } : {}) }), ADMIN_SORTS.users);
  }

  /** Suspende (banir) ou reativa. Admins e a própria conta não podem ser suspensos. */
  async setUserStatus(actor: Actor, userId: unknown, status: unknown, note: unknown): Promise<{ id: string; status: UserStatus }> {
    this.assertAdmin(actor);
    if (status !== 'ACTIVE' && status !== 'SUSPENDED') throw validationError('Status inválido', { status: 'Use ACTIVE ou SUSPENDED' });
    const target = typeof userId === 'string' && userId.length <= 64 ? await this.deps.users.findById(userId) : undefined;
    if (!target) throw notFound('Usuário não encontrado');
    if (target.id === actor.userId) throw conflict('Você não pode suspender a própria conta');
    if (target.role === 'ADMIN') throw conflict('Contas de administrador não podem ser suspensas por aqui');
    const reason = noteText(note, status === 'SUSPENDED');
    if (target.status === status) throw conflict(status === 'SUSPENDED' ? 'A conta já está suspensa' : 'A conta já está ativa');
    if (!(await this.deps.admin.setUserStatus(target.id, status))) throw notFound('Usuário não encontrado');
    await this.log(actor.userId, status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED', 'USER', target.id, reason, {
      targetLabel: await this.userLabel(target.id), changes: [{ field: 'situação', before: STATUS_LABEL[target.status], after: STATUS_LABEL[status] }],
    });
    return { id: target.id, status };
  }

  /**
   * Corrige a data de nascimento de uma pessoa (erro de digitação que a pessoa (conta antiga marcada como menor) não pode consertar sozinha).
   * Motivo obrigatório; a data antiga e a nova ficam na auditoria. Contas de administrador não passam por aqui.
   */
  async setUserBirthDate(actor: Actor, userId: unknown, birthDate: unknown, note: unknown): Promise<{ id: string; birthDate: string }> {
    this.assertAdmin(actor);
    const target = typeof userId === 'string' && userId.length <= 64 ? await this.deps.users.findById(userId) : undefined;
    if (!target) throw notFound('Usuário não encontrado');
    if (target.role === 'ADMIN') throw conflict('Contas de administrador não passam por aqui');
    const parsed = parseBirthDate(birthDate, this.deps.clock.now());
    if (parsed.age < MIN_ACCOUNT_AGE) throw validationError(`O AskouT é para quem tem ${MIN_ACCOUNT_AGE} anos ou mais`, { birthDate: `O AskouT é para quem tem ${MIN_ACCOUNT_AGE} anos ou mais` });
    const reason = noteText(note, true);
    const before = target.birthDate ?? null;
    if (before === parsed.birthDate) throw conflict('Essa já é a data cadastrada');
    await this.deps.users.updateBirthDate(target.id, parsed.birthDate);
    await this.log(actor.userId, 'USER_BIRTHDATE_CHANGED', 'USER', target.id, `${reason ?? ''} (de ${before ?? 'sem data'} para ${parsed.birthDate})`.slice(0, 400), {
      targetLabel: await this.userLabel(target.id), changes: [{ field: 'data de nascimento', before, after: parsed.birthDate }],
    });
    return { id: target.id, birthDate: parsed.birthDate };
  }

  /**
   * Desliga a verificação em duas etapas de uma conta (ex.: a pessoa perdeu o celular e os códigos de recuperação), inclusive
   * a de quem está logado. Apaga o segredo e os códigos de recuperação; o próximo login volta a ser só senha (ou Google/Apple).
   * As sessões abertas continuam: elas já passaram pela verificação, e desligar não dá acesso a mais ninguém (conta invadida
   * se resolve suspendendo). Na conta de outra pessoa o motivo é obrigatório; tudo fica na auditoria.
   */
  async disableUserMfa(actor: Actor, userId: unknown, note: unknown): Promise<{ id: string; mfaEnabled: false }> {
    this.assertAdmin(actor);
    const target = typeof userId === 'string' && userId.length <= 64 ? await this.deps.users.findById(userId) : undefined;
    if (!target) throw notFound('Usuário não encontrado');
    const own = target.id === actor.userId;
    const reason = noteText(note, !own);
    const record = await this.deps.mfa.find(target.id);
    if (!record?.enabledAt) throw conflict('A verificação em duas etapas já está desligada nessa conta');
    await this.deps.mfa.delete(target.id);
    await this.log(actor.userId, 'MFA_DISABLED_BY_ADMIN', 'USER', target.id, reason ?? (own ? 'Desligou na própria conta' : null), {
      targetLabel: await this.userLabel(target.id),
      changes: [
        { field: 'verificação em duas etapas', before: 'ligada', after: 'desligada' },
        { field: 'códigos de recuperação', before: String(record.recoveryCodeHashes.length), after: '0' },
      ],
    });
    return { id: target.id, mfaEnabled: false };
  }

  /** Uma pessoa inteira: o que a gestão pode editar, o resto do cadastro e os vínculos (amigos, seguidores, eventos, posts, locais). */
  async userDetail(actor: Actor, userId: unknown): Promise<AdminUserDetail> {
    this.assertAdmin(actor);
    const target = typeof userId === 'string' && userId.length <= 64 ? await this.deps.users.findById(userId) : undefined;
    const profile = target ? await this.deps.users.findProfileById(target.id) : undefined;
    if (!target || !profile) throw notFound('Usuário não encontrado');
    const extra = (await this.deps.admin.userExtras(target.id)) ?? null;
    return {
      id: target.id, email: target.email, username: profile.username, displayName: profile.displayName, bio: profile.bio, status: target.status, role: target.role,
      createdAt: target.createdAt, birthDate: target.birthDate ?? null, extra,
    };
  }

  /**
   * Corrige nome, @usuário e biografia de uma pessoa (ex.: nome ofensivo, @ de outra marca). Motivo obrigatório; o que mudou
   * (de → para) fica na auditoria. Contas de administrador não passam por aqui.
   */
  async editUser(actor: Actor, userId: unknown, input: { displayName?: unknown; username?: unknown; bio?: unknown; note?: unknown }): Promise<{ id: string; username: string; displayName: string; bio: string | null }> {
    this.assertAdmin(actor);
    const target = typeof userId === 'string' && userId.length <= 64 ? await this.deps.users.findById(userId) : undefined;
    const current = target ? await this.deps.users.findProfileById(target.id) : undefined;
    if (!target || !current) throw notFound('Usuário não encontrado');
    if (target.role === 'ADMIN') throw conflict('Contas de administrador não passam por aqui');
    const reason = noteText(input.note, true);
    const problems: Record<string, string> = {};
    const next = { ...current };
    if (input.displayName !== undefined) {
      if (typeof input.displayName !== 'string') problems['displayName'] = 'Informe um nome';
      else {
        next.displayName = normalizeDisplayName(input.displayName);
        const p = displayNameProblem(next.displayName);
        if (p) problems['displayName'] = p;
      }
    }
    if (input.bio !== undefined) {
      if (input.bio !== null && typeof input.bio !== 'string') problems['bio'] = 'Biografia inválida';
      else {
        next.bio = normalizeBio(input.bio as string | null);
        const p = bioProblem(next.bio);
        if (p) problems['bio'] = p;
      }
    }
    if (input.username !== undefined) {
      if (typeof input.username !== 'string') problems['username'] = 'Informe o @usuário';
      else {
        next.username = normalizeUsername(input.username);
        const p = usernameProblem(next.username);
        if (p) problems['username'] = p;
        else if (next.username !== current.username) {
          const taken = await this.deps.users.findProfileByUsername(next.username);
          if (taken && taken.userId !== current.userId) problems['username'] = 'Esse @usuário já está em uso';
        }
      }
    }
    if (Object.keys(problems).length > 0) throw validationError('Dados inválidos', problems);
    const changes = [
      next.displayName !== current.displayName ? `nome: "${current.displayName}" → "${next.displayName}"` : null,
      next.username !== current.username ? `@${current.username} → @${next.username}` : null,
      next.bio !== current.bio ? 'biografia alterada' : null,
    ].filter((c): c is string => c !== null);
    if (changes.length === 0) throw conflict('Nada mudou');
    if (next.username !== current.username) await this.deps.users.updateUsername(current.userId, next.username);
    await this.deps.users.updateProfile(next);
    await this.log(actor.userId, 'USER_PROFILE_EDITED', 'USER', target.id, (reason ? `${reason} (${changes.join('; ')})` : changes.join('; ')).slice(0, 400), {
      targetLabel: `@${current.username}`,
      changes: diffOf({ displayName: 'nome', username: '@usuário', bio: 'biografia' }, { ...current }, { ...next }),
    });
    return { id: target.id, username: next.username, displayName: next.displayName, bio: next.bio };
  }

  /** O @ está livre para esta pessoa (o dela mesma conta como livre)? Para o formulário avisar antes de salvar. */
  async usernameAvailableFor(actor: Actor, userId: unknown, raw: unknown): Promise<{ username: string; available: boolean; problem?: string }> {
    this.assertAdmin(actor);
    const target = typeof userId === 'string' && userId.length <= 64 ? await this.deps.users.findById(userId) : undefined;
    if (!target) throw notFound('Usuário não encontrado');
    const username = normalizeUsername(typeof raw === 'string' ? raw : '');
    const problem = usernameProblem(username);
    if (problem) return { username, available: false, problem };
    const taken = await this.deps.users.findProfileByUsername(username);
    if (taken && taken.userId !== target.id) return { username, available: false, problem: 'Esse @usuário já está em uso' };
    return { username, available: true };
  }

  /**
   * Números da pessoa para moderar e gerenciar: último sinal de uso, frequência, vínculos, eventos, NOW, mensagens
   * (só quantas), denúncias, bloqueios, suspensões e compras. Nunca o conteúdo das conversas.
   */
  async userStats(actor: Actor, userId: unknown): Promise<AdminUserStats> {
    this.assertAdmin(actor);
    const target = typeof userId === 'string' && userId.length <= 64 ? await this.deps.users.findById(userId) : undefined;
    if (!target) throw notFound('Usuário não encontrado');
    const stats = await this.deps.admin.userStats(target.id, target.createdAt, this.deps.clock.now());
    if (!stats) throw notFound('Usuário não encontrado');
    return stats;
  }

  /** O registro de atividade de uma pessoa (curtidas, comentários, posts, eventos, quem seguiu), como ela vê no app. */
  async userActivity(actor: Actor, userId: unknown, query: { kind?: unknown; cursor?: unknown }): Promise<ActivityPage> {
    this.assertAdmin(actor);
    const target = typeof userId === 'string' && userId.length <= 64 ? await this.deps.users.findById(userId) : undefined;
    if (!target) throw notFound('Usuário não encontrado');
    return new ActivityService(this.deps).list(target.id, {
      ...(typeof query.kind === 'string' && query.kind !== '' ? { kind: query.kind } : {}),
      ...(typeof query.cursor === 'string' && query.cursor !== '' ? { cursor: query.cursor } : {}),
      limit: 30,
    });
  }

  // ---------- Pagamentos (chave geral do impulsionamento) ----------

  async payments(actor: Actor): Promise<PaymentsState> {
    this.assertAdmin(actor);
    return this.paymentsSwitch.state();
  }

  /**
   * Liga ou desliga o impulsionamento pago, na hora. Ligar só é possível com um provedor de pagamento configurado no servidor.
   * Desligar não derruba anúncios já pagos nem pagamentos em andamento; só bloqueia pedidos novos.
   */
  async setPayments(actor: Actor, enabled: unknown, note: unknown): Promise<PaymentsState> {
    this.assertAdmin(actor);
    if (typeof enabled !== 'boolean') throw validationError('Dados inválidos', { enabled: 'Use true ou false' });
    const reason = noteText(note, false);
    const before = await this.paymentsSwitch.state();
    if (enabled && !before.canEnable) throw conflict(before.blocker ?? 'Não é possível ligar o pagamento agora');
    if (before.enabled === enabled) throw conflict(enabled ? 'O pagamento já está ligado' : 'O pagamento já está desligado');
    await this.paymentsSwitch.set(enabled, actor.userId);
    await this.log(actor.userId, enabled ? 'PAYMENTS_ENABLED' : 'PAYMENTS_DISABLED', 'SETTING', 'payments', reason, {
      targetLabel: 'Pagamento do impulsionamento', changes: [{ field: 'ligado', before: auditValue(before.enabled), after: auditValue(enabled) }],
    });
    return this.paymentsSwitch.state();
  }

  /** Escolhe quais pacotes de dias ficam à venda (o preço de cada um nas lojas é definido no App Store Connect e no Play Console). */
  async setBoostDays(actor: Actor, days: unknown, note: unknown): Promise<PaymentsState> {
    this.assertAdmin(actor);
    const reason = noteText(note, false);
    const before = await this.paymentsSwitch.offeredDays();
    const chosen = await this.paymentsSwitch.setOfferedDays(days, actor.userId);
    await this.log(actor.userId, 'BOOST_PACKAGES_UPDATED', 'SETTING', 'boost.days', reason ? `${chosen.join(', ')} dias. ${reason}` : `${chosen.join(', ')} dias`, {
      targetLabel: 'Pacotes de impulsionamento', changes: diffOf({ days: 'dias à venda' }, { days: before }, { days: chosen }),
    });
    return this.paymentsSwitch.state();
  }

  // ---------- Configurações de evento ("Pode fumar?", "Estacionamento"...) ----------

  private get eventExtrasCatalog(): EventExtrasCatalog {
    return new EventExtrasCatalog(this.deps);
  }

  async eventExtras(actor: Actor): Promise<{ items: EventExtraOption[]; icons: readonly string[] }> {
    this.assertAdmin(actor);
    return { items: await this.eventExtrasCatalog.list(), icons: EVENT_EXTRA_ICONS };
  }

  async createEventExtra(actor: Actor, input: EventExtraInput): Promise<{ items: EventExtraOption[] }> {
    this.assertAdmin(actor);
    const { option, items } = await this.eventExtrasCatalog.create(input, actor.userId);
    await this.log(actor.userId, 'EVENT_EXTRA_CREATED', 'SETTING', option.id, `${option.label} (${option.type === 'YES_NO' ? 'sim/não' : 'texto'})`, {
      targetLabel: option.label, changes: diffOf(EXTRA_FIELDS, {}, { ...option }),
    });
    return { items };
  }

  async updateEventExtra(actor: Actor, id: unknown, input: EventExtraInput): Promise<{ items: EventExtraOption[] }> {
    this.assertAdmin(actor);
    const { before, option, items } = await this.eventExtrasCatalog.update(id, input, actor.userId);
    const note = before.label === option.label ? option.label : `${before.label} → ${option.label}`;
    await this.log(actor.userId, 'EVENT_EXTRA_UPDATED', 'SETTING', option.id, note.slice(0, 300), { targetLabel: option.label, changes: diffOf(EXTRA_FIELDS, { ...before }, { ...option }) });
    return { items };
  }

  async moveEventExtra(actor: Actor, id: unknown, direction: unknown): Promise<{ items: EventExtraOption[] }> {
    this.assertAdmin(actor);
    const before = (await this.eventExtrasCatalog.list()).findIndex((o) => o.id === id);
    const { option, items } = await this.eventExtrasCatalog.move(id, direction, actor.userId);
    const after = items.findIndex((o) => o.id === option.id);
    if (after !== before) {
      await this.log(actor.userId, 'EVENT_EXTRA_MOVED', 'SETTING', option.id, direction === 'up' ? 'Subiu na lista' : 'Desceu na lista', {
        targetLabel: option.label, changes: [{ field: 'posição', before: String(before + 1), after: String(after + 1) }],
      });
    }
    return { items };
  }

  async deleteEventExtra(actor: Actor, id: unknown): Promise<{ items: EventExtraOption[] }> {
    this.assertAdmin(actor);
    const { option, items } = await this.eventExtrasCatalog.remove(id, actor.userId);
    await this.log(actor.userId, 'EVENT_EXTRA_REMOVED', 'SETTING', option.id, option.label, { targetLabel: option.label, changes: diffOf(EXTRA_FIELDS, { ...option }, {}) });
    return { items };
  }

  // ---------- Gostos de rolê (Bares, Baladas, Shows...) ----------

  private get tastesCatalog(): TastesCatalog {
    return new TastesCatalog(this.deps);
  }

  async tastes(actor: Actor): Promise<{ items: TasteOption[] }> {
    this.assertAdmin(actor);
    return { items: await this.tastesCatalog.list() };
  }

  async createTaste(actor: Actor, input: TasteInput): Promise<{ items: TasteOption[] }> {
    this.assertAdmin(actor);
    const { taste, items } = await this.tastesCatalog.create(input, actor.userId);
    await this.log(actor.userId, 'TASTE_CREATED', 'SETTING', taste.id, taste.label, { targetLabel: taste.label, changes: diffOf(TASTE_FIELDS, {}, { ...taste }) });
    return { items };
  }

  async updateTaste(actor: Actor, id: unknown, input: TasteInput): Promise<{ items: TasteOption[] }> {
    this.assertAdmin(actor);
    const { before, taste, items } = await this.tastesCatalog.update(id, input, actor.userId);
    const note = before.label === taste.label ? taste.label : `${before.label} → ${taste.label}`;
    await this.log(actor.userId, 'TASTE_UPDATED', 'SETTING', taste.id, note.slice(0, 300), { targetLabel: taste.label, changes: diffOf(TASTE_FIELDS, { ...before }, { ...taste }) });
    return { items };
  }

  async moveTaste(actor: Actor, id: unknown, direction: unknown): Promise<{ items: TasteOption[] }> {
    this.assertAdmin(actor);
    const before = (await this.tastesCatalog.list()).findIndex((o) => o.id === id);
    const { taste, items } = await this.tastesCatalog.move(id, direction, actor.userId);
    const after = items.findIndex((o) => o.id === taste.id);
    if (after !== before) {
      await this.log(actor.userId, 'TASTE_MOVED', 'SETTING', taste.id, direction === 'up' ? 'Subiu na lista' : 'Desceu na lista', {
        targetLabel: taste.label, changes: [{ field: 'posição', before: String(before + 1), after: String(after + 1) }],
      });
    }
    return { items };
  }

  async deleteTaste(actor: Actor, id: unknown): Promise<{ items: TasteOption[] }> {
    this.assertAdmin(actor);
    const { taste, items } = await this.tastesCatalog.remove(id, actor.userId);
    await this.log(actor.userId, 'TASTE_REMOVED', 'SETTING', taste.id, taste.label, { targetLabel: taste.label, changes: diffOf(TASTE_FIELDS, { ...taste }, {}) });
    return { items };
  }

  // ---------- Teste A/B do bloco "Para você" ----------

  async recoExperimentState(actor: Actor): Promise<RecoExperimentState> {
    this.assertAdmin(actor);
    return this.recoExperiment.state();
  }

  /**
   * Liga, desliga ou muda o tamanho do grupo de controle (0 a 50%), na hora. Cada mudança vai para a Auditoria.
   * Mexer no tamanho com o teste no ar recomeça a medição, porque algumas pessoas trocam de grupo.
   */
  async setRecoExperiment(actor: Actor, enabled: unknown, controlPercent: unknown, note: unknown): Promise<RecoExperimentState> {
    this.assertAdmin(actor);
    if (typeof enabled !== 'boolean') throw validationError('Dados inválidos', { enabled: 'Use true ou false' });
    const before = await this.recoExperiment.state();
    const percent = controlPercent === undefined ? before.controlPercent : controlPercent;
    if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 0 || percent > before.maxPercent) {
      throw validationError('Dados inválidos', { controlPercent: `Número inteiro de 0 a ${before.maxPercent}` });
    }
    const reason = noteText(note, false);
    if (before.enabled === enabled && before.controlPercent === percent) throw conflict(enabled ? 'O teste já está ligado com esse tamanho' : 'O teste já está desligado');
    await this.recoExperiment.set(enabled, percent, actor.userId);
    const action = !enabled ? 'RECO_EXPERIMENT_DISABLED' : before.enabled ? 'RECO_EXPERIMENT_CHANGED' : 'RECO_EXPERIMENT_ENABLED';
    await this.log(actor.userId, action, 'SETTING', 'reco-experiment', `${enabled ? `controle ${percent}%` : 'desligado'}${reason ? `: ${reason}` : ''}`.slice(0, 400), {
      targetLabel: 'Teste A/B do “Para você”',
      changes: diffOf({ enabled: 'ligado', controlPercent: 'grupo de controle (%)' }, { enabled: before.enabled, controlPercent: before.controlPercent }, { enabled, controlPercent: percent }),
    });
    return this.recoExperiment.state();
  }

  // ---------- Locais, eventos e posts ----------

  async searchVenues(actor: Actor, query: ListQuery & { q?: unknown }): Promise<AdminPage<AdminVenueRow>> {
    this.assertAdmin(actor);
    const text = queryText(query.q);
    return this.paged(query, (page) => this.deps.admin.searchVenues(text, page), () => this.deps.admin.countList('VENUES', { text }), ADMIN_SORTS.venues);
  }

  /** Abre um local: cadastro, origem, responsável, seguidores e eventos. */
  async venueDetail(actor: Actor, id: unknown): Promise<AdminVenueDetail> {
    this.assertAdmin(actor);
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) throw notFound('Local não encontrado');
    const { places, users, clock } = this.deps;
    const venue = await places.findVenue(id);
    if (!venue) throw notFound('Local não encontrado');
    const now = clock.now();
    const [events, followers, ownerProfile] = await Promise.all([
      places.listVenueEvents(venue.id),
      places.countVenueFollowers(venue.id),
      venue.ownerId ? users.findProfileById(venue.ownerId) : Promise.resolve(undefined),
    ]);
    const key = venue.externalKey ?? '';
    const view = (e: (typeof events)[number], upcoming: boolean) => ({ id: e.id, title: e.title, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(), kind: e.kind, isFree: e.isFree, isSample: e.isSample, upcoming });
    const ahead = events.filter((e) => e.endsAt.getTime() >= now.getTime()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const behind = events.filter((e) => e.endsAt.getTime() < now.getTime()).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
    return {
      id: venue.id,
      name: venue.name,
      address: venue.address,
      category: venue.category,
      lat: venue.lat,
      lng: venue.lng,
      isSample: venue.isSample,
      isOrganization: venue.isOrganization === true,
      isUserCreated: venue.isUserCreated === true,
      source: key.startsWith('google:') ? 'GOOGLE' : key.startsWith('osm:') ? 'OSM' : key.startsWith('import:') ? 'IMPORT' : null,
      description: venue.description ?? null,
      coverUrl: venue.coverUrl ?? null,
      logoUrl: venue.logoUrl ?? null,
      instagram: venue.instagram ?? null,
      owner: venue.ownerId ? { id: venue.ownerId, username: ownerProfile?.username ?? '(removido)', displayName: ownerProfile?.displayName ?? '' } : null,
      followers,
      eventsTotal: events.length,
      upcomingCount: ahead.length,
      events: [...ahead.slice(0, 15).map((e) => view(e, true)), ...behind.slice(0, 5).map((e) => view(e, false))],
      extra: (await this.deps.admin.venueExtras(venue.id)) ?? null,
    };
  }

  /**
   * Corrige o cadastro de um local: o que o dono edita (nome, endereço, tipo, descrição, capa, logo) e o que só a gestão troca
   * (posição, dado de teste, quem publica no feed). Motivo obrigatório; o que mudou (de → para) fica na auditoria.
   */
  async editVenue(actor: Actor, venueId: unknown, input: AdminVenueEditInput): Promise<AdminVenueDetail> {
    this.assertAdmin(actor);
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw validationError('Dados inválidos', { venue: 'Dados do local inválidos' });
    const reason = noteText(input.note, true);
    const current = typeof venueId === 'string' && venueId.length > 0 && venueId.length <= 64 ? await this.deps.places.findVenue(venueId) : undefined;
    if (!current) throw notFound('Local não encontrado');
    const extra = await this.deps.admin.venueExtras(current.id);
    const feedBefore: FeedPolicy = extra?.feedPolicy ?? 'OWNER_ONLY';
    const adminBefore = { lat: current.lat, lng: current.lng, isSample: current.isSample, feedPolicy: feedBefore };
    const adminAfter = {
      lat: coordOf(input.lat, current.lat, 'lat'), lng: coordOf(input.lng, current.lng, 'lng'),
      isSample: flagOf(input.isSample, current.isSample, 'isSample'), feedPolicy: feedPolicyOf(input.feedPolicy, feedBefore),
    };
    const profile: VenueProfileInput = { name: input.name, address: input.address, category: input.category, description: input.description, imageUrl: input.imageUrl, imageData: input.imageData, logoUrl: input.logoUrl, logoData: input.logoData, hours: input.hours, instagram: input.instagram };
    const labels = { name: 'nome', address: 'endereço', category: 'tipo', description: 'descrição', coverUrl: 'capa', logoUrl: 'logo', instagram: 'instagram' };
    const preview = this.venues.checkProfileForAdmin(current, profile);
    const diff = [...diffOf(labels, { ...current }, { ...current, ...preview }), ...diffOf({ lat: 'latitude', lng: 'longitude', isSample: 'teste', feedPolicy: 'feed' }, adminBefore, adminAfter)];
    const changes = changesText(diff);
    if (changes.length === 0) throw conflict('Nada mudou');
    await this.venues.adminUpdateProfile(current.id, profile);
    if (!(await this.deps.admin.updateVenueAdminFields(current.id, adminAfter))) throw notFound('Local não encontrado');
    await this.log(actor.userId, 'VENUE_EDITED', 'VENUE', current.id, `${reason ?? ''} (${changes.join('; ')})`.slice(0, 400), { targetLabel: current.name, changes: diff });
    return this.venueDetail(actor, current.id);
  }

  /** Tira o responsável de um local (ele volta a poder ser reivindicado). */
  async removeVenueOwner(actor: Actor, venueId: unknown, note: unknown): Promise<{ removed: true }> {
    this.assertAdmin(actor);
    const venue = typeof venueId === 'string' && venueId.length <= 64 ? await this.deps.places.findVenue(venueId) : undefined;
    if (!venue) throw notFound('Local não encontrado');
    if (!venue.ownerId) throw conflict('Este local não tem responsável');
    const reason = noteText(note, true);
    await this.deps.places.setVenueOwner(venue.id, null);
    await this.log(actor.userId, 'VENUE_OWNER_REMOVED', 'VENUE', venue.id, reason, {
      targetLabel: venue.name, changes: [{ field: 'responsável', before: (await this.userLabel(venue.ownerId)) ?? venue.ownerId, after: null }],
    });
    return { removed: true };
  }

  /**
   * Posição de um endereço: primeiro a busca gratuita (OpenStreetMap); só se ela não achar e houver Google, a paga.
   * Devolve até 5 opções, a mais provável primeiro.
   */
  async geocodeAddress(actor: Actor, address: unknown): Promise<{ items: { name: string; address: string | null; lat: number; lng: number; source: 'FREE' | 'GOOGLE' }[]; googlePaused?: true }> {
    this.assertAdmin(actor);
    if (typeof address !== 'string' || address.trim().length < 3) throw validationError('Dados inválidos', { address: 'Escreva o endereço para buscar a posição' });
    const items = await this.locate(address.trim().slice(0, 200), 5);
    // Sem resultado grátis e o Google sem cota hoje: a gestão vê o motivo em vez de "endereço não existe".
    return { items, ...(items.length === 0 && this.deps.placeSource.premiumPaused === true ? { googlePaused: true as const } : {}) };
  }

  private async locate(address: string, limit: number): Promise<{ name: string; address: string | null; lat: number; lng: number; source: 'FREE' | 'GOOGLE' }[]> {
    const source = this.deps.placeSource;
    if (!source.search) return [];
    const empty = { available: false, places: [] };
    const view = (from: 'FREE' | 'GOOGLE') => (p: { name: string; address?: string | null; lat: number; lng: number }) => ({ name: p.name, address: p.address ?? null, lat: p.lat, lng: p.lng, source: from });
    const free = await source.search(address, undefined, limit).catch(() => empty);
    if (free.places.length > 0) return free.places.slice(0, limit).map(view('FREE'));
    if (!source.premiumSearch) return [];
    const paid = await source.search(address, undefined, limit, { premium: true }).catch(() => empty);
    return paid.places.slice(0, limit).map(view('GOOGLE'));
  }

  /**
   * Busca no Google para cadastrar um local: sugestões do Autocomplete (nome e endereço), sem custo quando a sessão
   * termina no detalhe. `available: false` quando não há chave do Google ou o teto do dia acabou.
   */
  async googleSuggest(actor: Actor, input: { text?: unknown; sessionToken?: unknown }): Promise<{ available: boolean; items: { placeId: string; name: string; address: string | null }[] }> {
    this.assertAdmin(actor);
    const picker = this.deps.googlePicker;
    if (!picker) return { available: false, items: [] };
    if (typeof input.text !== 'string' || typeof input.sessionToken !== 'string') throw validationError('Dados inválidos', { text: 'Escreva o nome do local' });
    return picker.suggest(input.text.slice(0, 120), input.sessionToken);
  }

  /**
   * O lugar escolhido no Google: endereço, posição e tipo (detalhe "Essentials", grátis dentro da franquia). Avisa se ele
   * já está no AskouT (vinculado ou com o mesmo nome ali perto). Capa, logo, Instagram e descrição a gestão preenche.
   */
  async googlePlace(actor: Actor, input: { placeId?: unknown; name?: unknown; sessionToken?: unknown }): Promise<{ placeId: string; address: string | null; lat: number; lng: number; category: string | null; linked: { id: string; name: string } | null; duplicate: { id: string; name: string } | null }> {
    this.assertAdmin(actor);
    const picker = this.deps.googlePicker;
    if (!picker) throw conflict('A busca no Google não está ligada (falta a chave do Google Places)');
    if (typeof input.placeId !== 'string' || !GOOGLE_PLACE_ID_RE.test(input.placeId)) throw validationError('Dados inválidos', { placeId: 'Lugar do Google inválido' });
    const linked = await this.deps.places.findVenueByExternalKey(`google:${input.placeId}`);
    const place = await picker.essentials(input.placeId, typeof input.sessionToken === 'string' ? input.sessionToken : undefined);
    if (!place) throw conflict('O Google não respondeu agora (ou o limite do dia acabou). Tente de novo mais tarde ou preencha à mão');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const duplicate = !linked && name ? await this.findDuplicateVenue(name, place.lat, place.lng) : undefined;
    return { placeId: input.placeId, address: place.address, lat: place.lat, lng: place.lng, category: categoryFromGoogleTypes(place.types), linked: linked ? { id: linked.id, name: linked.name } : null, duplicate: duplicate ?? null };
  }

  /**
   * Busca de locais no Google para o Hunter gravar no AskouT: uma busca por texto ("bares em Pinheiros") devolve até 20
   * lugares, cada um marcado como novo, já vinculado a um local do AskouT ou com o mesmo nome a menos de 250 m. Usa a
   * busca por texto do Google (a mesma cota diária do app); `available: false` sem chave ou com o teto do dia atingido.
   */
  async googleSearchVenues(actor: Actor, input: { text?: unknown }): Promise<{ available: boolean; items: GoogleVenueHit[] }> {
    this.assertAdmin(actor);
    if (typeof input.text !== 'string' || input.text.trim().length < 3) throw validationError('Dados inválidos', { text: 'Escreva pelo menos 3 letras para buscar' });
    const source = this.deps.placeSource;
    if (!source.search || source.premiumSearch !== true) return { available: false, items: [] };
    const found = await source.search(input.text.trim().replace(/\s+/g, ' ').slice(0, 120), undefined, 20, { premium: true }).catch(() => ({ available: false, places: [] }));
    // Se o Google falhar, a fonte cai no mapa gratuito: aqui só interessam lugares do Google.
    const places = found.places.filter((p) => p.source === 'GOOGLE' && GOOGLE_PLACE_ID_RE.test(p.externalId));
    // Resultado só do mapa gratuito (ou nenhum) quer dizer que o Google não respondeu ou bateu no teto do dia.
    if (places.length === 0) return { available: found.available && found.places.length === 0, items: [] };
    const items: GoogleVenueHit[] = [];
    for (const p of places) {
      const linked = await this.deps.places.findVenueByExternalKey(`google:${p.externalId}`);
      const duplicate = linked ? undefined : await this.findDuplicateVenue(p.name, p.lat, p.lng);
      const existing = linked ? { id: linked.id, name: linked.name } : (duplicate ?? null);
      items.push({
        placeId: p.externalId,
        name: p.name.slice(0, 80),
        address: p.address ?? null,
        category: categoryFromGoogleTypes(p.category ? [p.category] : []),
        lat: p.lat,
        lng: p.lng,
        mapsUri: p.mapsUri ?? null,
        status: linked ? 'LINKED' : duplicate ? 'DUPLICATE' : 'NEW',
        existing,
      });
    }
    return { available: true, items };
  }

  /**
   * Grava como locais do AskouT os lugares do Google escolhidos no Hunter (até 20 por vez). Cada um passa pelas mesmas
   * regras do cadastro manual: pula o que já está vinculado ao Google ou tem o mesmo nome a menos de 250 m (inclusive
   * entre os próprios escolhidos). Cada local criado fica na auditoria.
   */
  async googleSaveVenues(actor: Actor, input: { places?: unknown; note?: unknown }): Promise<{ results: { placeId: string; name: string; status: 'CREATED' | 'SKIPPED'; venueId?: string; reason?: string }[]; created: number; skipped: number }> {
    this.assertAdmin(actor);
    const list = input.places;
    if (!Array.isArray(list) || list.length === 0) throw validationError('Dados inválidos', { places: 'Escolha pelo menos um lugar' });
    if (list.length > 20) throw validationError('Dados inválidos', { places: 'Grave até 20 lugares por vez' });
    const note = noteText(input.note, false);
    const results: { placeId: string; name: string; status: 'CREATED' | 'SKIPPED'; venueId?: string; reason?: string }[] = [];
    for (const raw of list) {
      const p = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
      const placeId = typeof p['placeId'] === 'string' ? p['placeId'] : '';
      const name = typeof p['name'] === 'string' ? p['name'].trim() : '';
      try {
        if (!GOOGLE_PLACE_ID_RE.test(placeId)) throw validationError('Dados inválidos', { placeId: 'Lugar do Google inválido' });
        const created = await this.createVenueFrom(actor, { name: p['name'], address: p['address'], category: p['category'], lat: p['lat'], lng: p['lng'], googlePlaceId: placeId, note }, 'busca no Google pelo Hunter');
        results.push({ placeId, name: created.name, status: 'CREATED', venueId: created.id });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        const detail = Object.values(error.details ?? {})[0];
        results.push({ placeId, name, status: 'SKIPPED', reason: typeof detail === 'string' ? detail : error.message });
      }
    }
    const created = results.filter((r) => r.status === 'CREATED').length;
    return { results, created, skipped: results.length - created };
  }

  /** Local do AskouT com o mesmo nome a menos de 250 m (o mesmo rolê cadastrado de novo). */
  private async findDuplicateVenue(name: string, lat: number, lng: number): Promise<{ id: string; name: string } | undefined> {
    const key = venueNameKey(name);
    if (!key) return undefined;
    const near = await this.deps.places.searchVenues(name, { lat, lng }, VENUE_DUPLICATE_RADIUS_M, 20);
    const hit = near.find((r) => venueNameKey(r.venue.name) === key);
    return hit ? { id: hit.venue.id, name: hit.venue.name } : undefined;
  }

  /**
   * Confere um local novo sem gravar: nome, endereço, tipo, descrição, imagens, Instagram, posição (da planilha ou do
   * endereço) e se já existe um igual ali perto. Erros vão por campo.
   */
  private async checkNewVenue(input: AdminVenueCreateInput): Promise<{ record: VenueRecord; profile: VenueProfileInput; isSample: boolean; feedPolicy: FeedPolicy; located: 'SHEET' | 'FREE' | 'GOOGLE'; duplicate?: { id: string; name: string } }> {
    const id = this.deps.ids.next();
    const blank: VenueRecord = { id, name: '', address: null, category: null, lat: 0, lng: 0, isSample: false, ownerId: null };
    const profile: VenueProfileInput = { name: input.name ?? '', address: input.address, category: input.category, description: input.description, imageUrl: input.imageUrl, imageData: input.imageData, logoUrl: input.logoUrl, logoData: input.logoData, instagram: input.instagram };
    const checked = this.venues.checkProfileForAdmin(blank, profile);
    const isSample = flagOf(input.isSample, false, 'isSample');
    const feedPolicy = feedPolicyOf(input.feedPolicy, 'OWNER_ONLY');
    const given = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
    let lat: number, lng: number, located: 'SHEET' | 'FREE' | 'GOOGLE';
    if (given(input.lat) || given(input.lng)) {
      if (!given(input.lat) || !given(input.lng)) throw validationError('Dados inválidos', { [given(input.lat) ? 'lng' : 'lat']: 'Informe latitude e longitude juntas (ou deixe as duas vazias para buscar pelo endereço)' });
      const num = (v: unknown) => (typeof v === 'string' ? v.trim().replace(',', '.') : v);
      lat = coordOf(num(input.lat), 0, 'lat');
      lng = coordOf(num(input.lng), 0, 'lng');
      located = 'SHEET';
    } else {
      if (!checked.address) throw validationError('Dados inválidos', { address: 'Informe o endereço (ou a latitude e a longitude)' });
      const [first] = await this.locate(checked.address, 1);
      if (!first) {
        const why = this.deps.placeSource.premiumPaused === true ? ' (a busca do Google atingiu o limite de hoje)' : '';
        throw validationError('Dados inválidos', { address: `Não achamos esse endereço no mapa${why}. Confira ou informe latitude e longitude` });
      }
      lat = first.lat;
      lng = first.lng;
      located = first.source;
    }
    const duplicate = await this.findDuplicateVenue(checked.name, lat, lng);
    const record: VenueRecord = { id, name: checked.name, address: checked.address, category: checked.category, lat, lng, isSample, ownerId: null };
    return { record, profile, isSample, feedPolicy, located, ...(duplicate ? { duplicate } : {}) };
  }

  /** Grava um local já conferido: cadastro, descrição/imagens/Instagram e os campos da gestão. */
  private async saveNewVenue(c: { record: VenueRecord; profile: VenueProfileInput; isSample: boolean; feedPolicy: FeedPolicy }): Promise<void> {
    await this.deps.places.createVenue(c.record);
    const { description, imageUrl, imageData, logoUrl, logoData, instagram } = c.profile;
    const extra: VenueProfileInput = { description, imageUrl, imageData, logoUrl, logoData, instagram };
    if (Object.values(extra).some((v) => v !== undefined && v !== null && v !== '')) await this.venues.adminUpdateProfile(c.record.id, extra);
    await this.deps.admin.updateVenueAdminFields(c.record.id, { lat: c.record.lat, lng: c.record.lng, isSample: c.isSample, feedPolicy: c.feedPolicy });
  }

  /**
   * Cadastra um local pela gestão, com os mesmos campos da edição. Sem latitude/longitude, a posição sai do endereço
   * (busca gratuita primeiro). Recusa se já existe um local com o mesmo nome a menos de 250 m. Fica na auditoria.
   */
  async createVenue(actor: Actor, input: AdminVenueCreateInput): Promise<AdminVenueDetail> {
    this.assertAdmin(actor);
    const created = await this.createVenueFrom(actor, input, 'cadastro manual');
    return this.venueDetail(actor, created.id);
  }

  /** Confere e grava um local novo da gestão; `origin` vai para a auditoria (cadastro manual, busca no Google…). */
  private async createVenueFrom(actor: Actor, input: AdminVenueCreateInput, origin: string): Promise<{ id: string; name: string }> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw validationError('Dados inválidos', { venue: 'Dados do local inválidos' });
    const reason = noteText(input.note, false);
    let googleKey: string | undefined;
    if (input.googlePlaceId !== undefined && input.googlePlaceId !== null && input.googlePlaceId !== '') {
      if (typeof input.googlePlaceId !== 'string' || !GOOGLE_PLACE_ID_RE.test(input.googlePlaceId)) throw validationError('Dados inválidos', { googlePlaceId: 'Lugar do Google inválido' });
      googleKey = `google:${input.googlePlaceId}`;
      const linked = await this.deps.places.findVenueByExternalKey(googleKey);
      if (linked) throw conflict(`Esse lugar do Google já está no AskouT como “${linked.name}”`);
    }
    const c = await this.checkNewVenue(input);
    if (c.duplicate) throw conflict(`Já existe “${c.duplicate.name}” com esse nome a menos de ${VENUE_DUPLICATE_RADIUS_M} m`);
    if (googleKey) c.record.externalKey = googleKey;
    await this.saveNewVenue(c);
    const where = (googleKey ? 'a partir do Google; ' : '') + (c.located === 'SHEET' ? 'posição informada' : c.located === 'FREE' ? 'posição pelo endereço (OpenStreetMap)' : 'posição pelo endereço (Google)');
    await this.log(actor.userId, 'VENUE_CREATED', 'VENUE', c.record.id, `${reason ? `${reason} ` : ''}(${origin}; ${where})`.slice(0, 400), {
      targetLabel: c.record.name,
      changes: diffOf({ name: 'nome', address: 'endereço', category: 'tipo', lat: 'latitude', lng: 'longitude' }, {}, { ...c.record }),
    });
    return { id: c.record.id, name: c.record.name };
  }

  /**
   * Importa locais de uma planilha. Com `dryRun`, só confere e devolve a prévia linha a linha (erros por coluna,
   * duplicados no AskouT ou repetidos na própria planilha). Sem `dryRun`, grava as linhas sem problema e pula as outras;
   * cada local criado e o lote ficam na auditoria.
   */
  async importVenues(actor: Actor, input: { rows?: unknown; dryRun?: unknown; fileName?: unknown; note?: unknown }): Promise<AdminVenueImportResult> {
    this.assertAdmin(actor);
    if (typeof input !== 'object' || input === null) throw validationError('Dados inválidos', { rows: 'Envie as linhas da planilha' });
    const rows = input.rows;
    if (!Array.isArray(rows) || rows.length === 0) throw validationError('Dados inválidos', { rows: 'A planilha não tem nenhuma linha de local' });
    if (rows.length > VENUE_IMPORT_MAX_ROWS) throw validationError('Dados inválidos', { rows: `Importe até ${VENUE_IMPORT_MAX_ROWS} locais por vez` });
    const dryRun = input.dryRun !== false;
    const fileName = typeof input.fileName === 'string' ? input.fileName.trim().slice(0, 120) : '';
    const reason = noteText(input.note, false);
    const lines: AdminVenueImportLine[] = [];
    const ready: { line: AdminVenueImportLine; checked: Awaited<ReturnType<AdminService['checkNewVenue']>> }[] = [];
    const seen: { key: string; lat: number; lng: number; line: number; name: string }[] = [];
    for (const [index, raw] of rows.entries()) {
      const lineNo = index + 2;
      const row = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as AdminVenueImportRow;
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      const address = typeof row.address === 'string' && row.address.trim() ? row.address.trim() : null;
      const base: AdminVenueImportLine = { line: lineNo, status: 'OK', name, address, lat: null, lng: null, located: null, problems: {}, duplicateOf: null };
      try {
        const sample = typeof row.isSample === 'string' ? ['sim', 's', 'true', '1', 'x'].includes(fold(row.isSample)) : row.isSample;
        const checked = await this.checkNewVenue({ name: row.name, address: row.address, category: row.category, description: row.description, instagram: row.instagram, imageUrl: row.imageUrl, logoUrl: row.logoUrl, lat: row.lat, lng: row.lng, isSample: sample === undefined || sample === null || sample === '' ? false : sample });
        const line: AdminVenueImportLine = { ...base, name: checked.record.name, address: checked.record.address, lat: checked.record.lat, lng: checked.record.lng, located: checked.located };
        const key = venueNameKey(checked.record.name);
        const twin = seen.find((s) => s.key === key && distanceMeters(s, checked.record) <= VENUE_DUPLICATE_RADIUS_M);
        if (checked.duplicate) {
          lines.push({ ...line, status: 'DUPLICATE', duplicateOf: { id: checked.duplicate.id, name: checked.duplicate.name } });
        } else if (twin) {
          lines.push({ ...line, status: 'DUPLICATE', duplicateOf: { id: null, name: twin.name, line: twin.line } });
        } else {
          seen.push({ key, lat: checked.record.lat, lng: checked.record.lng, line: lineNo, name: checked.record.name });
          lines.push(line);
          ready.push({ line, checked });
        }
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        const problems: Record<string, string> = { ...(error.details ?? {}) };
        if (Object.keys(problems).length === 0) problems['row'] = error.message;
        lines.push({ ...base, status: 'ERROR', problems });
      }
    }
    if (!dryRun) {
      for (const r of ready) {
        await this.saveNewVenue(r.checked);
        r.line.status = 'CREATED';
        r.line.venueId = r.checked.record.id;
        await this.log(actor.userId, 'VENUE_CREATED', 'VENUE', r.checked.record.id, `Importado da planilha${fileName ? ` ${fileName}` : ''} (linha ${r.line.line})`.slice(0, 400), {
          targetLabel: r.checked.record.name,
          changes: diffOf({ name: 'nome', address: 'endereço', category: 'tipo', lat: 'latitude', lng: 'longitude' }, {}, { ...r.checked.record }),
        });
      }
    }
    const count = (s: AdminVenueImportLine['status']) => lines.filter((l) => l.status === s).length;
    const counts = { ok: count('OK'), errors: count('ERROR'), duplicates: count('DUPLICATE'), created: count('CREATED') };
    if (!dryRun) {
      if (counts.created === 0) throw conflict('Nenhuma linha pôde ser importada. Corrija a planilha e tente de novo');
      const summary = `${counts.created} criados, ${counts.duplicates} duplicados e ${counts.errors} com erro pulados`;
      await this.log(actor.userId, 'VENUES_IMPORTED', 'SETTING', 'venues-import', `${reason ? `${reason} ` : ''}(${fileName ? `${fileName}: ` : ''}${summary})`.slice(0, 400), { targetLabel: fileName || 'Planilha de locais' });
    }
    return { dryRun, lines, counts };
  }

  async searchPlaceEvents(actor: Actor, query: ListQuery & { q?: unknown }): Promise<AdminPage<AdminPlaceEventListRow>> {
    this.assertAdmin(actor);
    const text = queryText(query.q);
    const withGoing = async (page: Page): Promise<AdminPlaceEventListRow[]> => {
      const rows = await this.deps.admin.searchPlaceEvents(text, page);
      const going = rows.length > 0 ? await this.deps.eventRoom.countGoing(rows.map((r) => ({ source: 'PLACE' as const, id: r.id }))) : new Map<string, number>();
      return rows.map((r) => ({ ...r, goingCount: going.get(r.id) ?? 0 }));
    };
    return this.paged(query, withGoing, () => this.deps.admin.countList('PLACE_EVENTS', { text }), ADMIN_SORTS.events);
  }

  /** Abre um evento de local: cadastro, local, responsável e quem confirmou presença. */
  async eventDetail(actor: Actor, id: unknown): Promise<AdminEventDetail> {
    this.assertAdmin(actor);
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) throw notFound('Evento não encontrado');
    const { places, users, eventRoom, clock } = this.deps;
    const found = await places.findEvent(id);
    if (!found) throw notFound('Evento não encontrado');
    const { event, venue } = found;
    const attendance = await eventRoom.listGoing({ source: 'PLACE', id: event.id });
    const first = attendance.slice(0, 20);
    const ids = [...new Set([...first.map((a) => a.userId), ...(venue.ownerId ? [venue.ownerId] : [])])];
    const profiles = new Map((ids.length > 0 ? await users.findProfilesByIds(ids) : []).map((p) => [p.userId, p]));
    const now = clock.now().getTime();
    const status = event.endsAt.getTime() < now ? 'PAST' : event.startsAt.getTime() <= now ? 'LIVE' : 'UPCOMING';
    // Locais costumam repetir o mesmo nome toda semana: lista as outras datas para não confundir um com o outro.
    const titleKey = event.title.trim().toLocaleLowerCase('pt-BR');
    const siblings = (await places.listVenueEvents(venue.id)).filter((e) => e.title.trim().toLocaleLowerCase('pt-BR') === titleKey);
    const others = siblings
      .filter((e) => e.id !== event.id)
      .sort((a, b) => Math.abs(a.startsAt.getTime() - event.startsAt.getTime()) - Math.abs(b.startsAt.getTime() - event.startsAt.getTime()))
      .slice(0, 12)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      kind: event.kind,
      isFree: event.isFree,
      isSample: event.isSample,
      imageUrl: event.imageUrl,
      tags: event.tags,
      ticketUrl: event.ticketUrl ?? null,
      status,
      venue: { id: venue.id, name: venue.name, address: venue.address, owner: venue.ownerId ? { id: venue.ownerId, username: profiles.get(venue.ownerId)?.username ?? '(removido)' } : null },
      goingCount: attendance.length,
      going: first.map((a) => ({ id: a.userId, username: profiles.get(a.userId)?.username ?? '(removido)', displayName: profiles.get(a.userId)?.displayName ?? '', avatarUrl: profiles.get(a.userId)?.avatarUrl ?? null, at: a.createdAt.toISOString() })),
      sameTitle: others.map((e) => ({ id: e.id, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(), upcoming: e.endsAt.getTime() >= now })),
      sameTitleTotal: Math.max(siblings.length, 1),
      extra: (await this.deps.admin.placeEventExtras(event.id)) ?? null,
    };
  }

  /**
   * Corrige um evento de local com as mesmas regras de quem administra (nome, descrição, tipo, datas, entrada, capa, hashtags,
   * ingresso) e o que só a gestão troca (dado de teste, quem publica no feed). Motivo obrigatório; o que mudou fica na auditoria.
   */
  async editPlaceEvent(actor: Actor, eventId: unknown, input: AdminEventEditInput): Promise<AdminEventDetail> {
    this.assertAdmin(actor);
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw validationError('Dados inválidos', { event: 'Dados do evento inválidos' });
    const reason = noteText(input.note, true);
    const found = typeof eventId === 'string' && eventId.length > 0 && eventId.length <= 64 ? await this.deps.places.findEvent(eventId) : undefined;
    if (!found) throw notFound('Evento não encontrado');
    const extra = await this.deps.admin.placeEventExtras(found.event.id);
    const feedBefore: FeedPolicy = extra?.feedPolicy ?? 'OWNER_ONLY';
    const adminBefore = { isSample: found.event.isSample, feedPolicy: feedBefore };
    const adminAfter = { isSample: flagOf(input.isSample, adminBefore.isSample, 'isSample'), feedPolicy: feedPolicyOf(input.feedPolicy, feedBefore) };
    const fields: VenueEventInput = { title: input.title, description: input.description, kind: input.kind, startsAt: input.startsAt, endsAt: input.endsAt, isFree: input.isFree, imageUrl: input.imageUrl, imageData: input.imageData, tags: input.tags, ticketUrl: input.ticketUrl };
    const labels = { title: 'nome', description: 'descrição', kind: 'tipo', startsAt: 'início', endsAt: 'fim', isFree: 'grátis', imageUrl: 'capa', tags: 'hashtags', ticketUrl: 'ingresso' };
    // Confere antes de gravar: "nada mudou" não deve tocar no evento.
    const preview = this.venues.checkEventForAdmin(found.event, fields);
    const diff = [...diffOf(labels, { ...found.event }, { ...found.event, ...preview }), ...diffOf({ isSample: 'teste', feedPolicy: 'feed' }, adminBefore, adminAfter)];
    const changes = changesText(diff);
    if (changes.length === 0) throw conflict('Nada mudou');
    await this.venues.adminUpdateEvent(found.event.id, fields);
    if (!(await this.deps.admin.updatePlaceEventAdminFields(found.event.id, adminAfter))) throw notFound('Evento não encontrado');
    await this.log(actor.userId, 'PLACE_EVENT_EDITED', 'PLACE_EVENT', found.event.id, `${reason ?? ''} (${changes.join('; ')})`.slice(0, 400), { targetLabel: `${found.event.title} · ${found.venue.name}`, changes: diff });
    return this.eventDetail(actor, found.event.id);
  }

  async deletePlaceEvent(actor: Actor, eventId: unknown, note: unknown): Promise<{ deleted: true }> {
    this.assertAdmin(actor);
    const reason = noteText(note, true);
    const found = typeof eventId === 'string' && eventId.length > 0 && eventId.length <= 64 ? await this.deps.places.findEvent(eventId) : undefined;
    if (typeof eventId !== 'string' || eventId.length > 64 || !(await this.deps.admin.deletePlaceEvent(eventId))) throw notFound('Evento não encontrado');
    await this.log(actor.userId, 'PLACE_EVENT_REMOVED', 'PLACE_EVENT', eventId, reason, {
      targetLabel: found ? `${found.event.title} · ${found.venue.name}` : null,
      changes: found ? diffOf({ title: 'nome', startsAt: 'início', venue: 'local' }, { title: found.event.title, startsAt: found.event.startsAt, venue: found.venue.name }, {}) : null,
    });
    return { deleted: true };
  }

  async searchPosts(actor: Actor, query: ListQuery & { q?: unknown; events?: unknown }): Promise<AdminPage<AdminPostRow>> {
    this.assertAdmin(actor);
    const text = queryText(query.q);
    const onlyEvents = query.events === 'true' || query.events === true;
    return this.paged(query, (page) => this.deps.admin.searchPosts(text, onlyEvents, page), () => this.deps.admin.countList('POSTS', { text, onlyEvents }), ADMIN_SORTS.posts);
  }

  /** Um post inteiro: texto, lugar, dados de evento, fotos, marcações, contagens e os últimos comentários. */
  async postDetail(actor: Actor, postId: unknown): Promise<AdminPostDetail> {
    this.assertAdmin(actor);
    const post = typeof postId === 'string' && postId.length > 0 && postId.length <= 64 ? await this.deps.admin.postDetail(postId) : undefined;
    if (!post) throw notFound('Post não encontrado');
    return post;
  }

  async deletePost(actor: Actor, postId: unknown, note: unknown): Promise<{ deleted: true }> {
    this.assertAdmin(actor);
    const reason = noteText(note, true);
    const found = typeof postId === 'string' && postId.length > 0 && postId.length <= 64 ? await this.deps.posts.findById(postId) : undefined;
    if (typeof postId !== 'string' || postId.length > 64 || !(await this.deps.admin.deletePost(postId))) throw notFound('Post não encontrado');
    await this.log(actor.userId, 'POST_REMOVED', 'POST', postId, reason, found ? await this.contentExtra(found.post.authorId, found.post.eventTitle ?? found.post.caption) : {});
    return { deleted: true };
  }

  /** Apaga um comentário de post (ex.: o denunciado na aba "Perfis e comentários"). */
  async deletePostComment(actor: Actor, commentId: unknown, note: unknown): Promise<{ deleted: true }> {
    this.assertAdmin(actor);
    const reason = noteText(note, true);
    const comment = typeof commentId === 'string' && commentId.length <= 64 ? await this.deps.posts.findComment(commentId) : undefined;
    if (!comment) throw notFound('Comentário não encontrado');
    await this.deps.posts.deleteComment(comment.id);
    await this.log(actor.userId, 'COMMENT_REMOVED', 'COMMENT', comment.id, reason, await this.contentExtra(comment.authorId, comment.body));
    return { deleted: true };
  }

  // ---------- Denúncias ----------

  async postReports(actor: Actor, query: { status?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminPostReportRow>> {
    this.assertAdmin(actor);
    const open = query.status !== 'resolved';
    return this.paged(query, (page) => this.deps.admin.listPostReports(open, page), () => this.deps.admin.countList('POST_REPORTS', { open }));
  }

  async storyReports(actor: Actor, query: { status?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminStoryReportRow>> {
    this.assertAdmin(actor);
    const open = query.status !== 'resolved';
    return this.paged(query, (page) => this.deps.admin.listStoryReports(open, page), () => this.deps.admin.countList('STORY_REPORTS', { open }));
  }

  async resolveStoryReport(actor: Actor, reportId: unknown, resolution: unknown, note: unknown): Promise<{ resolved: true }> {
    this.assertAdmin(actor);
    const res = this.parseResolution(resolution);
    const text = noteText(note, false);
    const report = typeof reportId === 'string' && reportId.length <= 64 ? await this.deps.admin.findStoryReport(reportId) : undefined;
    if (!report) throw notFound('Denúncia não encontrada');
    if (!(await this.deps.admin.resolveStoryReport(report.id, actor.userId, res, text, this.deps.clock.now()))) throw conflict('Esta denúncia já foi decidida');
    await this.log(actor.userId, res === 'DISMISSED' ? 'REPORT_DISMISSED' : 'REPORT_ACTIONED', 'STORY_REPORT', report.id, text);
    return { resolved: true };
  }

  /** Tira um story do ar (some também para quem o denunciou e leva as denúncias dele). */
  async deleteStory(actor: Actor, storyId: unknown, note: unknown): Promise<{ deleted: true }> {
    this.assertAdmin(actor);
    const text = noteText(note, true);
    if (typeof storyId !== 'string' || storyId.length > 64 || !(await this.deps.admin.deleteStory(storyId))) throw notFound('Flash não encontrado');
    await this.log(actor.userId, 'STORY_REMOVED', 'STORY', storyId, text);
    return { deleted: true };
  }

  /** A foto ou o vídeo denunciado, para a gestão conferir (vale mesmo depois de vencido, enquanto existir). */
  async storyMedia(actor: Actor, storyId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    this.assertAdmin(actor);
    return typeof storyId === 'string' && storyId.length <= 64 ? this.deps.admin.findStoryMedia(storyId) : undefined;
  }

  async conversationReports(actor: Actor, query: { status?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminConversationReportRow>> {
    this.assertAdmin(actor);
    const open = query.status !== 'resolved';
    return this.paged(query, (page) => this.deps.admin.listConversationReports(open, page), () => this.deps.admin.countList('CONVERSATION_REPORTS', { open }));
  }

  async userReports(actor: Actor, query: { status?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminUserReportRow>> {
    this.assertAdmin(actor);
    const open = query.status !== 'resolved';
    return this.paged(query, (page) => this.deps.admin.listUserReports(open, page), () => this.deps.admin.countList('USER_REPORTS', { open }));
  }

  async resolveUserReport(actor: Actor, reportId: unknown, resolution: unknown, note: unknown): Promise<{ resolved: true }> {
    this.assertAdmin(actor);
    const res = this.parseResolution(resolution);
    const text = noteText(note, false);
    const report = typeof reportId === 'string' && reportId.length <= 64 ? await this.deps.admin.findUserReport(reportId) : undefined;
    if (!report) throw notFound('Denúncia não encontrada');
    if (!(await this.deps.admin.resolveUserReport(report.id, actor.userId, res, text, this.deps.clock.now()))) throw conflict('Esta denúncia já foi decidida');
    await this.log(actor.userId, res === 'DISMISSED' ? 'REPORT_DISMISSED' : 'REPORT_ACTIONED', 'USER_REPORT', report.id, text, { targetLabel: await this.userLabel(report.reportedUserId) });
    return { resolved: true };
  }

  /** Encerra uma denúncia de post sem ou com providência. A providência em si (remover o post, suspender a conta) é outra chamada. */
  async resolvePostReport(actor: Actor, reportId: unknown, resolution: unknown, note: unknown): Promise<{ resolved: true }> {
    this.assertAdmin(actor);
    const res = this.parseResolution(resolution);
    const text = noteText(note, false);
    const report = typeof reportId === 'string' && reportId.length <= 64 ? await this.deps.admin.findPostReport(reportId) : undefined;
    if (!report) throw notFound('Denúncia não encontrada');
    if (!(await this.deps.admin.resolvePostReport(report.id, actor.userId, res, text, this.deps.clock.now()))) throw conflict('Esta denúncia já foi decidida');
    await this.log(actor.userId, res === 'DISMISSED' ? 'REPORT_DISMISSED' : 'REPORT_ACTIONED', 'POST_REPORT', report.id, text);
    return { resolved: true };
  }

  async resolveConversationReport(actor: Actor, reportId: unknown, resolution: unknown, note: unknown): Promise<{ resolved: true }> {
    this.assertAdmin(actor);
    const res = this.parseResolution(resolution);
    const text = noteText(note, false);
    const report = typeof reportId === 'string' && reportId.length <= 64 ? await this.deps.admin.findConversationReport(reportId) : undefined;
    if (!report) throw notFound('Denúncia não encontrada');
    if (!(await this.deps.admin.resolveConversationReport(report.id, actor.userId, res, text, this.deps.clock.now()))) throw conflict('Esta denúncia já foi decidida');
    await this.log(actor.userId, res === 'DISMISSED' ? 'REPORT_DISMISSED' : 'REPORT_ACTIONED', 'CONVERSATION_REPORT', report.id, text, { targetLabel: report.reportedUserId ? await this.userLabel(report.reportedUserId) : null });
    return { resolved: true };
  }

  private parseResolution(value: unknown): ReportResolution {
    if (typeof value !== 'string' || !(REPORT_RESOLUTIONS as readonly string[]).includes(value)) throw validationError('Decisão inválida', { resolution: 'Use DISMISSED ou ACTIONED' });
    return value as ReportResolution;
  }

  // ---------- Feed dos eventos e rolês ----------

  /** Nome e caminho da página onde está o feed (o evento ou o rolê). */
  private async feedPlace(target: FeedTarget): Promise<AdminFeedPlace> {
    if (target.type === 'PLACE_EVENT') {
      const found = await this.deps.places.findEvent(target.id);
      return { type: target.type, id: target.id, title: found ? `${found.event.title} · ${found.venue.name}` : '(evento removido)', url: `/eventos/${target.id}` };
    }
    if (target.type === 'USER_EVENT') {
      const found = await this.deps.posts.findById(target.id);
      return { type: target.type, id: target.id, title: found?.post.eventTitle ?? '(evento removido)', url: `/eventos/${target.id}` };
    }
    const venue = await this.deps.places.findVenue(target.id);
    return { type: target.type, id: target.id, title: venue?.name ?? '(local removido)', url: `/bares/${target.id}` };
  }

  private async usernames(ids: string[]): Promise<Map<string, string>> {
    const profiles = await this.deps.users.findProfilesByIds([...new Set(ids)]);
    return new Map(profiles.map((p) => [p.userId, p.username]));
  }

  private async feedPostRows(rows: FeedPostWithImages[]): Promise<AdminFeedPostRow[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.post.id);
    const [names, comments, reports] = await Promise.all([this.usernames(rows.map((r) => r.post.authorId)), this.deps.feed.commentCounts(ids), this.deps.feed.openReportCounts(ids, [])]);
    const places = new Map<string, AdminFeedPlace>();
    const out: AdminFeedPostRow[] = [];
    for (const { post, imageIds } of rows) {
      const key = `${post.target.type}:${post.target.id}`;
      const place = places.get(key) ?? (await this.feedPlace(post.target));
      places.set(key, place);
      out.push({
        id: post.id, kind: post.kind, status: post.status, body: post.body, createdAt: post.createdAt,
        author: { id: post.authorId, username: names.get(post.authorId) ?? '(removido)' }, place, imageIds,
        commentsCount: comments.get(post.id) ?? 0, openReportsCount: reports.posts.get(post.id) ?? 0,
      });
    }
    return out;
  }

  /** Publicações de todos os feeds. `status=pending`: só as que esperam aprovação de quem organiza. */
  async feedPosts(actor: Actor, query: { q?: unknown; status?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminFeedPostRow>> {
    this.assertAdmin(actor);
    const text = queryText(query.q);
    const status: FeedPostStatus | undefined = query.status === 'pending' ? 'PENDING' : query.status === 'published' ? 'PUBLISHED' : undefined;
    return this.paged(query, async (page) => this.feedPostRows(await this.deps.feed.adminListPosts({ text, page, ...(status ? { status } : {}) })), () => this.deps.feed.countAdminPosts({ text, ...(status ? { status } : {}) }));
  }

  /** Comentários de uma publicação (do mais antigo ao mais novo), para conferir e apagar. */
  async feedComments(actor: Actor, postId: unknown): Promise<{ items: AdminFeedCommentRow[] }> {
    this.assertAdmin(actor);
    const found = typeof postId === 'string' && postId.length <= 64 ? await this.deps.feed.findPost(postId) : undefined;
    if (!found) throw notFound('Publicação não encontrada');
    const rows = await this.deps.feed.listComments(found.post.id, { limit: 500 });
    const [names, reports] = await Promise.all([this.usernames(rows.map((r) => r.authorId)), this.deps.feed.openReportCounts([], rows.map((r) => r.id))]);
    return {
      items: rows.map((c) => ({ id: c.id, postId: c.postId, body: c.body, gifUrl: c.gifUrl ?? null, createdAt: c.createdAt, author: { id: c.authorId, username: names.get(c.authorId) ?? '(removido)' }, openReportsCount: reports.comments.get(c.id) ?? 0 })),
    };
  }

  /** Tira uma publicação do feed (com fotos, comentários e denúncias). Motivo obrigatório. */
  async deleteFeedPost(actor: Actor, postId: unknown, note: unknown): Promise<{ deleted: true }> {
    this.assertAdmin(actor);
    const reason = noteText(note, true);
    const found = typeof postId === 'string' && postId.length > 0 && postId.length <= 64 ? await this.deps.feed.findPost(postId) : undefined;
    if (typeof postId !== 'string' || postId.length > 64 || !(await this.deps.feed.deletePost(postId))) throw notFound('Publicação não encontrada');
    await this.log(actor.userId, 'FEED_POST_REMOVED', 'FEED_POST', postId, reason, found ? await this.contentExtra(found.post.authorId, found.post.body) : {});
    return { deleted: true };
  }

  /** Tira um comentário do feed (com as denúncias dele). Motivo obrigatório. */
  async deleteFeedComment(actor: Actor, commentId: unknown, note: unknown): Promise<{ deleted: true }> {
    this.assertAdmin(actor);
    const reason = noteText(note, true);
    const found = typeof commentId === 'string' && commentId.length > 0 && commentId.length <= 64 ? await this.deps.feed.findComment(commentId) : undefined;
    if (typeof commentId !== 'string' || commentId.length > 64 || !(await this.deps.feed.deleteComment(commentId))) throw notFound('Comentário não encontrado');
    await this.log(actor.userId, 'FEED_COMMENT_REMOVED', 'FEED_COMMENT', commentId, reason, found ? await this.contentExtra(found.authorId, found.body) : {});
    return { deleted: true };
  }

  async feedReports(actor: Actor, query: { status?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminFeedReportRow>> {
    this.assertAdmin(actor);
    const open = query.status !== 'resolved';
    return this.paged(query, async (page) => {
      const reports = await this.deps.feed.listReports(open, page);
      if (reports.length === 0) return [];
      const postIds = [...new Set(reports.map((r) => r.postId))];
      const found = (await Promise.all(postIds.map((id) => this.deps.feed.findPost(id)))).flatMap((f) => (f ? [f] : []));
      const posts = new Map((await this.feedPostRows(found)).map((p) => [p.id, p]));
      const commentIds = reports.flatMap((r) => (r.commentId ? [r.commentId] : []));
      const alive = new Set((await Promise.all(commentIds.map((id) => this.deps.feed.findComment(id)))).flatMap((c) => (c ? [c.id] : [])));
      const people = new Map<string, { username: string; status: UserStatus }>();
      for (const id of new Set(reports.flatMap((r) => [r.reporterId, r.reportedUserId]))) {
        const [user, profile] = await Promise.all([this.deps.users.findById(id), this.deps.users.findProfileById(id)]);
        people.set(id, { username: profile?.username ?? '(removido)', status: user?.status ?? 'ACTIVE' });
      }
      return reports.map((r) => ({
        id: r.id, kind: r.kind, reason: r.reason, details: r.details, evidence: r.evidence, createdAt: r.createdAt,
        reporter: { id: r.reporterId, username: people.get(r.reporterId)?.username ?? '(removido)' },
        reported: { id: r.reportedUserId, username: people.get(r.reportedUserId)?.username ?? '(removido)', status: people.get(r.reportedUserId)?.status ?? 'ACTIVE' },
        post: posts.get(r.postId) ?? null,
        commentId: r.commentId,
        commentAlive: r.commentId !== null && alive.has(r.commentId),
        resolvedAt: r.resolvedAt ?? null, resolution: r.resolution ?? null, resolutionNote: r.resolutionNote ?? null,
      }));
    }, () => this.deps.feed.countReports(open));
  }

  async resolveFeedReport(actor: Actor, reportId: unknown, resolution: unknown, note: unknown): Promise<{ resolved: true }> {
    this.assertAdmin(actor);
    const res = this.parseResolution(resolution);
    const text = noteText(note, false);
    const report = typeof reportId === 'string' && reportId.length <= 64 ? await this.deps.feed.findReport(reportId) : undefined;
    if (!report) throw notFound('Denúncia não encontrada');
    if (!(await this.deps.feed.resolveReport(report.id, actor.userId, res, text, this.deps.clock.now()))) throw conflict('Esta denúncia já foi decidida');
    await this.log(actor.userId, res === 'DISMISSED' ? 'REPORT_DISMISSED' : 'REPORT_ACTIONED', 'FEED_REPORT', report.id, text, { targetLabel: await this.userLabel(report.reportedUserId) });
    return { resolved: true };
  }

  // ---------- Auditoria ----------

  /** Filtros: `q` (texto), `action`, `actorKind` (ADMIN/USER/SYSTEM), `targetType`, `actorId`, `targetId`, `from`/`to` (AAAA-MM-DD, horário de Brasília). */
  async audit(actor: Actor, query: AuditQuery): Promise<AdminPage<AuditRow>> {
    this.assertAdmin(actor);
    const filter = auditFilterOf(query);
    return this.paged(query, (page) => this.deps.admin.listAudit(page, filter), () => this.deps.admin.countAudit(filter), ADMIN_SORTS.audit);
  }

  /** Autor e trecho do conteúdo apagado: a auditoria continua dizendo o que era depois que some. */
  private async contentExtra(authorId: string, text: string | null | undefined): Promise<AuditExtra> {
    const author = (await this.userLabel(authorId)) ?? '(removido)';
    const excerpt = snippet(text);
    return { targetLabel: excerpt ? `${author}: “${excerpt}”` : author, changes: diffOf({ author: 'autor', text: 'conteúdo' }, { author, text: snippet(text, 500) }, {}) };
  }
}
