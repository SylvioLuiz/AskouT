import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInterval, evaluateParticipant, findBestDates, zonedTimeToUtc } from './index.ts';
import type { AvailabilitySlot, Interval, ParticipantAvailability } from './index.ts';

const H = 3_600_000;
// Sexta-feira, 16/10/2026, 00:00 UTC
const base = Date.UTC(2026, 9, 16);
const at = (hour: number) => base + hour * H;
const target: Interval = { start: at(20), end: at(23) };

const person = (
  userId: string,
  slots: AvailabilitySlot[] = [],
  busy: Interval[] = [],
): ParticipantAvailability => ({ userId, slots, busy });
const free = (id: string) => person(id, [{ start: at(19), end: at(24), state: 'available' }]);
const blocked = (id: string) => person(id, [{ start: at(0), end: at(24), state: 'unavailable' }]);

test('verde: todos disponíveis integralmente (6/6)', () => {
  const r = evaluateInterval(['a', 'b', 'c', 'd', 'e', 'f'].map(free), target);
  assert.equal(r.level, 'green');
  assert.equal(r.counts.available, 6);
});

test('laranja: 4 de 6 disponíveis, 2 indisponíveis', () => {
  const r = evaluateInterval([...['a', 'b', 'c', 'd'].map(free), blocked('e'), blocked('f')], target);
  assert.equal(r.level, 'orange');
  assert.equal(r.counts.available, 4);
  assert.equal(r.counts.unavailable, 2);
});

test('vermelho: 1 de 6 disponível, 5 indisponíveis', () => {
  const r = evaluateInterval([free('a'), ...['b', 'c', 'd', 'e', 'f'].map(blocked)], target);
  assert.equal(r.level, 'red');
});

test('aguardando: alguém sem informação não é tratado como indisponível', () => {
  const r = evaluateInterval([...['a', 'b', 'c', 'd', 'e'].map(free), person('f')], target);
  assert.equal(r.level, 'awaiting');
  assert.equal(r.counts.unknown, 1);
  assert.equal(r.counts.unavailable, 0);
});

test('janela menor que a duração do encontro (20h-21h para 20h-23h) é parcial', () => {
  const p = person('a', [{ start: at(20), end: at(21), state: 'available' }]);
  const r = evaluateParticipant(p, target);
  assert.equal(r.status, 'partial');
  assert.equal(r.reason, 'partial_coverage');
});

test('slots disponíveis contíguos somam e cobrem o intervalo inteiro', () => {
  const p = person('a', [
    { start: at(19), end: at(21), state: 'available' },
    { start: at(21), end: at(24), state: 'available' },
  ]);
  assert.equal(evaluateParticipant(p, target).status, 'available');
});

test('indisponibilidade manual prevalece sobre disponibilidade', () => {
  const p = person('a', [
    { start: at(19), end: at(24), state: 'available' },
    { start: at(22), end: at(23), state: 'unavailable' },
  ]);
  const r = evaluateParticipant(p, target);
  assert.equal(r.status, 'unavailable');
  assert.equal(r.reason, 'manual_unavailable');
});

test('compromisso externo gera conflito mesmo com disponibilidade manual', () => {
  const p = person('a', [{ start: at(19), end: at(24), state: 'available' }], [{ start: at(21), end: at(22) }]);
  const r = evaluateParticipant(p, target);
  assert.equal(r.status, 'unavailable');
  assert.equal(r.reason, 'external_busy');
});

test('horário livre no calendário externo NÃO significa disponível', () => {
  const r = evaluateParticipant(person('a', [], []), target);
  assert.equal(r.status, 'unknown');
});

test('intervalos que apenas se tocam não geram conflito', () => {
  const p = person('a', [{ start: at(19), end: at(24), state: 'available' }], [{ start: at(23), end: at(24) }]);
  assert.equal(evaluateParticipant(p, target).status, 'available');
});

test('todos parciais resultam em laranja', () => {
  const partial = (id: string) => person(id, [{ start: at(19), end: at(24), state: 'partial' }]);
  const r = evaluateInterval(['a', 'b', 'c'].map(partial), target);
  assert.equal(r.counts.partial, 3);
  assert.equal(r.level, 'orange');
});

test('intervalo inválido e lista vazia lançam erro', () => {
  assert.throws(() => evaluateInterval([free('a')], { start: at(23), end: at(20) }), RangeError);
  assert.throws(() => evaluateInterval([], target), RangeError);
});

test('zonedTimeToUtc: São Paulo (UTC-3) e transição de horário de verão em Nova York', () => {
  assert.equal(zonedTimeToUtc(2026, 10, 16, 20, 0, 'America/Sao_Paulo'), Date.UTC(2026, 9, 16, 23, 0));
  // 7/mar/2026 ainda é EST (UTC-5); 8/mar/2026 já é EDT (UTC-4)
  assert.equal(zonedTimeToUtc(2026, 3, 7, 20, 0, 'America/New_York'), Date.UTC(2026, 2, 8, 1, 0));
  assert.equal(zonedTimeToUtc(2026, 3, 8, 20, 0, 'America/New_York'), Date.UTC(2026, 2, 9, 0, 0));
});

test('findBestDates: candidato único gerado no fuso correto', () => {
  const all = ['a', 'b'].map((id) => person(id, [{ start: at(0), end: at(72), state: 'available' }]));
  const res = findBestDates({
    participants: all,
    rangeStartDate: '2026-10-16',
    rangeEndDate: '2026-10-16',
    timeZone: 'America/Sao_Paulo',
    durationMinutes: 180,
    earliestStart: '20:00',
    latestStart: '20:00',
  });
  assert.equal(res.length, 1);
  assert.equal(res[0]!.interval.start, Date.UTC(2026, 9, 16, 23, 0));
  assert.equal(res[0]!.interval.end, Date.UTC(2026, 9, 17, 2, 0));
});

test('findBestDates: ordena verde antes de laranja e respeita limit', () => {
  const local = (day: number, hour: number) => Date.UTC(2026, 9, day, hour + 3); // UTC-3
  const both = (id: string) =>
    person(id, [
      { start: local(16, 19), end: local(16, 24), state: 'available' },
      { start: local(17, 19), end: local(17, 24), state: 'available' },
    ]);
  const onlyFriday = (id: string) =>
    person(id, [
      { start: local(16, 19), end: local(16, 24), state: 'available' },
      { start: local(17, 12), end: local(17, 24), state: 'unavailable' },
    ]);
  const participants = [...['a', 'b', 'c', 'd'].map(both), onlyFriday('e'), onlyFriday('f')];
  const opts = {
    participants,
    rangeStartDate: '2026-10-16',
    rangeEndDate: '2026-10-17',
    timeZone: 'America/Sao_Paulo',
    durationMinutes: 180,
    earliestStart: '20:00',
    latestStart: '20:00',
  };
  const res = findBestDates(opts);
  assert.deepEqual(res.map((r) => r.level), ['green', 'orange']);
  assert.equal(res[0]!.interval.start, local(16, 20));
  assert.equal(findBestDates({ ...opts, limit: 1 }).length, 1);
});
