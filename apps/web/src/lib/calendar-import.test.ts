import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CALENDAR_LEAD_VALUES, calendarUrlProblem, draftStatusLabel, eventDraftOf, leadLabel, publishLabel, syncLabel } from './calendar-import.ts';
import type { CalendarDraft } from './types.ts';

const now = new Date(2026, 9, 23, 12, 0);
const local = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();

test('a roleta vai de 1 a 30 dias', () => {
  assert.equal(CALENDAR_LEAD_VALUES.length, 30);
  assert.equal(CALENDAR_LEAD_VALUES[0], 1);
  assert.equal(CALENDAR_LEAD_VALUES[29], 30);
  assert.equal(leadLabel(1), '1 dia');
  assert.equal(leadLabel(7), '7 dias');
});

test('endereço da agenda: aceita https e webcal, recusa vazio e outros esquemas', () => {
  assert.equal(calendarUrlProblem('https://calendar.google.com/calendar/ical/x/basic.ics'), null);
  assert.equal(calendarUrlProblem(' webcal://exemplo.com/a.ics '), null);
  assert.ok(calendarUrlProblem(''));
  assert.ok(calendarUrlProblem('http://exemplo.com/a.ics'));
  assert.ok(calendarUrlProblem('meu calendário'));
  assert.ok(calendarUrlProblem(`https://exemplo.com/${'a'.repeat(500)}`));
});

test('publishLabel: hoje, amanhã, outro dia e já passou', () => {
  assert.equal(publishLabel(local(2026, 10, 23, 18, 30), now), 'hoje às 18:30');
  assert.equal(publishLabel(local(2026, 10, 24, 9, 0), now), 'amanhã às 09:00');
  assert.match(publishLabel(local(2026, 10, 30, 9, 0), now), /^sex\.? 30\/10 às 09:00$/);
  assert.equal(publishLabel(local(2026, 10, 20, 9, 0), now), 'assim que você aprovar');
});

test('draftStatusLabel e syncLabel', () => {
  assert.equal(draftStatusLabel('AWAITING'), 'Esperando sua aprovação');
  assert.equal(draftStatusLabel('APPROVED'), 'Aprovado');
  const base = { host: 'calendar.google.com', leadDays: 7, enabled: true, lastSyncAt: null, lastError: null, lastFound: 0 };
  assert.equal(syncLabel(base, now), 'Ainda não foi lida.');
  assert.equal(syncLabel({ ...base, lastError: 'A agenda não foi encontrada.' }, now), 'A agenda não foi encontrada.');
  assert.equal(syncLabel({ ...base, lastSyncAt: new Date(now.getTime() - 5 * 60_000).toISOString(), lastFound: 3 }, now), 'Lida há 5 min · 3 eventos à vista');
  assert.equal(syncLabel({ ...base, lastSyncAt: new Date(now.getTime() - 5 * 60_000).toISOString(), lastFound: 1 }, now), 'Lida há 5 min · 1 evento à vista');
});

test('eventDraftOf entrega o rascunho no formato do formulário', () => {
  const d: CalendarDraft = { id: 'd1', title: 'Samba', description: '', kind: 'SHOW', startsAt: local(2026, 11, 7, 20), endsAt: local(2026, 11, 7, 23), isFree: true, imageUrl: null, tags: ['samba'], ticketUrl: null, publishAt: local(2026, 10, 31, 20), status: 'AWAITING', edited: false };
  const f = eventDraftOf(d, (iso) => iso.slice(0, 16));
  assert.equal(f.title, 'Samba');
  assert.equal(f.description, '');
  assert.equal(f.tags, '#samba');
  assert.equal(f.isFree, true);
  assert.equal(f.imageUrl, '');
});
