import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarWeeks, chipDay, podiumDay, clampRange, dayInZone, monthWeeks, shiftMonth, durationLabel, longDay, percent, shortDay, weekdayOf } from './date-poll.ts';

test('dia da semana e textos em português', () => {
  assert.equal(weekdayOf('2026-10-23'), 5);
  assert.equal(longDay('2026-10-23'), 'sexta-feira, 23 de outubro');
  assert.equal(shortDay('2026-10-03'), '03/10');
  assert.equal(percent(null), '—');
  assert.equal(percent(84.6), '85%');
  assert.equal(durationLabel(90), '1 h 30 min');
  assert.equal(durationLabel(240), '4 h');
});

test('semanas cobrem o intervalo e deixam vazio o que está fora', () => {
  const weeks = calendarWeeks('2026-10-22', '2026-10-27');
  assert.equal(weeks.length, 2);
  assert.deepEqual(weeks[0], [null, null, null, null, '2026-10-22', '2026-10-23', '2026-10-24']);
  assert.deepEqual(weeks[1], ['2026-10-25', '2026-10-26', '2026-10-27', null, null, null, null]);
});

test('linha da conversa: em votação, marcado e some depois da data', async () => {
  const { pollLine } = await import('./date-poll.ts');
  const base = { id: 'p', conversationId: 'c', title: 'Churrasco', rangeStart: '2026-10-20', rangeEnd: '2026-10-26', finalDate: null, finalEndsAt: null, needsMyVote: false, needsMyConfirmation: false, participantCount: 4, votedCount: 3, finishedCount: 1, best: null, proposedDate: null, votingDeadline: null, meetupId: null, event: null };
  const now = new Date('2026-10-22T12:00:00Z');
  assert.deepEqual(pollLine({ ...base, status: 'VOTING' }, now), { name: 'Churrasco', status: 'em votação: 75% dos votos' });
  assert.deepEqual(pollLine({ ...base, status: 'CONFIRMING', proposedDate: '2026-10-24' }, now), { name: 'Churrasco', status: 'confirmando 24/10' });
  const done = { ...base, status: 'FINALIZED' as const, finalDate: '2026-10-24', finalEndsAt: '2026-10-25T02:00:00Z' };
  assert.deepEqual(pollLine(done, now), { name: 'Churrasco', status: 'marcado para sábado, 24/10' });
  assert.equal(pollLine(done, new Date('2026-10-26T00:00:00Z')), null);
  assert.equal(pollLine({ ...base, status: 'CANCELLED' }, now), null);
});

test('período com evento não passa do dia do evento', () => {
  assert.equal(dayInZone('2026-11-15T02:30:00Z'), '2026-11-14');
  assert.deepEqual(clampRange('2026-11-01', '2026-11-30', '2026-11-14'), { start: '2026-11-01', end: '2026-11-14' });
  assert.deepEqual(clampRange('2026-11-20', '2026-11-30', '2026-11-14'), { start: '2026-11-14', end: '2026-11-14' });
  assert.deepEqual(clampRange('2026-11-01', '', undefined), { start: '2026-11-01', end: '' });
});

test('calendário do mês e rótulo curto', () => {
  assert.equal(chipDay('2026-10-20'), '20 de out.');
  const weeks = monthWeeks(2026, 10);
  assert.equal(weeks[0]!.filter((d) => d === null).length, 4);
  assert.equal(weeks[0]![4], '2026-10-01');
  assert.equal(weeks.at(-1)!.includes('2026-10-31'), true);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
});

test('podiumDay abrevia dia da semana e mês', () => {
  assert.equal(podiumDay('2026-10-24'), 'Sáb, 24 out');
  assert.equal(podiumDay('2026-03-01'), 'Dom, 1 mar');
});
