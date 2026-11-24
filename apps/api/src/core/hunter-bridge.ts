import { automatedPublishGate } from './automated-publish-gate.ts';
import type { ClaimStatusLike, PublishDenied } from './automated-publish-gate.ts';
import { conflict, notFound, validationError } from './errors.ts';
import type { EventKind } from './types.ts';

/**
 * Ponte com o AskouT Hunter, sistema SEPARADO que descobre eventos e os publica aqui por endpoints de serviço.
 * Tudo do Hunter neste lado fica neste arquivo, em `http/hunter/` e na tabela `HunterEventLink`: dá para desligar (a chave
 * `hunter.enabled`) ou remover sem tocar no resto do app. A IA do Hunter não escreve no banco: quem aplica a regra de
 * propriedade e grava é este código, dentro de uma transação, na hora de publicar.
 */
export const HUNTER_EVENT_KINDS: readonly EventKind[] = ['DIGITAL', 'SHOW', 'CINEMA', 'THEATER', 'EXHIBITION', 'GASTRONOMY', 'NIGHT', 'OUTDOOR', 'SPORT', 'OTHER'];

export interface HunterVenueState {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  externalKey: string | null;
  ownerId: string | null;
  claimStatuses: ClaimStatusLike[];
}

export interface HunterEventFields {
  venueId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  kind: EventKind;
  isFree: boolean;
  imageUrl: string | null;
  tags: string[];
  ticketUrl: string | null;
}

export interface HunterLink {
  ref: string;
  eventId: string;
  venueId: string;
}

/** Operações dentro de uma transação (o armazenamento garante que o local fica travado enquanto ela dura). */
export interface HunterTx {
  venue(venueId: string): Promise<HunterVenueState | undefined>;
  link(ref: string): Promise<HunterLink | undefined>;
  createEvent(eventId: string, link: HunterLink, fields: HunterEventFields): Promise<void>;
  updateEvent(eventId: string, fields: Omit<HunterEventFields, 'venueId'>): Promise<void>;
  deleteEvent(eventId: string): Promise<void>;
  /** Eventos do local que começam entre `from` (inclusive) e `to` (exclusivo), de qualquer origem (dono, usuário ou Hunter). */
  eventsStartingBetween(venueId: string, from: Date, to: Date): Promise<{ id: string; title: string }[]>;
}

export interface HunterListItem {
  ref: string;
  eventId: string;
  title: string;
  venueId: string;
  venueName: string;
  startsAt: Date;
  createdAt: Date;
}

export interface HunterStore {
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean, adminId: string, at: Date): Promise<void>;
  venueByExternalKey(key: string): Promise<HunterVenueState | undefined>;
  searchVenues(text: string, center: { lat: number; lng: number } | undefined, radiusM: number, limit: number): Promise<HunterVenueState[]>;
  transaction<T>(venueId: string, run: (tx: HunterTx) => Promise<T>): Promise<T>;
  findLink(ref: string): Promise<(HunterLink & { eventStartsAt: Date }) | undefined>;
  listLinks(limit: number, offset: number): Promise<{ total: number; items: HunterListItem[] }>;
  /** Apaga os eventos (e as ligações) pelas referências. Devolve quantos saíram. */
  deleteByRefs(refs: string[]): Promise<number>;
  allRefs(): Promise<string[]>;
  /** Número de pessoas por célula de grade (graus), só células com pelo menos `minUsers`. */
  regionCells(cellDeg: number, minUsers: number): Promise<{ lat: number; lng: number; users: number }[]>;
  audit(adminId: string, action: string, targetId: string, note: string | null, at: Date): Promise<void>;
}

export interface HunterDeps {
  store: HunterStore;
  /** Token de serviço configurado no servidor (HUNTER_SERVICE_TOKEN). Ausente: a ponte fica inativa. */
  serviceToken: string | undefined;
  clock: { now(): Date };
  newEventId(ref: string): string;
}

export type HunterRefusal = PublishDenied | 'DISABLED' | 'DUPLICATE';

