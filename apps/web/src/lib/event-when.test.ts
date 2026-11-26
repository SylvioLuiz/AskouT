import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addHoursLocal, followStart, joinLocal, splitLocal, upcomingDays, whenLabel } from './event-when.ts';

describe('quando do evento', () => {
  it('separa e junta dia e hora', () => {
    assert.deepEqual(splitLocal('2026-11-22T22:00'), { date: '2026-11-22', time: '22:00' });
    assert.deepEqual(splitLocal(''), { date: '', time: '' });
    assert.equal(joinLocal('2026-11-22', '22:00'), '2026-11-22T22:00');
    assert.equal(joinLocal('2026-11-22', ''), '');
    assert.equal(joinLocal('', '22:00'), '');
  });
  it('soma horas virando o dia', () => {
    assert.equal(addHoursLocal('2026-11-22T22:00', 3), '2026-11-23T01:00');
    assert.equal(addHoursLocal('', 3), '');
  });
  it('lista hoje, amanhã e os próximos dias', () => {
    const days = upcomingDays(new Date(2026, 10, 19, 9, 0), 4);
    assert.deepEqual(days.map((d) => d.value), ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
    assert.equal(days[0]!.top, 'Hoje');
    assert.equal(days[1]!.top, 'Amanhã');
    assert.equal(days[3]!.day, 22);
    assert.equal(days[30] ?? null, null);
  });
  it('vira o mês nos atalhos', () => {
    const days = upcomingDays(new Date(2026, 10, 29), 3);
    assert.deepEqual(days.map((d) => d.value), ['2026-11-29', '2026-11-30', '2026-12-01']);
  });
  it('resume dia e hora', () => {
    const now = new Date(2026, 10, 19, 9, 0);
    assert.equal(whenLabel('', '', now), '');
    assert.equal(whenLabel('2026-11-19T22:00', '', now), 'hoje · 22:00');
    assert.equal(whenLabel('2026-11-20T21:00', '2026-11-20T23:30', now), 'amanhã · 21:00–23:30');
    assert.equal(whenLabel('2026-11-19T22:00', '2026-11-20T03:00', now), 'hoje · 22:00 até 03:00');
    assert.match(whenLabel('2026-11-22T22:00', '', now), /22.*nov.*· 22:00/);
  });
});

describe('followStart', () => {
  it('o término anda junto com o início, mantendo a duração', () => {
    assert.equal(followStart('2026-12-05T20:00', '2026-12-12T21:30', '2026-12-05T23:00'), '2026-12-13T00:30');
    assert.equal(followStart('2026-12-05T20:00', '2026-12-05T18:00', '2026-12-06T02:00'), '2026-12-06T00:00');
  });
  it('sem término ou com valor inválido, não mexe', () => {
    assert.equal(followStart('2026-12-05T20:00', '2026-12-06T20:00', ''), '');
    assert.equal(followStart('', '2026-12-06T20:00', '2026-12-05T23:00'), '2026-12-05T23:00');
  });
});
