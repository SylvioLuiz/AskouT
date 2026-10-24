import { conflict, DomainError, notFound, validationError } from './errors.ts';
import { parseIcs, plainText } from './ical.ts';
import type { IcsOccurrence } from './ical.ts';
import { CalendarFetchError } from './ports.ts';
import type { CoreDeps } from './ports.ts';
import type { CalendarDraftRecord, CalendarDraftStatus, EventKind, VenueCalendarRecord, VenueRecord } from './types.ts';
import { parseTicketUrl, VENUE_EVENT_DESCRIPTION_MAX, VENUE_EVENT_MAX_DAYS, VENUE_EVENT_TITLE_MAX } from './venue-service.ts';
import type { VenueEventInput, VenueService } from './venue-service.ts';

export const CALENDAR_LEAD_MIN = 1;
export const CALENDAR_LEAD_MAX = 30;
export const CALENDAR_LEAD_DEFAULT = 7;
export const CALENDAR_URL_MAX = 500;
/** De quanto em quanto tempo cada agenda é lida de novo. */
export const CALENDAR_SYNC_EVERY_MS = 6 * 3_600_000;
/** Intervalo mínimo entre dois "Atualizar agora". */
export const CALENDAR_MANUAL_COOLDOWN_MS = 60_000;
/** O pedido de aprovação chega este tempo antes de o evento subir. */
export const CALENDAR_NOTIFY_BEFORE_MS = 24 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
/** Quantos dias além da data de subir a leitura enxerga, para o rascunho existir antes do aviso. */
const READ_EXTRA_DAYS = 3;
const READ_MAX_EVENTS = 100;
const BATCH = 100;
const TIME_ZONE = 'America/Sao_Paulo';

export interface CalendarView {
  /** Só o site, sem o caminho: o endereço inteiro é um segredo de quem administra. */
  host: string;
  leadDays: number;
  enabled: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  lastFound: number;
}

export interface CalendarDraftView {
  id: string;
  title: string;
  description: string;
  kind: EventKind;
  startsAt: string;
  endsAt: string;
  isFree: boolean;
  imageUrl: string | null;
  tags: string[];
  ticketUrl: string | null;
  /** Quando o evento sobe no AskouT (depois de aprovado). */
  publishAt: string;
  status: Exclude<CalendarDraftStatus, 'PUBLISHED' | 'DISMISSED'>;
  /** O dono já mexeu: a agenda não sobrescreve mais. */
  edited: boolean;
}

export interface CalendarPanelView {
  calendar: CalendarView | null;
  drafts: CalendarDraftView[];
}

export interface CalendarRunResult {
  expired: number;
  synced: number;
  notified: number;
  published: number;
}

const ACTIVE: CalendarDraftStatus[] = ['WAITING', 'AWAITING', 'APPROVED'];

/** Aceita https:// e webcal:// (que o Google Agenda e o Apple mostram); devolve sempre https. */
export function normalizeCalendarUrl(value: unknown): string {
  const bad = (message: string) => validationError('Agenda inválida', { url: message });
  if (typeof value !== 'string') throw bad('Cole o endereço da agenda');
  let raw = value.trim();
  if (raw === '') throw bad('Cole o endereço da agenda');
  if (raw.length > CALENDAR_URL_MAX) throw bad('Endereço grande demais');
  if (/^webcal:\/\//i.test(raw)) raw = `https://${raw.slice('webcal://'.length)}`;
  if (!/^https:\/\/[^\s]+$/i.test(raw)) throw bad('Use o endereço completo, começando com https:// ou webcal://');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw bad('Endereço inválido');
  }
  if (url.username !== '' || url.password !== '') throw bad('O endereço não pode ter usuário e senha');
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw bad('Use o endereço público da agenda');
  return url.toString();
}

function leadOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < CALENDAR_LEAD_MIN || value > CALENDAR_LEAD_MAX) {
    throw validationError('Agenda inválida', { leadDays: `Escolha de ${CALENDAR_LEAD_MIN} a ${CALENDAR_LEAD_MAX} dias de antecedência` });
  }
  return value;
}

