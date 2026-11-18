import { CalendarAccessRevoked } from '../ports.ts';
import type { BusyIntervalRecord, GoogleCalendarAgenda, GoogleCalendarClient, OAuthStateTokens, PersonalCalendarConnection, PersonalCalendarRepository, UserBusyRecord } from '../ports.ts';
import type { ExternalProvider } from '../types.ts';
import type { InMemoryIdentityRepository } from './in-memory.ts';

export class InMemoryPersonalCalendarRepository implements PersonalCalendarRepository {
  readonly rows = new Map<string, PersonalCalendarConnection>();
  readonly busy = new Map<string, BusyIntervalRecord[]>();
  private readonly identities: InMemoryIdentityRepository | undefined;

  constructor(identities?: InMemoryIdentityRepository) {
    this.identities = identities;
  }

  async list(userId: string): Promise<PersonalCalendarConnection[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((r) => structuredClone(r));
  }

  async find(id: string): Promise<PersonalCalendarConnection | undefined> {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : undefined;
  }

  async save(c: PersonalCalendarConnection): Promise<void> {
    this.rows.set(c.id, structuredClone(c));
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.userId !== userId) return false;
    this.rows.delete(id);
    this.busy.delete(id);
    return true;
  }

  async replaceBusy(connectionId: string, intervals: BusyIntervalRecord[]): Promise<void> {
    this.busy.set(connectionId, intervals.map((i) => ({ start: new Date(i.start), end: new Date(i.end) })));
  }

  async listBusy(userIds: string[], from: Date, to: Date): Promise<UserBusyRecord[]> {
    const out: UserBusyRecord[] = [];
    for (const c of this.rows.values()) {
      if (!userIds.includes(c.userId) || c.status !== 'ACTIVE') continue;
      for (const i of this.busy.get(c.id) ?? []) {
        if (i.start < to && i.end > from) out.push({ ...i, userId: c.userId, connectionId: c.id, provider: c.provider, label: c.label });
      }
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  async listDue(before: Date, limit: number): Promise<PersonalCalendarConnection[]> {
    return [...this.rows.values()]
      .filter((c) => c.status === 'ACTIVE' && (c.provider === 'GOOGLE' || c.provider === 'ICS') && (c.lastSyncAt === null || c.lastSyncAt < before))
      .sort((a, b) => (a.lastSyncAt?.getTime() ?? 0) - (b.lastSyncAt?.getTime() ?? 0))
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }

  async loginProvidersOf(userId: string): Promise<ExternalProvider[]> {
    const out = new Set<ExternalProvider>();
    for (const [key, uid] of this.identities?.rows ?? []) if (uid === userId) out.add(key.split('|')[0] as ExternalProvider);
    return [...out];
  }
}

/** Google falso: códigos e tokens conhecidos; `revoked` faz o refresh falhar. */
export class FakeGoogleCalendarClient implements GoogleCalendarClient {
  agendas: GoogleCalendarAgenda[] = [
    { id: 'primary@gmail.com', name: 'Ana', primary: true, visible: true, color: '#039be5' },
    { id: 'trabalho', name: 'Trabalho', primary: false, visible: true, color: null },
    { id: 'feriados', name: 'Feriados', primary: false, visible: false, color: null },
  ];
  busy = new Map<string, BusyIntervalRecord[]>();
  revoked = false;
  readonly revokedTokens: string[] = [];
  readonly freeBusyCalls: string[][] = [];
  email: string | null = 'ana@gmail.com';

  authUrl(state: string): string {
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(state)}`;
  }

  async exchange(code: string): Promise<{ refreshToken: string | null; accessToken: string; email: string | null }> {
    if (code !== 'codigo-bom') throw new CalendarAccessRevoked();
    return { refreshToken: 'refresh-1', accessToken: 'access-1', email: this.email };
  }

  async accessToken(refreshToken: string): Promise<string> {
    if (this.revoked || refreshToken !== 'refresh-1') throw new CalendarAccessRevoked();
    return 'access-2';
  }

  async listCalendars(): Promise<GoogleCalendarAgenda[]> {
    return this.agendas;
  }

  async freeBusy(_token: string, ids: string[], from: Date, to: Date): Promise<BusyIntervalRecord[]> {
    this.freeBusyCalls.push(ids);
    return ids.flatMap((id) => this.busy.get(id) ?? []).filter((i) => i.start < to && i.end > from);
  }

  async revoke(token: string): Promise<void> {
    this.revokedTokens.push(token);
  }
}

/** "state" de teste: JSON em texto, recusa o que não for nosso. */
export class FakeOAuthStates implements OAuthStateTokens {
  sign(payload: { userId: string; from: 'web' | 'app' }): string {
    return `st:${JSON.stringify(payload)}`;
  }

  verify(token: string): { userId: string; from: 'web' | 'app' } | undefined {
    if (!token.startsWith('st:')) return undefined;
    try {
      return JSON.parse(token.slice(3)) as { userId: string; from: 'web' | 'app' };
    } catch {
      return undefined;
    }
  }
}
