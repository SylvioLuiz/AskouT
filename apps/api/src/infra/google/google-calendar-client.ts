import { CalendarAccessRevoked } from '../../core/ports.ts';
import type { BusyIntervalRecord, GoogleCalendarAgenda, GoogleCalendarClient } from '../../core/ports.ts';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';

/**
 * Escopos mínimos: e-mail (para mostrar qual conta foi ligada), lista de agendas e horários livres/ocupados.
 * Nenhum dá acesso a título, descrição ou participantes dos compromissos.
 */
export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
];

export interface GoogleCalendarOptions {
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
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
    // O token vem direto do Google pelo canal do servidor (TLS), então dá para ler sem conferir a assinatura de novo.
    return typeof payload['email'] === 'string' ? payload['email'].toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Google Agenda pela API REST, com o fluxo OAuth do servidor ("web server app"). */
export class HttpGoogleCalendarClient implements GoogleCalendarClient {
  private readonly o: Required<Omit<GoogleCalendarOptions, 'fetchImpl'>> & { fetchImpl: typeof fetch };

  constructor(options: GoogleCalendarOptions) {
    this.o = { timeoutMs: 10_000, fetchImpl: fetch, ...options } as typeof this.o;
  }

  authUrl(state: string): string {
    const q = new URLSearchParams({
      client_id: this.o.clientId,
      redirect_uri: this.o.redirectUri,
      response_type: 'code',
      scope: GOOGLE_CALENDAR_SCOPES.join(' '),
      access_type: 'offline',
      // "consent" garante o refresh token, também quando a pessoa já tinha dado acesso antes.
      prompt: 'consent select_account',
      include_granted_scopes: 'true',
      state,
    });
    return `${AUTH_URL}?${q.toString()}`;
  }

  private async post(url: string, form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await this.o.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(this.o.timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body };
  }

  async exchange(code: string): Promise<{ refreshToken: string | null; accessToken: string; email: string | null }> {
    const { status, body } = await this.post(TOKEN_URL, { code, client_id: this.o.clientId, client_secret: this.o.clientSecret, redirect_uri: this.o.redirectUri, grant_type: 'authorization_code' });
    if (status !== 200 || typeof body['access_token'] !== 'string') throw new CalendarAccessRevoked(String(body['error'] ?? status));
    return { accessToken: body['access_token'], refreshToken: typeof body['refresh_token'] === 'string' ? body['refresh_token'] : null, email: emailFromIdToken(body['id_token']) };
  }

  async accessToken(refreshToken: string): Promise<string> {
    if (!refreshToken) throw new CalendarAccessRevoked();
    const { status, body } = await this.post(TOKEN_URL, { refresh_token: refreshToken, client_id: this.o.clientId, client_secret: this.o.clientSecret, grant_type: 'refresh_token' });
    if (status === 400 || status === 401) throw new CalendarAccessRevoked(String(body['error'] ?? status));
    if (status !== 200 || typeof body['access_token'] !== 'string') throw new Error(`Google token HTTP ${status}`);
    return body['access_token'];
  }

  private async api(token: string, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const res = await this.o.fetchImpl(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(this.o.timeoutMs),
    });
    if (res.status === 401 || res.status === 403) throw new CalendarAccessRevoked(`HTTP ${res.status}`);
    if (!res.ok) throw new Error(`Google Calendar HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async listCalendars(token: string): Promise<GoogleCalendarAgenda[]> {
    const out: GoogleCalendarAgenda[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const q = new URLSearchParams({ maxResults: '250', minAccessRole: 'freeBusyReader', ...(pageToken ? { pageToken } : {}) });
      const body = await this.api(token, `/users/me/calendarList?${q.toString()}`);
      for (const raw of Array.isArray(body['items']) ? (body['items'] as Record<string, unknown>[]) : []) {
        if (typeof raw['id'] !== 'string' || raw['deleted'] === true) continue;
        const name = typeof raw['summaryOverride'] === 'string' ? raw['summaryOverride'] : typeof raw['summary'] === 'string' ? raw['summary'] : raw['id'];
        out.push({ id: raw['id'], name, primary: raw['primary'] === true, visible: raw['selected'] === true || raw['primary'] === true, color: typeof raw['backgroundColor'] === 'string' ? raw['backgroundColor'] : null });
      }
      pageToken = typeof body['nextPageToken'] === 'string' ? body['nextPageToken'] : undefined;
      if (!pageToken) break;
    }
    // Principal primeiro, depois as visíveis, depois o resto.
    return out.sort((a, b) => Number(b.primary) - Number(a.primary) || Number(b.visible) - Number(a.visible) || a.name.localeCompare(b.name));
  }

  async freeBusy(token: string, calendarIds: string[], from: Date, to: Date): Promise<BusyIntervalRecord[]> {
    const out: BusyIntervalRecord[] = [];
    // O Google aceita até 50 agendas por pedido e recusa períodos longos demais: pedimos em blocos de 30 dias.
    const CHUNK = 30 * 86_400_000;
    for (let t = from.getTime(); t < to.getTime(); t += CHUNK)
    for (let i = 0; i < calendarIds.length; i += 50) {
      const body = await this.api(token, '/freeBusy', {
        method: 'POST',
        body: JSON.stringify({ timeMin: new Date(t).toISOString(), timeMax: new Date(Math.min(to.getTime(), t + CHUNK)).toISOString(), items: calendarIds.slice(i, i + 50).map((id) => ({ id })) }),
      });
      const calendars = (body['calendars'] ?? {}) as Record<string, { busy?: { start?: string; end?: string }[] }>;
      for (const c of Object.values(calendars)) {
        for (const b of c.busy ?? []) {
          const start = new Date(b.start ?? '');
          const end = new Date(b.end ?? '');
          if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) out.push({ start, end });
        }
      }
    }
    return out;
  }

  async revoke(token: string): Promise<void> {
    await this.post(REVOKE_URL, { token });
  }
}
