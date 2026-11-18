import { normalizeCalendarUrl } from './calendar-import-service.ts';
import { forbidden, notFound, validationError } from './errors.ts';
import { parseIcs } from './ical.ts';
import { CalendarAccessRevoked, CalendarFetchError } from './ports.ts';
import type { BusyIntervalRecord, CoreDeps, OAuthCalendarClient, OAuthCalendarSource, PersonalCalendarChoice, PersonalCalendarConnection, PersonalCalendarSource, PersonalCalendarStatus } from './ports.ts';

/**
 * Sincronizar agendas da pessoa com a agenda do AskouT, como os apps de agenda fazem:
 *  - agenda do celular (o app lê o calendário do aparelho, que já traz as contas Google, Outlook, iCloud ligadas nele);
 *  - Google Agenda (OAuth, só leitura de agendas e de horários livres/ocupados);
 *  - link iCal privado (Outlook, iCloud ou qualquer agenda que publique .ics).
 * Só o início e o fim de cada compromisso são guardados: nunca título, local ou participantes.
 * Os horários ocupados entram na comparação de agendas com amigos (o motivo não sai do servidor).
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Janela importada: de 45 dias atrás (para o mês na tela vir inteiro) até 90 dias para a frente. */
export const SYNC_PAST_DAYS = 45;
export const SYNC_FUTURE_DAYS = 90;
/** Google e iCal são relidos a cada 30 minutos (e na hora, quando a pessoa pede). */
export const RESYNC_MS = 30 * 60_000;
export const MAX_CONNECTIONS = 10;
export const MAX_DEVICE_INTERVALS = 3000;
export const MAX_DEVICE_CALENDARS = 60;
const MAX_INTERVAL_MS = 14 * DAY;
const LABEL_MAX = 60;

export type CalendarSuggestionKind = 'GOOGLE' | 'OUTLOOK' | 'ICLOUD';

export interface CalendarSuggestion {
  kind: CalendarSuggestionKind;
  /** Por que sugerimos: entrou com o Google, ou o e-mail da conta é desse provedor. */
  reason: 'login' | 'email';
}

export interface CalendarConnectionView {
  id: string;
  provider: PersonalCalendarSource;
  status: PersonalCalendarStatus;
  label: string;
  accountEmail: string | null;
  calendars: PersonalCalendarChoice[];
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface CalendarOverview {
  connections: CalendarConnectionView[];
  suggestions: CalendarSuggestion[];
  /** A opção "Google Agenda" (OAuth) está configurada no servidor. */
  googleAvailable: boolean;
  /** A opção "Outlook" (conta Microsoft) está configurada no servidor. */
  microsoftAvailable: boolean;
}

export interface BusyView {
  start: string;
  end: string;
  connectionId: string;
  provider: PersonalCalendarSource;
  label: string;
}

const DEFAULT_LABEL: Record<PersonalCalendarSource, string> = { GOOGLE: 'Google Agenda', MICROSOFT: 'Outlook', DEVICE: 'Agenda do celular', ICS: 'Agenda (iCal)' };
const OAUTH_NAME: Record<OAuthCalendarSource, string> = { GOOGLE: 'a Google Agenda', MICROSOFT: 'o Outlook' };

function labelOf(c: PersonalCalendarConnection): string {
  return c.label ?? DEFAULT_LABEL[c.provider];
}

function toView(c: PersonalCalendarConnection): CalendarConnectionView {
  return {
    id: c.id,
    provider: c.provider,
    status: c.status,
    label: labelOf(c),
    accountEmail: c.accountEmail,
    calendars: c.calendars,
    lastSyncAt: c.lastSyncAt ? c.lastSyncAt.toISOString() : null,
    lastError: c.lastError,
  };
}

/** Pelo domínio do e-mail, qual agenda a pessoa provavelmente usa. */
export function suggestionFromEmail(email: string | null | undefined): CalendarSuggestionKind | undefined {
  const domain = (email ?? '').split('@')[1]?.toLowerCase().trim() ?? '';
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'GOOGLE';
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) return 'OUTLOOK';
  if (domain === 'icloud.com' || domain === 'me.com' || domain === 'mac.com') return 'ICLOUD';
  return undefined;
}