function clip(value: string, max: number): string {
  const chars = Array.from(value.trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

const WHEN = new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, weekday: 'short', day: '2-digit', month: '2-digit' });

function when(d: Date): string {
  return WHEN.format(d).replace(',', '');
}

/**
 * Importa os eventos da agenda (iCal / Google Agenda) de um estabelecimento. Nada sobe sozinho: cada evento vira um
 * rascunho, o dono recebe o pedido de aprovação um dia antes da data de subir (com a prévia) e pode editar tudo.
 * Só o que foi aprovado vira evento do local, na data escolhida.
 */
export class CalendarImportService {
  private readonly deps: CoreDeps;
  private readonly venues: VenueService;

  constructor(deps: CoreDeps, venues: VenueService) {
    this.deps = deps;
    this.venues = venues;
  }

  // ---- Do dono do local ----

  async panel(userId: string, venueId: unknown): Promise<CalendarPanelView> {
    const venue = await this.owned(userId, venueId);
    return this.view(venue.id);
  }

  /** Liga (ou muda) a agenda. Endereço novo é lido na hora: se não for uma agenda, nada é salvo. */
  async save(userId: string, venueId: unknown, input: { url?: unknown; leadDays?: unknown; enabled?: unknown }): Promise<CalendarPanelView> {
    const venue = await this.owned(userId, venueId);
    if (typeof input !== 'object' || input === null) throw validationError('Agenda inválida', { url: 'Dados inválidos' });
    const current = await this.deps.calendars.getConfig(venue.id);
    const now = this.deps.clock.now();
    const leadDays = input.leadDays === undefined ? (current?.leadDays ?? CALENDAR_LEAD_DEFAULT) : leadOf(input.leadDays);
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw validationError('Agenda inválida', { enabled: 'Informe se está ligada' });
    const enabled = input.enabled === undefined ? (current?.enabled ?? true) : input.enabled;
    const url = input.url === undefined || input.url === '' ? undefined : normalizeCalendarUrl(input.url);
    if (url === undefined && !current) throw validationError('Agenda inválida', { url: 'Cole o endereço da agenda' });

    if (url !== undefined && url !== current?.url) {
      // Endereço novo: confere antes de guardar e troca os rascunhos antigos pelos da nova agenda.
      const read = await this.read(url, now, leadDays);
      if (current) await this.deps.calendars.deleteConfig(venue.id);
      const config: VenueCalendarRecord = { venueId: venue.id, url, leadDays, enabled, lastSyncAt: now, lastError: null, lastFound: read.length, createdAt: current?.createdAt ?? now };
      await this.deps.calendars.saveConfig(config);
      await this.apply(venue, config, read, now);
      return this.view(venue.id);
    }

    const config: VenueCalendarRecord = { ...(current as VenueCalendarRecord), leadDays, enabled };
    await this.deps.calendars.saveConfig(config);
    if (current && leadDays !== current.leadDays) await this.reschedule(venue.id, leadDays, now);
    return this.view(venue.id);
  }

  async remove(userId: string, venueId: unknown): Promise<{ removed: true }> {
    const venue = await this.owned(userId, venueId);
    await this.deps.calendars.deleteConfig(venue.id);
    return { removed: true };
  }

  /** "Atualizar agora". */
  async syncNow(userId: string, venueId: unknown): Promise<CalendarPanelView> {
    const venue = await this.owned(userId, venueId);
    const config = await this.deps.calendars.getConfig(venue.id);
    if (!config) throw notFound('Este local não tem agenda ligada');
    const now = this.deps.clock.now();
    if (config.lastSyncAt && now.getTime() - config.lastSyncAt.getTime() < CALENDAR_MANUAL_COOLDOWN_MS) throw conflict('A agenda acabou de ser atualizada. Tente de novo em um minuto.');
    await this.syncOne(config);
    return this.view(venue.id);
  }

