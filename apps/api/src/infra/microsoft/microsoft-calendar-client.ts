import { CalendarAccessRevoked } from '../../core/ports.ts';
import type { BusyIntervalRecord, GoogleCalendarAgenda, OAuthAccess, OAuthCalendarClient } from '../../core/ports.ts';

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * Escopos mínimos: e-mail (para mostrar a conta ligada), acesso contínuo e "Calendars.ReadBasic",
 * que dá início/fim e disponibilidade dos compromissos sem corpo nem anexos. Não exige aprovação de administrador.
 */
export const MICROSOFT_CALENDAR_SCOPES = ['openid', 'email', 'offline_access', 'https://graph.microsoft.com/Calendars.ReadBasic'];

/**
 * Erros do token que querem dizer "a pessoa precisa entrar de novo". Os demais (invalid_client = segredo do app errado
 * ou vencido no Entra, invalid_scope, invalid_request, 5xx) são problema nosso ou passageiro e não desligam a agenda.
 */
const REVOKED_TOKEN_ERRORS = new Set(['invalid_grant', 'interaction_required', 'consent_required', 'login_required']);

function warn(message: string): void {
  console.warn(`[microsoft-calendar] ${message}`);
}

/** "AADSTS7000215: Invalid client secret provided..." → "AADSTS7000215". */
function aadCode(body: Record<string, unknown>): string {
  const d = typeof body['error_description'] === 'string' ? body['error_description'] : '';
  return /AADSTS\d+/.exec(d)?.[0] ?? '';
}

/** Com o cabeçalho de fuso UTC, a Graph devolve a hora sem o "Z" e com 7 casas nos segundos ("2026-10-14T13:00:00.0000000"). */
export function graphTime(value: string | undefined): Date {
  if (!value) return new Date(NaN);
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?)(\.\d+)?(Z|[+-]\d\d:\d\d)?$/i.exec(value);
  if (!m) return new Date(value);
  const ms = m[2] ? m[2].slice(0, 4).padEnd(4, '0') : '';
  return new Date(`${m[1]}${ms}${m[3] ?? 'Z'}`);
}

/** Resposta de erro da Graph que não é token recusado (ex.: 403 numa agenda, 404, 429, 5xx). */
export class GraphError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`Microsoft Graph HTTP ${status} ${code}`.trim());
    this.status = status;
    this.code = code;
  }
}

