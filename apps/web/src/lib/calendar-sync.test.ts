import assert from 'node:assert/strict';
import { test } from 'node:test';
import { busyOnDay, calendarOptions, deviceCalendarBridge, deviceResyncDue, groupByAccount, icsHelp, syncWindow } from './calendar-sync.ts';

const base = { suggestions: [], googleAvailable: true, connections: [] };

test('opções: no app a agenda do celular vem primeiro; detectadas antes das outras', () => {
  assert.deepEqual(calendarOptions(base, true).map((o) => o.kind), ['DEVICE', 'GOOGLE', 'OUTLOOK', 'ICLOUD', 'ICS']);
  assert.deepEqual(calendarOptions(base, false).map((o) => o.kind), ['GOOGLE', 'OUTLOOK', 'ICLOUD', 'ICS'], 'no site não há agenda do celular');
  const outlook = calendarOptions({ ...base, suggestions: [{ kind: 'OUTLOOK', reason: 'email' }] }, false);
  assert.deepEqual(outlook.map((o) => [o.kind, o.detected]).slice(0, 2), [['OUTLOOK', true], ['GOOGLE', false]]);
  const semOauth = calendarOptions({ ...base, googleAvailable: false }, false);
  assert.equal(semOauth.find((o) => o.kind === 'GOOGLE')?.via, 'ics', 'sem OAuth, Google pelo link iCal');
  const comCelular = calendarOptions({ ...base, connections: [{ id: '1', provider: 'DEVICE', status: 'ACTIVE', label: 'x', accountEmail: null, calendars: [], lastSyncAt: null, lastError: null }] }, true);
  assert.ok(!comCelular.some((o) => o.kind === 'DEVICE'), 'celular já ligado não repete');
  const comGoogle = calendarOptions({ ...base, suggestions: [{ kind: 'GOOGLE', reason: 'login' }], connections: [{ id: '2', provider: 'GOOGLE', status: 'ACTIVE', label: 'g', accountEmail: 'a@gmail.com', calendars: [], lastSyncAt: null, lastError: null }] }, false);
  assert.equal(comGoogle.find((o) => o.kind === 'GOOGLE')?.detected, false, 'Google já ligado sai de "Encontramos"');
});

test('agrupa por conta e ajuda tem passos', () => {
  const g = groupByAccount([{ id: '1', account: 'ana@gmail.com' }, { id: '2', account: null }, { id: '3', account: 'ana@gmail.com' }]);
  assert.deepEqual(g.map((x) => [x.account, x.items.length]), [['ana@gmail.com', 2], ['Neste aparelho', 1]]);
  assert.equal(icsHelp('OUTLOOK').length, 3);
});

test('janela, reenvio do celular e ocupados do dia', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  assert.deepEqual(syncWindow(now), { from: '2026-10-12T12:00:00.000Z', to: '2027-01-11T12:00:00.000Z' });
  assert.equal(deviceResyncDue(null, now), true);
  assert.equal(deviceResyncDue('2026-10-13T11:45:00Z', now), false);
  assert.equal(deviceResyncDue('2026-10-13T11:00:00Z', now), true);
  const b = (start: string, end: string) => ({ start, end, connectionId: 'c', provider: 'GOOGLE' as const, label: 'G' });
  const blocks = [b('2026-10-15T15:00:00', '2026-10-15T16:00:00'), b('2026-10-14T15:00:00', '2026-10-14T16:00:00')];
  assert.deepEqual(busyOnDay(blocks, '2026-10-14').map((x) => x.start), ['2026-10-14T15:00:00']);
});

test('ponte da agenda do celular só existe completa dentro do app', () => {
  assert.equal(deviceCalendarBridge({}), undefined);
  assert.equal(deviceCalendarBridge({ AskouTDeviceCalendar: { listCalendars: async () => [] } }), undefined);
  assert.ok(deviceCalendarBridge({ AskouTDeviceCalendar: { listCalendars: async () => [], busy: async () => [] } }));
});