  async editDraft(userId: string, venueId: unknown, draftId: unknown, input: VenueEventInput): Promise<CalendarDraftView> {
    const venue = await this.owned(userId, venueId);
    const draft = await this.draftOf(venue.id, draftId);
    if (!ACTIVE.includes(draft.status)) throw conflict('Este evento já foi publicado ou dispensado');
    const config = await this.deps.calendars.getConfig(venue.id);
    const fields = this.venues.checkEventInput({ imageUrl: draft.imageUrl, ...input }, draft.startsAt);
    const next: CalendarDraftRecord = {
      ...draft,
      title: fields.title,
      description: fields.description,
      kind: fields.kind,
      startsAt: fields.startsAt,
      endsAt: fields.endsAt,
      isFree: fields.isFree,
      imageUrl: fields.imageUrl,
      tags: fields.tags,
      ticketUrl: fields.ticketUrl,
      publishAt: this.publishAt(fields.startsAt, config?.leadDays ?? CALENDAR_LEAD_DEFAULT),
      edited: true,
      updatedAt: this.deps.clock.now(),
    };
    await this.deps.calendars.updateDraft(next);
    return this.draftView(next);
  }

  /** Aprova: sobe na data escolhida (ou já, se a data de subir já chegou). */
  async approve(userId: string, venueId: unknown, draftId: unknown): Promise<CalendarDraftView | { published: true; eventId: string }> {
    const venue = await this.owned(userId, venueId);
    const draft = await this.draftOf(venue.id, draftId);
    const now = this.deps.clock.now();
    if (draft.startsAt.getTime() <= now.getTime()) throw conflict('Este evento já começou');
    if (!(await this.deps.calendars.moveDraft(draft.id, ['WAITING', 'AWAITING'], 'APPROVED', { at: now }))) {
      if (draft.status === 'APPROVED') return this.draftView(draft);
      throw conflict('Este evento já foi publicado ou dispensado');
    }
    const approved = { ...draft, status: 'APPROVED' as const };
    if (draft.publishAt.getTime() <= now.getTime()) {
      const eventId = await this.publish(venue, approved, now);
      if (eventId) return { published: true, eventId };
      throw conflict('Não foi possível publicar este evento. Edite os dados e tente de novo.');
    }
    return this.draftView(approved);
  }

  async dismiss(userId: string, venueId: unknown, draftId: unknown): Promise<{ dismissed: true }> {
    const venue = await this.owned(userId, venueId);
    const draft = await this.draftOf(venue.id, draftId);
    if (!(await this.deps.calendars.moveDraft(draft.id, ACTIVE, 'DISMISSED', { at: this.deps.clock.now() })) && draft.status !== 'DISMISSED') throw conflict('Este evento já foi publicado');
    return { dismissed: true };
  }

  // ---- Do servidor (job) ----

  async runDue(): Promise<CalendarRunResult> {
    const now = this.deps.clock.now();
    const expired = await this.deps.calendars.expire(now);
    let synced = 0;
    for (const config of await this.deps.calendars.listToSync(new Date(now.getTime() - CALENDAR_SYNC_EVERY_MS), BATCH)) {
      if (await this.syncOne(config)) synced += 1;
    }
    const notified = await this.notifyDue(now);
    const published = await this.publishDue(now);
    return { expired, synced, notified, published };
  }

  /** Lê a agenda de um local e atualiza os rascunhos. Falha de leitura fica anotada, sem apagar nada. */
  private async syncOne(config: VenueCalendarRecord): Promise<boolean> {
    const now = this.deps.clock.now();
    const venue = await this.deps.places.findVenue(config.venueId);
    if (!venue || !venue.ownerId) {
      await this.deps.calendars.saveConfig({ ...config, enabled: false, lastSyncAt: now, lastError: 'Este local ficou sem responsável' });
      return false;
    }
    try {
      const found = await this.read(config.url, now, config.leadDays);
      const updated = { ...config, lastSyncAt: now, lastError: null, lastFound: found.length };
      await this.deps.calendars.saveConfig(updated);
      await this.apply(venue, updated, found, now);
      return true;
    } catch (error) {
      const message = error instanceof DomainError ? (error.details?.['url'] ?? error.message) : 'Não foi possível ler a agenda';
      await this.deps.calendars.saveConfig({ ...config, lastSyncAt: now, lastError: clip(message, 200) });
      return false;
    }
  }