export interface MicrosoftCalendarOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  const part = idToken.split('.')[1];
  if (!part) return null;
  try {
    const p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
    const email = typeof p['email'] === 'string' ? p['email'] : typeof p['preferred_username'] === 'string' ? p['preferred_username'] : null;
    return email ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Outlook / Microsoft 365 pela Microsoft Graph, com o fluxo OAuth do servidor (contas pessoais e de trabalho). */
export class GraphMicrosoftCalendarClient implements OAuthCalendarClient {
  private readonly o: Required<Omit<MicrosoftCalendarOptions, 'fetchImpl'>> & { fetchImpl: typeof fetch };

  constructor(options: MicrosoftCalendarOptions) {
    this.o = { timeoutMs: 10_000, fetchImpl: fetch, ...options } as typeof this.o;
  }

  authUrl(state: string): string {
    const q = new URLSearchParams({
      client_id: this.o.clientId,
      redirect_uri: this.o.redirectUri,
      response_type: 'code',
      response_mode: 'query',
      scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
      prompt: 'select_account',
      state,
    });
    return `${AUTHORITY}/authorize?${q.toString()}`;
  }

  private async token(form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await this.o.fetchImpl(`${AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.o.clientId, client_secret: this.o.clientSecret, scope: MICROSOFT_CALENDAR_SCOPES.join(' '), ...form }).toString(),
      signal: AbortSignal.timeout(this.o.timeoutMs),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  async exchange(code: string): Promise<{ refreshToken: string | null; accessToken: string; email: string | null }> {
    const { status, body } = await this.token({ grant_type: 'authorization_code', code, redirect_uri: this.o.redirectUri });
    if (status !== 200 || typeof body['access_token'] !== 'string') {
      warn(`troca do código recusada: HTTP ${status} ${String(body['error'] ?? '')} ${aadCode(body)}`.trim());
      throw new CalendarAccessRevoked(`${String(body['error'] ?? status)} ${aadCode(body)}`.trim());
    }
    return { accessToken: body['access_token'], refreshToken: typeof body['refresh_token'] === 'string' ? body['refresh_token'] : null, email: emailFromIdToken(body['id_token']) };
  }

  async accessToken(refreshToken: string): Promise<OAuthAccess> {
    if (!refreshToken) throw new CalendarAccessRevoked();
    const { status, body } = await this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (status === 200 && typeof body['access_token'] === 'string') {
      // A Microsoft devolve um refresh token novo a cada uso; quem chama guarda o novo.
      return { accessToken: body['access_token'], refreshToken: typeof body['refresh_token'] === 'string' ? body['refresh_token'] : null };
    }
    const error = typeof body['error'] === 'string' ? body['error'] : '';
    warn(`refresh recusado: HTTP ${status} ${error} ${aadCode(body)}`.trim());
    if (REVOKED_TOKEN_ERRORS.has(error)) throw new CalendarAccessRevoked(`${error} ${aadCode(body)}`.trim());
    throw new Error(`Microsoft token HTTP ${status} ${error} ${aadCode(body)}`.trim());
  }

  private async get(token: string, url: string): Promise<Record<string, unknown>> {
    const res = await this.o.fetchImpl(url.startsWith('https://') ? url : `${GRAPH}${url}`, {
      headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
      signal: AbortSignal.timeout(this.o.timeoutMs),
    });
    if (res.ok) return (await res.json()) as Record<string, unknown>;
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    const code = body.error?.code ?? '';
    warn(`${url.split('?')[0].replace(/calendars\/[^/]+/, 'calendars/…')}: HTTP ${res.status} ${code} ${body.error?.message ?? ''}`.trim());
    // Só 401 é token recusado. 403 (agenda compartilhada, de grupo, sem permissão) é daquela agenda, não da conta.
    if (res.status === 401) throw new CalendarAccessRevoked(`HTTP 401 ${code}`.trim());
    throw new GraphError(res.status, code);
  }

  async listCalendars(token: string): Promise<GoogleCalendarAgenda[]> {
    const out: GoogleCalendarAgenda[] = [];
    let next: string | undefined = '/me/calendars?$select=id,name,isDefaultCalendar,hexColor&$top=100';
    for (let page = 0; next && page < 5; page += 1) {
      const body: Record<string, unknown> = await this.get(token, next);
      for (const raw of Array.isArray(body['value']) ? (body['value'] as Record<string, unknown>[]) : []) {
        if (typeof raw['id'] !== 'string') continue;
        const primary = raw['isDefaultCalendar'] === true;
        const color = typeof raw['hexColor'] === 'string' && raw['hexColor'] !== '' ? raw['hexColor'] : null;
        // A Microsoft não tem "agenda visível": entra a principal na primeira vez, as outras a pessoa escolhe.
        out.push({ id: raw['id'], name: typeof raw['name'] === 'string' ? raw['name'] : 'Calendário', primary, visible: primary, color });
      }
      next = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : undefined;
    }
    return out.sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
  }

  async freeBusy(token: string, calendarIds: string[], from: Date, to: Date): Promise<BusyIntervalRecord[]> {
    const out: BusyIntervalRecord[] = [];
    let failed: unknown;
    let read = 0;
    for (const id of calendarIds) {
      const q = new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $select: 'start,end,showAs,isAllDay,isCancelled', $top: '200' });
      let next: string | undefined = `/me/calendars/${encodeURIComponent(id)}/calendarView?${q.toString()}`;
      const mine: BusyIntervalRecord[] = [];
      try {
        for (let page = 0; next && page < 25; page += 1) {
          const body: Record<string, unknown> = await this.get(token, next);
          for (const e of Array.isArray(body['value']) ? (body['value'] as Record<string, unknown>[]) : []) {
            if (e['isCancelled'] === true || e['isAllDay'] === true || e['showAs'] === 'free' || e['showAs'] === 'workingElsewhere') continue;
            const start = graphTime((e['start'] as { dateTime?: string } | undefined)?.dateTime);
            const end = graphTime((e['end'] as { dateTime?: string } | undefined)?.dateTime);
            if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) mine.push({ start, end });
          }
          next = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : undefined;
        }
      } catch (e) {
        // Uma agenda que a Graph não deixa ler (403/404: compartilhada, de grupo, apagada) não derruba as outras.
        if (!(e instanceof GraphError) || (e.status !== 403 && e.status !== 404)) throw e;
        failed = e;
        continue;
      }
      read += 1;
      out.push(...mine);
    }
    if (read === 0 && failed) throw failed;
    return out;
  }

  /** A Microsoft não tem rota para revogar um token de um app; a pessoa tira o acesso em account.microsoft.com. */
  async revoke(): Promise<void> {
    // nada a fazer
  }
}