const normTitle = (t: string): string => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Dia de São Paulo (UTC-3, sem horário de verão) que contém o instante: [início, fim) em UTC. */
export function saoPauloDayWindow(at: Date): { from: Date; to: Date } {
  const shifted = new Date(at.getTime() - 3 * 3_600_000);
  const startUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) + 3 * 3_600_000;
  return { from: new Date(startUtc), to: new Date(startUtc + 24 * 3_600_000) };
}

const REF_RE = /^[A-Za-z0-9:_.\-]{6,120}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown, field: string, max: number, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw validationError('Dados inválidos', { [field]: 'Obrigatório' });
    return null;
  }
  if (typeof value !== 'string') throw validationError('Dados inválidos', { [field]: 'Texto inválido' });
  const t = value.trim();
  if (t === '' && required) throw validationError('Dados inválidos', { [field]: 'Obrigatório' });
  if (Array.from(t).length > max) throw validationError('Dados inválidos', { [field]: `Use até ${max} caracteres` });
  return t === '' ? null : t;
}

function httpsUrl(value: unknown, field: string): string | null {
  const t = text(value, field, 500, false);
  if (t === null) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:') throw new Error('x');
    return u.toString();
  } catch {
    throw validationError('Dados inválidos', { [field]: 'Use um endereço https' });
  }
}

function date(value: unknown, field: string): Date {
  const d = typeof value === 'string' ? new Date(value) : undefined;
  if (!d || Number.isNaN(d.getTime())) throw validationError('Dados inválidos', { [field]: 'Data inválida' });
  return d;
}

function tags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw validationError('Dados inválidos', { tags: 'Lista inválida' });
  return [...new Set(value.filter((t): t is string => typeof t === 'string').map((t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '')).filter((t) => t.length > 0 && t.length <= 30))].slice(0, 8);
}

/** Valida os campos de um evento vindo do Hunter (nunca confia no que chega). `now` evita publicar evento já encerrado. */
export function parseHunterEvent(input: Record<string, unknown>, now: Date, requireVenue: boolean): HunterEventFields {
  const venueId = typeof input.venueId === 'string' && UUID_RE.test(input.venueId) ? input.venueId : '';
  if (requireVenue && !venueId) throw validationError('Dados inválidos', { venueId: 'Local inválido' });
  const startsAt = date(input.startsAt, 'startsAt');
  const endsAt = date(input.endsAt, 'endsAt');
  if (endsAt.getTime() <= startsAt.getTime()) throw validationError('Dados inválidos', { endsAt: 'O fim precisa ser depois do começo' });
  if (endsAt.getTime() <= now.getTime()) throw validationError('Dados inválidos', { endsAt: 'O evento já terminou' });
  const kind = typeof input.kind === 'string' && (HUNTER_EVENT_KINDS as readonly string[]).includes(input.kind) ? (input.kind as EventKind) : 'OTHER';
  return {
    venueId,
    title: text(input.title, 'title', 120, true) as string,
    description: text(input.description, 'description', 1500, false),
    startsAt,
    endsAt,
    kind,
    isFree: input.isFree === true,
    imageUrl: httpsUrl(input.imageUrl, 'imageUrl'),
    tags: tags(input.tags),
    ticketUrl: httpsUrl(input.ticketUrl, 'ticketUrl'),
  };
}

export type HunterResult<T> = ({ ok: true } & T) | { ok: false; refusal: HunterRefusal };

export class HunterBridge {
  private readonly deps: HunterDeps;

  constructor(deps: HunterDeps) {
    this.deps = deps;
  }

  /** O token de serviço confere? (comparação feita por quem chama, em tempo constante). */
  get serviceToken(): string | undefined {
    return this.deps.serviceToken;
  }

  isEnabled(): Promise<boolean> {
    return this.deps.store.isEnabled();
  }