  /** Baixa e entende a agenda; devolve os eventos da janela de interesse. */
  private async read(url: string, now: Date, leadDays: number): Promise<IcsOccurrence[]> {
    let body: string;
    try {
      body = await this.deps.calendarFetcher.fetch(url);
    } catch (error) {
      if (error instanceof CalendarFetchError) throw validationError('Agenda inválida', { url: error.message });
      throw validationError('Agenda inválida', { url: 'Não foi possível abrir a agenda' });
    }
    const result = parseIcs(body, { from: now, to: new Date(now.getTime() + (leadDays + READ_EXTRA_DAYS) * DAY_MS), max: READ_MAX_EVENTS });
    if (!result.isCalendar) throw validationError('Agenda inválida', { url: 'Esse endereço não devolveu uma agenda iCal. No Google Agenda, use o "endereço secreto no formato iCal".' });
    return result.events;
  }

  /** Cria e atualiza rascunhos a partir do que a agenda trouxe. */
  private async apply(venue: VenueRecord, config: VenueCalendarRecord, found: IcsOccurrence[], now: Date): Promise<void> {
    const existingEvents = await this.deps.places.listVenueEvents(venue.id);
    const taken = new Set(existingEvents.map((e) => `${e.title.trim().toLowerCase()}|${e.startsAt.getTime()}`));
    const seen = new Set<string>();
    for (const occ of found) {
      const title = clip(plainText(occ.summary), VENUE_EVENT_TITLE_MAX);
      if (title === '') continue;
      const occKey = `${occ.uid}|${occ.originalStart.toISOString()}`;
      seen.add(occKey);
      const startsAt = occ.start;
      let endsAt = occ.end;
      if (endsAt.getTime() <= startsAt.getTime()) endsAt = new Date(startsAt.getTime() + 3 * 3_600_000);
      if (endsAt.getTime() - startsAt.getTime() > VENUE_EVENT_MAX_DAYS * DAY_MS) endsAt = new Date(startsAt.getTime() + VENUE_EVENT_MAX_DAYS * DAY_MS);
      const description = clip(plainText(occ.description ?? ''), VENUE_EVENT_DESCRIPTION_MAX);
      let ticketUrl: string | null = null;
      try {
        ticketUrl = parseTicketUrl(occ.url === null || occ.url === '' ? null : occ.url, null);
      } catch {
        ticketUrl = null;
      }
      const publishAt = this.publishAt(startsAt, config.leadDays);
      const current = await this.deps.calendars.findDraftByKey(venue.id, occKey);
      if (!current) {
        if (taken.has(`${title.toLowerCase()}|${startsAt.getTime()}`)) continue;
        await this.deps.calendars.createDraft({ id: this.deps.ids.next(), venueId: venue.id, occKey, title, description, startsAt, endsAt, kind: 'OTHER', isFree: false, imageUrl: null, tags: [], ticketUrl, publishAt, status: 'WAITING', edited: false, notifiedAt: null, publishedEventId: null, createdAt: now, updatedAt: now });
        continue;
      }
      if (!ACTIVE.includes(current.status) || current.edited) continue;
      const moved = current.startsAt.getTime() !== startsAt.getTime();
      const changed = moved || current.title !== title || current.description !== description || current.endsAt.getTime() !== endsAt.getTime() || current.ticketUrl !== ticketUrl;
      if (!changed) continue;
      // Mudou a data na agenda: o que já tinha sido aprovado volta a pedir aprovação.
      const status: CalendarDraftStatus = moved && current.status === 'APPROVED' ? 'WAITING' : current.status;
      await this.deps.calendars.updateDraft({ ...current, title, description, startsAt, endsAt, ticketUrl, publishAt, status, ...(status === 'WAITING' ? { notifiedAt: null } : {}), updatedAt: now });
    }
    // Saiu da agenda (apagado lá) e o dono não mexeu: sai da fila. Não vale se a leitura bateu no teto.
    if (found.length < READ_MAX_EVENTS) {
      const horizon = now.getTime() + (config.leadDays + READ_EXTRA_DAYS) * DAY_MS;
      for (const draft of await this.deps.calendars.listDrafts(venue.id, ACTIVE)) {
        if (!draft.edited && !seen.has(draft.occKey) && draft.startsAt.getTime() > now.getTime() && draft.startsAt.getTime() <= horizon) {
          await this.deps.calendars.moveDraft(draft.id, ACTIVE, 'DISMISSED', { at: now });
        }
      }
    }
  }

