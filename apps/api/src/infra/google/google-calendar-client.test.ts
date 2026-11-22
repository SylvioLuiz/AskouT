import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CalendarAccessRevoked } from '../../core/ports.ts';
import { GOOGLE_CALENDAR_SCOPES, HttpGoogleCalendarClient } from './google-calendar-client.ts';

const opts = { clientId: 'cli', clientSecret: 'seg', redirectUri: 'https://api.exemplo.com/calendar/google/callback' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('authUrl: offline, consentimento e só os escopos de agenda e livre/ocupado', () => {
  const url = new URL(new HttpGoogleCalendarClient(opts).authUrl('st'));
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('redirect_uri'), opts.redirectUri);
  assert.equal(url.searchParams.get('scope'), GOOGLE_CALENDAR_SCOPES.join(' '));
  assert.ok(!url.searchParams.get('scope')!.includes('calendar.readonly'));
});

test('exchange lê o e-mail do id_token; refresh recusado vira CalendarAccessRevoked', async () => {
  const idToken = `x.${Buffer.from(JSON.stringify({ email: 'Ana@Gmail.com' })).toString('base64url')}.y`;
  const ok = new HttpGoogleCalendarClient({ ...opts, fetchImpl: async () => json(200, { access_token: 'a', refresh_token: 'r', id_token: idToken }) });
  assert.deepEqual(await ok.exchange('c'), { accessToken: 'a', refreshToken: 'r', email: 'ana@gmail.com' });
  const bad = new HttpGoogleCalendarClient({ ...opts, fetchImpl: async () => json(400, { error: 'invalid_grant' }) });
  await assert.rejects(bad.accessToken('r'), CalendarAccessRevoked);
});

test('freeBusy pede em blocos de 30 dias e junta as agendas', async () => {
  const bodies: { timeMin: string; timeMax: string; items: { id: string }[] }[] = [];
  const c = new HttpGoogleCalendarClient({
    ...opts,
    fetchImpl: async (_url, init) => {
      const b = JSON.parse(String(init?.body)) as (typeof bodies)[number];
      bodies.push(b);
      return json(200, { calendars: Object.fromEntries(b.items.map((i) => [i.id, { busy: [{ start: b.timeMin, end: new Date(Date.parse(b.timeMin) + 3_600_000).toISOString() }] }])) });
    },
  });
  const out = await c.freeBusy('t', ['a', 'b'], new Date('2026-10-01T00:00Z'), new Date('2026-12-30T00:00Z'));
  assert.equal(bodies.length, 3);
  assert.equal(out.length, 6);
  const forbidden = new HttpGoogleCalendarClient({ ...opts, fetchImpl: async () => json(401, {}) });
  await assert.rejects(forbidden.listCalendars('t'), CalendarAccessRevoked);
});

test('listCalendars: por padrão só as agendas da pessoa (não feriados, aniversários nem agenda de colega)', async () => {
  const c = new HttpGoogleCalendarClient({
    ...opts,
    fetchImpl: async () =>
      json(200, {
        items: [
          { id: 'ana@gmail.com', summary: 'Ana', primary: true, selected: true, accessRole: 'owner', timeZone: 'America/Sao_Paulo' },
          { id: 'trabalho@group.calendar.google.com', summary: 'Trabalho', selected: true, accessRole: 'owner' },
          { id: 'pt-br.brazilian#holiday@group.v.calendar.google.com', summary: 'Feriados', selected: true, accessRole: 'reader' },
          { id: 'addressbook#contacts@group.v.calendar.google.com', summary: 'Aniversários', selected: true, accessRole: 'reader' },
          { id: 'bia@gmail.com', summary: 'Bia', selected: true, accessRole: 'freeBusyReader' },
        ],
      }),
  });
  const list = await c.listCalendars('t');
  assert.deepEqual(list.filter((a) => a.visible).map((a) => a.id), ['ana@gmail.com', 'trabalho@group.calendar.google.com']);
  assert.equal(list.length, 5, 'as outras continuam na lista para a pessoa marcar');
  assert.equal(list[0]!.timeZone, 'America/Sao_Paulo');
});

test('freeBusy: tira os blocos de dia inteiro no fuso da agenda, também quando caem na emenda dos blocos de 30 dias', async () => {
  const all: [string, string][] = [
    ['2026-10-14T13:00:00Z', '2026-10-14T14:00:00Z'], // reunião
    ['2026-10-16T03:00:00Z', '2026-10-17T03:00:00Z'], // dia inteiro em São Paulo
    ['2026-10-30T03:00:00Z', '2026-11-02T03:00:00Z'], // três dias inteiros, cortados na emenda dos 30 dias (31/10 12:00Z)
  ];
  const c = new HttpGoogleCalendarClient({
    ...opts,
    fetchImpl: async (_url, init) => {
      const b = JSON.parse(String(init?.body)) as { timeMin: string; timeMax: string };
      const lo = Date.parse(b.timeMin);
      const hi = Date.parse(b.timeMax);
      const busy = all
        .filter(([s, e]) => Date.parse(s) < hi && Date.parse(e) > lo)
        .map(([s, e]) => ({ start: new Date(Math.max(Date.parse(s), lo)).toISOString(), end: new Date(Math.min(Date.parse(e), hi)).toISOString() }));
      return json(200, { calendars: { 'ana@gmail.com': { busy } } });
    },
  });
  const out = await c.freeBusy('t', ['ana@gmail.com'], new Date('2026-10-01T12:00Z'), new Date('2026-12-01T00:00Z'), { 'ana@gmail.com': 'America/Sao_Paulo' });
  assert.deepEqual(out.map((i) => i.start.toISOString()), ['2026-10-14T13:00:00.000Z']);
});

test('token e API do Google: invalid_client e limite de uso (403) não desconectam a conta', async () => {
  const secret = new HttpGoogleCalendarClient({ ...opts, fetchImpl: async () => json(401, { error: 'invalid_client' }) });
  await assert.rejects(secret.accessToken('r'), (e: unknown) => e instanceof Error && !(e instanceof CalendarAccessRevoked));
  const limit = new HttpGoogleCalendarClient({ ...opts, fetchImpl: async () => json(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }) });
  await assert.rejects(limit.listCalendars('t'), (e: unknown) => e instanceof Error && !(e instanceof CalendarAccessRevoked));
  const scope = new HttpGoogleCalendarClient({ ...opts, fetchImpl: async () => json(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }) });
  await assert.rejects(scope.listCalendars('t'), CalendarAccessRevoked);
});