/** Nome da agenda pelo endereço do link iCal. */
export function labelFromIcsUrl(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  if (host.endsWith('google.com')) return 'Google Agenda (iCal)';
  if (host.includes('outlook') || host.includes('office365') || host.includes('live.com') || host.endsWith('office.com')) return 'Outlook';
  if (host.endsWith('icloud.com')) return 'iCloud';
  return host.replace(/^www\./, '');
}

function cleanLabel(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw validationError('Nome inválido', { label: 'Use um texto' });
  const v = value.trim().replace(/\s+/g, ' ');
  if (v === '') return null;
  return v.slice(0, LABEL_MAX);
}

/** Junta horários que se sobrepõem ou se tocam e corta na janela. */
export function mergeBusy(list: readonly BusyIntervalRecord[], from: Date, to: Date): BusyIntervalRecord[] {
  const lo = from.getTime();
  const hi = to.getTime();
  const sorted = list
    .map((i) => ({ start: Math.max(lo, i.start.getTime()), end: Math.min(hi, i.end.getTime()) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out.map((i) => ({ start: new Date(i.start), end: new Date(i.end) }));
}

function parseDeviceCalendars(value: unknown): PersonalCalendarChoice[] {
  if (!Array.isArray(value)) throw validationError('Agendas inválidas', { calendars: 'Envie a lista de agendas' });
  if (value.length > MAX_DEVICE_CALENDARS) throw validationError('Agendas inválidas', { calendars: 'Agendas demais' });
  const seen = new Set<string>();
  const out: PersonalCalendarChoice[] = [];
  for (const raw of value) {
    const c = (raw ?? {}) as Record<string, unknown>;
    if (typeof c['id'] !== 'string' || c['id'] === '' || c['id'].length > 200 || seen.has(c['id'])) continue;
    seen.add(c['id']);
    const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);
    out.push({ id: c['id'], name: text(c['name'], 80) ?? 'Agenda', selected: c['selected'] === true, color: text(c['color'], 20), account: text(c['account'], 120) });
  }
  return out;
}

function parseDeviceIntervals(value: unknown, from: Date, to: Date): BusyIntervalRecord[] {
  if (!Array.isArray(value)) throw validationError('Horários inválidos', { intervals: 'Envie a lista de horários' });
  if (value.length > MAX_DEVICE_INTERVALS) throw validationError('Horários inválidos', { intervals: 'Horários demais' });
  const out: BusyIntervalRecord[] = [];
  for (const raw of value) {
    const i = (raw ?? {}) as Record<string, unknown>;
    const start = typeof i['start'] === 'string' || typeof i['start'] === 'number' ? new Date(i['start']) : undefined;
    const end = typeof i['end'] === 'string' || typeof i['end'] === 'number' ? new Date(i['end']) : undefined;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end <= start || end.getTime() - start.getTime() > MAX_INTERVAL_MS) continue;
    out.push({ start, end });
  }
  return mergeBusy(out, from, to);
}

export class CalendarSyncService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  private window(): { from: Date; to: Date } {
    const now = this.deps.clock.now().getTime();
    return { from: new Date(now - SYNC_PAST_DAYS * DAY), to: new Date(now + SYNC_FUTURE_DAYS * DAY) };
  }

  private async own(userId: string, id: string): Promise<PersonalCalendarConnection> {
    const c = await this.deps.personalCalendars.find(id);
    if (!c) throw notFound('Agenda não encontrada');
    if (c.userId !== userId) throw forbidden('Essa agenda não é sua');
    return c;
  }

  private async ensureRoom(userId: string): Promise<PersonalCalendarConnection[]> {
    const list = await this.deps.personalCalendars.list(userId);
    if (list.length >= MAX_CONNECTIONS) throw validationError(`Você já ligou ${MAX_CONNECTIONS} agendas. Desligue uma para ligar outra.`);
    return list;
  }

  /** Agendas ligadas e as que provavelmente a pessoa tem (para mostrar primeiro). */
  async overview(userId: string): Promise<CalendarOverview> {
    const [list, user, logins] = await Promise.all([
      this.deps.personalCalendars.list(userId),
      this.deps.users.findById(userId),
      this.deps.personalCalendars.loginProvidersOf(userId),
    ]);
    const suggestions: CalendarSuggestion[] = [];
    if (logins.includes('GOOGLE')) suggestions.push({ kind: 'GOOGLE', reason: 'login' });
    const byEmail = suggestionFromEmail(user?.email);
    if (byEmail && !suggestions.some((s) => s.kind === byEmail)) suggestions.push({ kind: byEmail, reason: 'email' });
    return { connections: list.map(toView), suggestions, googleAvailable: this.deps.googleCalendar !== undefined, microsoftAvailable: this.deps.microsoftCalendar !== undefined };
  }

  /** Horários ocupados das agendas ligadas, para a tela da agenda. */
  async busy(userId: string, fromRaw: unknown, toRaw: unknown): Promise<BusyView[]> {
    const from = typeof fromRaw === 'string' ? new Date(fromRaw) : undefined;
    const to = typeof toRaw === 'string' ? new Date(toRaw) : undefined;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw validationError('Período inválido', { from: 'Informe from e to (ISO 8601)' });
    if (to.getTime() - from.getTime() > 120 * DAY) throw validationError('Período longo demais', { to: 'No máximo 120 dias' });
    const rows = await this.deps.personalCalendars.listBusy([userId], from, to);
    return rows.map((r) => ({ start: r.start.toISOString(), end: r.end.toISOString(), connectionId: r.connectionId, provider: r.provider, label: r.label ?? DEFAULT_LABEL[r.provider] }));
  }

  // ---------- Agenda do celular ----------

  /** O app manda as agendas do aparelho (com as escolhidas marcadas) e os horários ocupados delas. Uma conexão por pessoa. */
  async saveDevice(userId: string, body: Record<string, unknown>): Promise<CalendarConnectionView> {
    const { from, to } = this.window();
    const calendars = parseDeviceCalendars(body['calendars']);
    if (!calendars.some((c) => c.selected)) throw validationError('Escolha ao menos uma agenda', { calendars: 'Escolha ao menos uma agenda' });
    const intervals = parseDeviceIntervals(body['intervals'], from, to);
    const list = await this.deps.personalCalendars.list(userId);
    const existing = list.find((c) => c.provider === 'DEVICE');
    if (!existing && list.length >= MAX_CONNECTIONS) await this.ensureRoom(userId);
    const now = this.deps.clock.now();
    const connection: PersonalCalendarConnection = existing
      ? { ...existing, calendars, status: 'ACTIVE', lastSyncAt: now, lastError: null }
      : { id: this.deps.ids.next(), userId, provider: 'DEVICE', status: 'ACTIVE', label: null, accountEmail: null, refreshTokenSealed: null, sourceSealed: null, calendars, lastSyncAt: now, lastError: null, createdAt: now };
    await this.deps.personalCalendars.save(connection);
    await this.deps.personalCalendars.replaceBusy(connection.id, intervals);
    return toView(connection);
  }

  // ---------- Link iCal ----------

  async addIcs(userId: string, body: Record<string, unknown>): Promise<CalendarConnectionView> {
    const url = normalizeCalendarUrl(body['url']);
    const label = cleanLabel(body['label']) ?? labelFromIcsUrl(url);
    const list = await this.ensureRoom(userId);
    const now = this.deps.clock.now();
    for (const c of list.filter((x) => x.provider === 'ICS' && x.sourceSealed)) {
      if (this.deps.secretBox.open(c.sourceSealed!) === url) throw validationError('Essa agenda já está ligada', { url: 'Essa agenda já está ligada' });
    }
    const connection: PersonalCalendarConnection = { id: this.deps.ids.next(), userId, provider: 'ICS', status: 'ACTIVE', label, accountEmail: null, refreshTokenSealed: null, sourceSealed: this.deps.secretBox.seal(url), calendars: [], lastSyncAt: null, lastError: null, createdAt: now };
    // Lê antes de guardar: link errado avisa na hora, sem deixar conexão quebrada.
    const intervals = await this.readIcs(url);
    connection.lastSyncAt = now;
    await this.deps.personalCalendars.save(connection);
    await this.deps.personalCalendars.replaceBusy(connection.id, intervals);
    return toView(connection);
  }

  private async readIcs(url: string): Promise<BusyIntervalRecord[]> {
    const { from, to } = this.window();
    let text: string;
    try {
      text = await this.deps.calendarFetcher.fetch(url);
    } catch (e) {
      throw validationError(e instanceof CalendarFetchError ? e.message : 'Não foi possível ler a agenda', { url: e instanceof CalendarFetchError ? e.message : 'Não foi possível ler a agenda' });
    }
    const parsed = parseIcs(text, { from: new Date(from.getTime() - MAX_INTERVAL_MS), to, max: 5000 });
    if (!parsed.isCalendar) throw validationError('Esse link não é de uma agenda', { url: 'Use o endereço secreto em formato iCal (.ics)' });
    return mergeBusy(parsed.events.map((e) => ({ start: e.start, end: e.end })), from, to);
  }

  // ---------- Contas com login (Google Agenda e Outlook) ----------

  private client(provider: OAuthCalendarSource): OAuthCalendarClient | undefined {
    return provider === 'GOOGLE' ? this.deps.googleCalendar : this.deps.microsoftCalendar;
  }

  /** Endereço da tela de permissão (Google ou Microsoft). `from`: de onde a pessoa veio (o app abre no navegador). */
  async oauthStart(userId: string, providerRaw: unknown, fromRaw: unknown): Promise<{ url: string }> {
    const provider: OAuthCalendarSource = providerRaw === 'MICROSOFT' ? 'MICROSOFT' : 'GOOGLE';
    const client = this.client(provider);
    if (!client) throw validationError(`A ligação com ${OAUTH_NAME[provider]} ainda não está disponível`);
    await this.ensureRoomFor(userId, provider);
    const from = fromRaw === 'app' ? 'app' : 'web';
    return { url: client.authUrl(this.deps.oauthStates.sign({ userId, from, provider })) };
  }

  /** Compatibilidade: começar pela Google Agenda. */
  async googleStart(userId: string, fromRaw: unknown): Promise<{ url: string }> {
    return this.oauthStart(userId, 'GOOGLE', fromRaw);
  }

  private async ensureRoomFor(userId: string, provider: PersonalCalendarSource): Promise<void> {
    const list = await this.deps.personalCalendars.list(userId);
    // Reconectar uma conta já ligada não conta como agenda nova.
    if (list.length >= MAX_CONNECTIONS && !list.some((c) => c.provider === provider)) await this.ensureRoom(userId);
  }

  /** Retorno do Google ou da Microsoft: guarda o acesso (cifrado), lista as agendas da conta e já importa os horários. */
  async oauthCallback(expected: OAuthCalendarSource, query: { code?: unknown; state?: unknown; error?: unknown }): Promise<{ from: 'web' | 'app'; ok: boolean; message?: string }> {
    const name = OAUTH_NAME[expected];
    const state = typeof query.state === 'string' ? this.deps.oauthStates.verify(query.state) : undefined;
    if (!state || (state.provider ?? 'GOOGLE') !== expected) return { from: state?.from ?? 'web', ok: false, message: `O pedido venceu. Tente ligar ${name} de novo.` };
    const client = this.client(expected);
    if (!client) return { from: state.from, ok: false, message: `A ligação com ${name} não está disponível.` };
    if (typeof query.error === 'string' || typeof query.code !== 'string' || query.code === '') {
      return { from: state.from, ok: false, message: query.error === 'access_denied' ? `Você não deu acesso ${expected === 'GOOGLE' ? 'à Google Agenda' : 'ao Outlook'}.` : 'A ligação não foi concluída.' };
    }
    let tokens: { refreshToken: string | null; accessToken: string; email: string | null };
    try {
      tokens = await client.exchange(query.code);
    } catch {
      return { from: state.from, ok: false, message: 'A ligação não foi concluída. Tente de novo.' };
    }
    const userId = state.userId;
    const list = await this.deps.personalCalendars.list(userId);
    const existing = list.find((c) => c.provider === expected && tokens.email !== null && c.accountEmail === tokens.email);
    const refreshTokenSealed = tokens.refreshToken ? this.deps.secretBox.seal(tokens.refreshToken) : existing?.refreshTokenSealed ?? null;
    if (!refreshTokenSealed) return { from: state.from, ok: false, message: 'O acesso contínuo não foi liberado. Tente de novo.' };
    if (!existing && list.length >= MAX_CONNECTIONS) return { from: state.from, ok: false, message: `Você já ligou ${MAX_CONNECTIONS} agendas.` };
    const now = this.deps.clock.now();
    const prefix = expected === 'GOOGLE' ? 'Google' : 'Outlook';
    const connection: PersonalCalendarConnection = existing
      ? { ...existing, refreshTokenSealed, status: 'ACTIVE', lastError: null }
      : { id: this.deps.ids.next(), userId, provider: expected, status: 'ACTIVE', label: tokens.email ? `${prefix} · ${tokens.email}` : null, accountEmail: tokens.email, refreshTokenSealed, sourceSealed: null, calendars: [], lastSyncAt: null, lastError: null, createdAt: now };
    try {
      await this.syncOAuth(connection, tokens.accessToken);
    } catch {
      connection.lastError = `Não foi possível ler ${name} agora. Vamos tentar de novo em instantes.`;
      await this.deps.personalCalendars.save(connection);
    }
    return { from: state.from, ok: true };
  }

  async googleCallback(query: { code?: unknown; state?: unknown; error?: unknown }) {
    return this.oauthCallback('GOOGLE', query);
  }

  /** Lista as agendas da conta (mantendo a escolha da pessoa) e importa os horários ocupados das escolhidas. */
  private async syncOAuth(connection: PersonalCalendarConnection, accessToken?: string): Promise<void> {
    const client = this.client(connection.provider as OAuthCalendarSource);
    if (!client) throw new Error('oauth-off');
    const token = accessToken ?? (await client.accessToken(this.deps.secretBox.open(connection.refreshTokenSealed ?? '') ?? ''));
    const agendas = await client.listCalendars(token);
    const known = new Map(connection.calendars.map((c) => [c.id, c.selected] as const));
    const firstTime = connection.calendars.length === 0;
    connection.calendars = agendas.map((a) => ({
      id: a.id,
      name: a.name,
      // Na primeira vez entram a principal e as que a pessoa deixa visíveis; depois vale a escolha dela.
      selected: known.get(a.id) ?? (firstTime ? a.primary || a.visible : false),
      color: a.color,
      account: connection.accountEmail,
    }));
    const ids = connection.calendars.filter((c) => c.selected).map((c) => c.id);
    const { from, to } = this.window();
    const busy = ids.length > 0 ? await client.freeBusy(token, ids, from, to) : [];
    connection.lastSyncAt = this.deps.clock.now();
    connection.lastError = null;
    connection.status = 'ACTIVE';
    await this.deps.personalCalendars.save(connection);
    await this.deps.personalCalendars.replaceBusy(connection.id, mergeBusy(busy, from, to));
  }

  // ---------- Comum ----------

  /** Escolhe quais agendas de uma conta Google ou Outlook entram. */
  async setSelection(userId: string, id: string, body: Record<string, unknown>): Promise<CalendarConnectionView> {
    const c = await this.own(userId, id);
    const raw = body['calendarIds'];
    if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) throw validationError('Agendas inválidas', { calendarIds: 'Envie a lista de agendas' });
    if (c.provider !== 'GOOGLE' && c.provider !== 'MICROSOFT') throw validationError('Essa agenda não tem agendas para escolher');
    const chosen = new Set(raw as string[]);
    c.calendars = c.calendars.map((x) => ({ ...x, selected: chosen.has(x.id) }));
    if (!c.calendars.some((x) => x.selected)) throw validationError('Escolha ao menos uma agenda', { calendarIds: 'Escolha ao menos uma agenda' });
    await this.syncOne(c);
    return toView((await this.deps.personalCalendars.find(id)) ?? c);
  }

  async syncNow(userId: string, id: string): Promise<CalendarConnectionView> {
    const c = await this.own(userId, id);
    if (c.provider === 'DEVICE') return toView(c); // o app manda a agenda do celular
    await this.syncOne(c);
    return toView((await this.deps.personalCalendars.find(id)) ?? c);
  }

  async remove(userId: string, id: string): Promise<void> {
    const c = await this.own(userId, id);
    await this.deps.personalCalendars.delete(userId, id);
    const client = c.provider === 'GOOGLE' || c.provider === 'MICROSOFT' ? this.client(c.provider) : undefined;
    if (client && c.refreshTokenSealed) {
      const token = this.deps.secretBox.open(c.refreshTokenSealed);
      if (token) await client.revoke(token).catch(() => undefined);
    }
  }

  /** Relê uma conexão; erro fica guardado na conexão (e o Google recusando vira "reconectar"). */
  private async syncOne(c: PersonalCalendarConnection): Promise<void> {
    try {
      if (c.provider === 'GOOGLE' || c.provider === 'MICROSOFT') await this.syncOAuth(c);
      else if (c.provider === 'ICS') {
        const url = this.deps.secretBox.open(c.sourceSealed ?? '');
        if (!url) throw new CalendarAccessRevoked();
        const intervals = await this.readIcs(url);
        c.lastSyncAt = this.deps.clock.now();
        c.lastError = null;
        c.status = 'ACTIVE';
        await this.deps.personalCalendars.save(c);
        await this.deps.personalCalendars.replaceBusy(c.id, intervals);
      }
    } catch (e) {
      if (e instanceof CalendarAccessRevoked) {
        c.status = 'REVOKED';
        c.lastError = c.provider === 'GOOGLE' ? 'O Google tirou o acesso. Ligue a Google Agenda de novo.' : c.provider === 'MICROSOFT' ? 'A Microsoft tirou o acesso. Ligue o Outlook de novo.' : 'Não foi possível abrir o link. Ligue a agenda de novo.';
        await this.deps.personalCalendars.replaceBusy(c.id, []);
      } else {
        c.lastError = e instanceof Error && 'code' in e && (e as { code?: unknown }).code === 'VALIDATION' ? e.message : 'Não foi possível ler a agenda agora. Vamos tentar de novo.';
      }
      // Marca a tentativa, para o job não insistir sem parar.
      c.lastSyncAt = this.deps.clock.now();
      await this.deps.personalCalendars.save(c);
    }
  }

  /** Job: relê Google e iCal atrasados. */
  async runDue(limit = 50): Promise<{ synced: number }> {
    const before = new Date(this.deps.clock.now().getTime() - RESYNC_MS);
    const due = await this.deps.personalCalendars.listDue(before, limit);
    for (const c of due) await this.syncOne(c);
    return { synced: due.length };
  }
}