  /** Muda os dias de antecedência: refaz a data de subir do que ainda não subiu. */
  private async reschedule(venueId: string, leadDays: number, now: Date): Promise<void> {
    for (const draft of await this.deps.calendars.listDrafts(venueId, ACTIVE)) {
      await this.deps.calendars.updateDraft({ ...draft, publishAt: this.publishAt(draft.startsAt, leadDays), updatedAt: now });
    }
  }

  /** Pede a aprovação um dia antes de subir (ou já, se a data de subir está a menos de um dia). Um aviso por local. */
  private async notifyDue(now: Date): Promise<number> {
    const due = await this.deps.calendars.listToNotify(new Date(now.getTime() + CALENDAR_NOTIFY_BEFORE_MS), BATCH);
    const byVenue = new Map<string, CalendarDraftRecord[]>();
    for (const draft of due) {
      // Marca antes de avisar: com duas instâncias, o pior caso é não avisar, nunca avisar em dobro.
      if (!(await this.deps.calendars.moveDraft(draft.id, ['WAITING'], 'AWAITING', { notifiedAt: now, at: now }))) continue;
      byVenue.set(draft.venueId, [...(byVenue.get(draft.venueId) ?? []), draft]);
    }
    let sent = 0;
    for (const [venueId, drafts] of byVenue) {
      const venue = await this.deps.places.findVenue(venueId);
      if (!venue?.ownerId) {
        for (const d of drafts) await this.deps.calendars.moveDraft(d.id, ACTIVE, 'DISMISSED', { at: now });
        continue;
      }
      const url = `/bares/${venue.id}/agenda`;
      if (drafts.length === 1) {
        const d = drafts[0]!;
        const goesUp = d.publishAt.getTime() <= now.getTime() ? 'assim que você aprovar' : `em ${when(d.publishAt)}`;
        await this.deps.notifier.notify({ userId: venue.ownerId, type: 'VENUE_CALENDAR', title: `Aprovar "${clip(d.title, 50)}"?`, body: `Acontece ${when(d.startsAt)} e sobe ${goesUp}. Toque para ver a prévia ou editar.`, url, dedupeKey: `venue-calendar:${d.id}` });
      } else {
        const first = drafts.map((d) => d.publishAt.getTime()).sort((a, b) => a - b)[0]!;
        const goesUp = first <= now.getTime() ? 'assim que você aprovar' : `a partir de ${DAY.format(new Date(first))}`;
        await this.deps.notifier.notify({ userId: venue.ownerId, type: 'VENUE_CALENDAR', title: `${drafts.length} eventos para aprovar`, body: `Vêm da agenda de ${clip(venue.name, 40)} e sobem ${goesUp}. Toque para ver as prévias.`, url, dedupeKey: `venue-calendar:${venue.id}:${now.getTime()}` });
      }
      sent += 1;
    }
    return sent;
  }

  /** Sobe o que foi aprovado e já está na data. */
  private async publishDue(now: Date): Promise<number> {
    let published = 0;
    for (const draft of await this.deps.calendars.listToPublish(now, BATCH)) {
      const venue = await this.deps.places.findVenue(draft.venueId);
      if (!venue?.ownerId) {
        await this.deps.calendars.moveDraft(draft.id, ['APPROVED'], 'DISMISSED', { at: now });
        continue;
      }
      if (await this.publish(venue, draft, now)) published += 1;
    }
    return published;
  }