  /** Consulta o local pela chave do Google (`google:ID`) ou por nome, já com o veredito da regra de propriedade. */
  async lookupVenues(query: { externalKey?: unknown; q?: unknown; lat?: unknown; lng?: unknown }): Promise<{ venues: (HunterVenueState & { canPublish: boolean; denied: PublishDenied | null })[] }> {
    const key = typeof query.externalKey === 'string' ? query.externalKey.trim() : '';
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 80) : '';
    if (!key && !q) throw validationError('Informe externalKey ou q');
    let found: HunterVenueState[];
    if (key) {
      const v = await this.deps.store.venueByExternalKey(key.slice(0, 200));
      found = v ? [v] : [];
    } else {
      const lat = Number(query.lat);
      const lng = Number(query.lng);
      const center = Number.isFinite(lat) && Number.isFinite(lng) && query.lat !== undefined && query.lng !== undefined ? { lat, lng } : undefined;
      found = await this.deps.store.searchVenues(q, center, 40_000, 10);
    }
    return {
      venues: found.map((v) => {
        const gate = automatedPublishGate(v, v.claimStatuses);
        return { ...v, canPublish: gate.allowed, denied: gate.allowed ? null : gate.reason };
      }),
    };
  }

  private refExists(ref: unknown): string {
    if (typeof ref !== 'string' || !REF_RE.test(ref)) throw validationError('Dados inválidos', { ref: 'Referência inválida (6 a 120 letras, números, : _ . -)' });
    return ref;
  }

  /** Cria o evento. Idempotente pela referência: repetir o pedido devolve o evento já criado. */
  async create(input: Record<string, unknown>): Promise<HunterResult<{ eventId: string; created: boolean }>> {
    if (!(await this.isEnabled())) return { ok: false, refusal: 'DISABLED' };
    const ref = this.refExists(input.ref);
    const fields = parseHunterEvent(input, this.deps.clock.now(), true);
    return this.deps.store.transaction(fields.venueId, async (tx) => {
      const existing = await tx.link(ref);
      if (existing) return { ok: true as const, eventId: existing.eventId, created: false };
      const v = await tx.venue(fields.venueId);
      const gate = automatedPublishGate(v, v ? v.claimStatuses : null);
      if (!gate.allowed) return { ok: false as const, refusal: gate.reason };
      // Mesmo local + mesmo dia + mesmo título (sem acento/caixa) já existe no AskouT, venha de onde vier: não duplica.
      const day = saoPauloDayWindow(fields.startsAt);
      const sameDay = await tx.eventsStartingBetween(fields.venueId, day.from, day.to);
      if (sameDay.some((e) => normTitle(e.title) === normTitle(fields.title))) return { ok: false as const, refusal: 'DUPLICATE' as const };
      const eventId = this.deps.newEventId(ref);
      await tx.createEvent(eventId, { ref, eventId, venueId: fields.venueId }, fields);
      return { ok: true as const, eventId, created: true };
    });
  }

  /** Atualiza um evento que o Hunter criou, se o local continua sem responsável. */
  async update(refInput: unknown, input: Record<string, unknown>): Promise<HunterResult<{ eventId: string }>> {
    if (!(await this.isEnabled())) return { ok: false, refusal: 'DISABLED' };
    const ref = this.refExists(refInput);
    const link = await this.deps.store.findLink(ref);
    if (!link) throw notFound('Evento do Hunter não encontrado');
    const { venueId: _ignored, ...fields } = parseHunterEvent({ ...input, venueId: link.venueId }, this.deps.clock.now(), false);
    return this.deps.store.transaction(link.venueId, async (tx) => {
      const v = await tx.venue(link.venueId);
      const gate = automatedPublishGate(v, v ? v.claimStatuses : null);
      if (!gate.allowed) return { ok: false as const, refusal: gate.reason };
      await tx.updateEvent(link.eventId, fields);
      return { ok: true as const, eventId: link.eventId };
    });
  }

  /** Despublica (apaga) um evento que o Hunter criou, só se o local continua sem responsável. */
  async cancel(refInput: unknown): Promise<HunterResult<{ removed: boolean }>> {
    if (!(await this.isEnabled())) return { ok: false, refusal: 'DISABLED' };
    const ref = this.refExists(refInput);
    const link = await this.deps.store.findLink(ref);
    if (!link) return { ok: true, removed: false };
    return this.deps.store.transaction(link.venueId, async (tx) => {
      const v = await tx.venue(link.venueId);
      const gate = automatedPublishGate(v, v ? v.claimStatuses : null);
      if (!gate.allowed) return { ok: false as const, refusal: gate.reason };
      await tx.deleteEvent(link.eventId);
      return { ok: true as const, removed: true };
    });
  }

  async status(refInput: unknown): Promise<{ exists: boolean; eventId: string | null; startsAt: string | null }> {
    const ref = this.refExists(refInput);
    const link = await this.deps.store.findLink(ref);
    return { exists: !!link, eventId: link?.eventId ?? null, startsAt: link ? link.eventStartsAt.toISOString() : null };
  }

  /** Pessoas por região, só números agregados (grade de ~11 km) e só onde há gente suficiente para não identificar ninguém. */
  async regions(minUsersInput: unknown): Promise<{ cellDegrees: number; minUsers: number; cells: { lat: number; lng: number; users: number }[] }> {
    const asked = typeof minUsersInput === 'string' && /^\d{1,4}$/.test(minUsersInput) ? Number(minUsersInput) : 5;
    const minUsers = Math.max(asked, 3);
    return { cellDegrees: 0.1, minUsers, cells: await this.deps.store.regionCells(0.1, minUsers) };
  }

  // ----- Gestão (o controller já exigiu conta ADMIN) -----

  async adminOverview(limit: number, offset: number): Promise<{ enabled: boolean; serviceConfigured: boolean; total: number; items: { ref: string; eventId: string; title: string; venueId: string; venueName: string; startsAt: string; createdAt: string }[] }> {
    const { total, items } = await this.deps.store.listLinks(limit, offset);
    return {
      enabled: await this.isEnabled(),
      serviceConfigured: !!this.deps.serviceToken,
      total,
      items: items.map((i) => ({ ref: i.ref, eventId: i.eventId, title: i.title, venueId: i.venueId, venueName: i.venueName, startsAt: i.startsAt.toISOString(), createdAt: i.createdAt.toISOString() })),
    };
  }

  async setEnabled(adminId: string, enabled: unknown): Promise<{ enabled: boolean }> {
    if (typeof enabled !== 'boolean') throw validationError('Dados inválidos', { enabled: 'Use true ou false' });
    if (enabled && !this.deps.serviceToken) throw conflict('Defina HUNTER_SERVICE_TOKEN no servidor antes de ligar o Hunter');
    const at = this.deps.clock.now();
    await this.deps.store.setEnabled(enabled, adminId, at);
    await this.deps.store.audit(adminId, enabled ? 'HUNTER_ENABLED' : 'HUNTER_DISABLED', 'hunter', null, at);
    return { enabled };
  }

  /** Busca manual no Hunter pedida pela gestão: fica na auditoria com o resultado. */
  async auditSync(adminId: string, result: { seen?: number; published?: number; review?: number; rejected?: number; error?: string }): Promise<void> {
    const note = result.error
      ? `Falhou: ${result.error}`.slice(0, 400)
      : `${result.seen ?? 0} visto(s), ${result.published ?? 0} publicado(s), ${result.review ?? 0} em revisão, ${result.rejected ?? 0} recusado(s)`;
    await this.deps.store.audit(adminId, 'HUNTER_SYNC_RUN', 'sync', note, this.deps.clock.now());
  }

  /** Remove um evento do Hunter (ref) ou todos (ref ausente). Não depende de o Hunter estar ligado. */
  async adminRemove(adminId: string, ref: string | undefined): Promise<{ removed: number }> {
    const refs = ref === undefined ? await this.deps.store.allRefs() : [this.refExists(ref)];
    const removed = await this.deps.store.deleteByRefs(refs);
    await this.deps.store.audit(adminId, ref === undefined ? 'HUNTER_EVENTS_REMOVED_ALL' : 'HUNTER_EVENT_REMOVED', ref ?? 'all', `${removed} evento(s)`, this.deps.clock.now());
    return { removed };
  }
}
