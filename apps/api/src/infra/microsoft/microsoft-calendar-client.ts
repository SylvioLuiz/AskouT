import { CalendarAccessRevoked } from '../../core/ports.ts';
import type { BusyIntervalRecord, GoogleCalendarAgenda, OAuthCalendarClient } from '../../core/ports.ts';

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * Escopos mínimos: e-mail (para mostrar a conta ligada), acesso contínuo e "Calendars.ReadBasic",
 * que dá início/fim e disponibilidade dos compromissos sem corpo nem anexos. Não exige aprovação de administrador.
 */
export const MICROSOFT_CALENDAR_SCOPES = ['openid', 'email', 'offline_access', 'https://graph.microsoft.com/Calendars.ReadBasic'];

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
    if (status !== 200 || typeof body['access_token'] !== 'string') throw new CalendarAccessRevoked(String(body['error'] ?? status));
    return { accessToken: body['access_token'], refreshToken: typeof body['refresh_token'] === 'string' ? body['refresh_token'] : null, email: emailFromIdToken(body['id_token']) };
  }

  async accessToken(refreshToken: string): Promise<string> {
    if (!refreshToken) throw new CalendarAccessRevoked();
    const { status, body } = await this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (status === 400 || status === 401) throw new CalendarAccessRevoked(String(body['error'] ?? status));
    if (status !== 200 || typeof body['access_token'] !== 'string') throw new Error(`Microsoft token HTTP ${status}`);
    return body['access_token'];
  }

  private async get(token: string, url: string): Promise<Record<string, unknown>> {
    const res = await this.o.fetchImpl(url.startsWith('https://') ? url : `${GRAPH}${url}`, {
      headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
      signal: AbortSignal.timeout(this.o.timeoutMs),
    });
    if (res.status === 401 || res.status === 403) throw new CalendarAccessRevoked(`HTTP ${res.status}`);
    if (!res.ok) throw new Error(`Microsoft Graph HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
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
    for (const id of calendarIds) {
      const q = new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $select: 'start,end,showAs,isAllDay,isCancelled', $top: '500' });
      let next: string | undefined = `/me/calendars/${encodeURIComponent(id)}/calendarView?${q.toString()}`;
      for (let page = 0; next && page < 10; page += 1) {
        const body: Record<string, unknown> = await this.get(token, next);
        for (const e of Array.isArray(body['value']) ? (body['value'] as Record<string, unknown>[]) : []) {
          if (e['isCancelled'] === true || e['isAllDay'] === true || e['showAs'] === 'free' || e['showAs'] === 'workingElsewhere') continue;
          const s = (e['start'] as { dateTime?: string } | undefined)?.dateTime;
          const f = (e['end'] as { dateTime?: string } | undefined)?.dateTime;
          // Com o cabeçalho de fuso UTC, a Graph devolve sem o "Z".
          const start = new Date(s && !/[zZ]|[+-]\d\d:\d\d$/.test(s) ? `${s}Z` : s ?? '');
          const end = new Date(f && !/[zZ]|[+-]\d\d:\d\d$/.test(f) ? `${f}Z` : f ?? '');
          if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) out.push({ start, end });
        }
        next = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : undefined;
      }
    }
    return out;
  }

  /** A Microsoft não tem rota para revogar um token de um app; a pessoa tira o acesso em account.microsoft.com. */
  async revoke(): Promise<void> {
    // nada a fazer
  }
}
