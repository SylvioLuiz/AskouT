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
