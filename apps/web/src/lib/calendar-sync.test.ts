import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { busyColorsOnDay, busyOnDay, connectionColor, calendarOptions, deviceCalendarBridge, deviceResyncDue, groupByAccount, logoForAccount, logoForConnection, syncWindow } from './calendar-sync.ts';

const base = { suggestions: [], googleAvailable: true, microsoftAvailable: true, connections: [] };
const conn = (provider: 'GOOGLE' | 'MICROSOFT' | 'DEVICE') => ({ id: provider, provider, status: 'ACTIVE' as const, label: 'x', accountEmail: null, calendars: [], lastSyncAt: null, lastError: null });

test('opções só diretas: no app, celular e iCloud; no site, Google e Outlook; detectadas primeiro', () => {
  assert.deepEqual(calendarOptions(base, true).map((o) => o.kind), ['DEVICE', 'GOOGLE', 'OUTLOOK', 'ICLOUD']);
  assert.deepEqual(calendarOptions(base, false).map((o) => o.kind), ['GOOGLE', 'OUTLOOK']);
  assert.ok(calendarOptions(base, true).every((o) => o.via !== ('ics' as never)), 'nada de colar link');
  const outlook = calendarOptions({ ...base, suggestions: [{ kind: 'OUTLOOK', reason: 'email' }] }, false);
  assert.deepEqual(outlook.map((o) => [o.kind, o.detected]), [['OUTLOOK', true], ['GOOGLE', false]]);
  const semChave = calendarOptions({ ...base, googleAvailable: false, suggestions: [{ kind: 'GOOGLE', reason: 'login' }] }, false);
  assert.equal(semChave.find((o) => o.kind === 'GOOGLE')?.available, false, 'sem chave: em breve');
  assert.ok(!calendarOptions({ ...base, connections: [conn('DEVICE')] }, true).some((o) => o.kind === 'DEVICE'), 'celular já ligado não repete');
  const comGoogle = calendarOptions({ ...base, suggestions: [{ kind: 'GOOGLE', reason: 'login' }], connections: [conn('GOOGLE')] }, false);
  assert.equal(comGoogle.find((o) => o.kind === 'GOOGLE')?.detected, false, 'Google já ligado sai de "Encontramos"');
});

test('ícone pela conta e pela conexão; agrupa por conta', () => {
  assert.equal(logoForAccount('ana@gmail.com'), 'GOOGLE');
  assert.equal(logoForAccount('Exchange'), 'OUTLOOK');
  assert.equal(logoForAccount('ana@hotmail.com'), 'OUTLOOK');
  assert.equal(logoForAccount('iCloud'), 'ICLOUD');
  assert.equal(logoForAccount(null), 'OTHER');
  assert.equal(logoForConnection(conn('MICROSOFT')), 'OUTLOOK');
  const g = groupByAccount([{ id: '1', account: 'ana@gmail.com' }, { id: '2', account: null }, { id: '3', account: 'ana@gmail.com' }]);
  assert.deepEqual(g.map((x) => [x.account, x.items.length]), [['ana@gmail.com', 2], ['Neste aparelho', 1]]);
});

test('janela, reenvio do celular e ocupados do dia', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  assert.deepEqual(syncWindow(now), { from: '2026-08-29T12:00:00.000Z', to: '2027-01-11T12:00:00.000Z' });
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

describe('cores das agendas ligadas', () => {
  const cal = (color: string | null, selected = true) => ({ id: 'c', name: 'c', selected, color, account: null });
  it('usa a cor da agenda escolhida, senão a do tipo de agenda', () => {
    assert.equal(connectionColor({ provider: 'GOOGLE', calendars: [cal(null), cal('#16a765')] }), '#16a765');
    assert.equal(connectionColor({ provider: 'GOOGLE', calendars: [cal('#ff0000', false), cal('#16a765')] }), '#16a765');
    assert.equal(connectionColor({ provider: 'MICROSOFT', calendars: [] }), '#0078d4');
    assert.equal(connectionColor({ provider: 'DEVICE', calendars: [cal('azul')] }), '#34c759');
  });
  it('lista uma cor por agenda com compromisso no dia', () => {
    const block = (connectionId: string, start: string, end: string) => ({ connectionId, start, end, provider: 'GOOGLE' as const, label: 'x' });
    const blocks = [block('a', '2026-11-20T12:00:00.000Z', '2026-11-20T13:00:00.000Z'), block('a', '2026-11-20T15:00:00.000Z', '2026-11-20T16:00:00.000Z'), block('b', '2026-11-20T18:00:00.000Z', '2026-11-20T19:00:00.000Z')];
    const colorOf = (b: { connectionId: string }) => (b.connectionId === 'a' ? '#111111' : '#222222');
    assert.deepEqual(busyColorsOnDay(blocks, '2026-11-20', colorOf), ['#111111', '#222222']);
    assert.deepEqual(busyColorsOnDay(blocks, '2026-11-21', colorOf), []);
  });
});
