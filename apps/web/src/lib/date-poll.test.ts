import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarWeeks, durationLabel, longDay, percent, shortDay, weekdayOf } from './date-poll.ts';

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
