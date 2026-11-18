import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CalendarAccessRevoked } from '../../core/ports.ts';
import { GraphMicrosoftCalendarClient, MICROSOFT_CALENDAR_SCOPES } from './microsoft-calendar-client.ts';

const opts = { clientId: 'cli', clientSecret: 'seg', redirectUri: 'https://api.exemplo.com/calendar/microsoft/callback' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('authUrl pede só leitura básica da agenda e acesso contínuo', () => {
  const url = new URL(new GraphMicrosoftCalendarClient(opts).authUrl('st'));
  assert.equal(url.searchParams.get('scope'), MICROSOFT_CALENDAR_SCOPES.join(' '));
  assert.ok(url.searchParams.get('scope')!.includes('Calendars.ReadBasic'));
  assert.equal(url.searchParams.get('state'), 'st');
});

test('calendarView: ignora livre, dia inteiro e cancelado; hora sem fuso é UTC; segue paginação', async () => {
  const pages: string[] = [];
  const c = new GraphMicrosoftCalendarClient({
    ...opts,
    fetchImpl: async (url) => {
      pages.push(String(url));
      if (String(url).includes('page2')) return json(200, { value: [{ start: { dateTime: '2026-10-15T12:00:00.0000000' }, end: { dateTime: '2026-10-15T13:00:00.0000000' }, showAs: 'busy' }] });
      return json(200, {
        value: [
          { start: { dateTime: '2026-10-14T13:00:00.0000000' }, end: { dateTime: '2026-10-14T14:00:00.0000000' }, showAs: 'busy' },
          { start: { dateTime: '2026-10-14T15:00:00' }, end: { dateTime: '2026-10-14T16:00:00' }, showAs: 'free' },
          { start: { dateTime: '2026-10-16T00:00:00' }, end: { dateTime: '2026-10-17T00:00:00' }, showAs: 'busy', isAllDay: true },
          { start: { dateTime: '2026-10-14T18:00:00' }, end: { dateTime: '2026-10-14T19:00:00' }, showAs: 'busy', isCancelled: true },
        ],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/page2',
      });
    },
  });
  const out = await c.freeBusy('t', ['cal1'], new Date('2026-10-13T00:00Z'), new Date('2026-10-20T00:00Z'));
  assert.deepEqual(out.map((i) => i.start.toISOString()), ['2026-10-14T13:00:00.000Z', '2026-10-15T12:00:00.000Z']);
  assert.equal(pages.length, 2);
  await assert.rejects(new GraphMicrosoftCalendarClient({ ...opts, fetchImpl: async () => json(400, { error: 'invalid_grant' }) }).accessToken('r'), CalendarAccessRevoked);
});