  /** Cria o evento do local a partir do rascunho aprovado. Devolve o id do evento, ou undefined se não deu. */
  private async publish(venue: VenueRecord, draft: CalendarDraftRecord, now: Date): Promise<string | undefined> {
    if (!venue.ownerId) return undefined;
    // Trava antes de criar: o mesmo rascunho nunca vira dois eventos.
    if (!(await this.deps.calendars.moveDraft(draft.id, ['APPROVED'], 'PUBLISHED', { at: now }))) return undefined;
    try {
      const event = await this.venues.createEvent(venue.ownerId, venue.id, {
        title: draft.title,
        description: draft.description,
        kind: draft.kind,
        startsAt: draft.startsAt.toISOString(),
        endsAt: draft.endsAt.toISOString(),
        isFree: draft.isFree,
        imageUrl: draft.imageUrl,
        tags: draft.tags,
        ticketUrl: draft.ticketUrl,
      });
      await this.deps.calendars.moveDraft(draft.id, ['PUBLISHED'], 'PUBLISHED', { publishedEventId: event.id, at: now });
      await this.deps.notifier.notify({ userId: venue.ownerId, type: 'VENUE_CALENDAR', title: `"${clip(draft.title, 50)}" já está no AskouT`, body: `Acontece ${when(draft.startsAt)}.`, url: `/eventos/${event.id}`, dedupeKey: `venue-calendar:${draft.id}:published` });
      return event.id;
    } catch {
      await this.deps.calendars.moveDraft(draft.id, ['PUBLISHED'], 'DISMISSED', { at: now });
      await this.deps.notifier.notify({ userId: venue.ownerId, type: 'VENUE_CALENDAR', title: `Não deu para publicar "${clip(draft.title, 50)}"`, body: 'Confira os dados do evento na agenda do local.', url: `/bares/${venue.id}/agenda`, dedupeKey: `venue-calendar:${draft.id}:failed` });
      return undefined;
    }
  }

  // ---- Apoio ----

  private publishAt(startsAt: Date, leadDays: number): Date {
    return new Date(startsAt.getTime() - leadDays * DAY_MS);
  }

  private async owned(userId: string, venueId: unknown): Promise<VenueRecord> {
    const venue = typeof venueId === 'string' && venueId !== '' && venueId.length <= 64 ? await this.deps.places.findVenue(venueId) : undefined;
    if (!venue || venue.ownerId !== userId) throw notFound('Local não encontrado');
    return venue;
  }

  private async draftOf(venueId: string, draftId: unknown): Promise<CalendarDraftRecord> {
    const draft = typeof draftId === 'string' && draftId !== '' && draftId.length <= 64 ? await this.deps.calendars.findDraft(draftId) : undefined;
    if (!draft || draft.venueId !== venueId) throw notFound('Evento não encontrado');
    return draft;
  }

  private async view(venueId: string): Promise<CalendarPanelView> {
    const config = await this.deps.calendars.getConfig(venueId);
    if (!config) return { calendar: null, drafts: [] };
    const drafts = await this.deps.calendars.listDrafts(venueId, ACTIVE);
    let host = '';
    try {
      host = new URL(config.url).hostname;
    } catch {
      host = '';
    }
    return {
      calendar: { host, leadDays: config.leadDays, enabled: config.enabled, lastSyncAt: config.lastSyncAt?.toISOString() ?? null, lastError: config.lastError, lastFound: config.lastFound },
      drafts: drafts.map((d) => this.draftView(d)),
    };
  }

  private draftView(d: CalendarDraftRecord): CalendarDraftView {
    return { id: d.id, title: d.title, description: d.description, kind: d.kind, startsAt: d.startsAt.toISOString(), endsAt: d.endsAt.toISOString(), isFree: d.isFree, imageUrl: d.imageUrl, tags: d.tags, ticketUrl: d.ticketUrl, publishAt: d.publishAt.toISOString(), status: d.status as CalendarDraftView['status'], edited: d.edited };
  }
}
