import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PRESETS,
  addDays,
  buildSlot,
  dayChip,
  dayLongLabel,
  daysFrom,
  instantRangeLabel,
  localDateKey,
  rangeForDays,
  slotsOnDay,
  startOfDay,
  statesOnDay,
  timeRangeLabel,
} from './agenda.ts';
import type { Slot } from './types.ts';

// Estes testes dependem do fuso (o app usa o do aparelho); o script de teste fixa TZ=America/Sao_Paulo.
const NOW = new Date(2026, 9, 13, 12, 0); // 13/out/2026 12:00 local

const slot = (id: string, key: string, from: string, to: string, state: Slot['state'] = 'AVAILABLE'): Slot => {
  const built = buildSlot(key, from, to, new Date(2020, 0, 1));
  assert.ok(built.ok);
  return { id, start: built.start, end: built.end, state };
};

describe('datas locais', () => {
  it('localDateKey, addDays e daysFrom', () => {
    assert.equal(localDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.deepEqual(daysFrom('2026-10-30', 3), ['2026-10-30', '2026-10-31', '2026-11-01']);
  });

  it('startOfDay e rangeForDays usam a meia-noite local', () => {
    assert.equal(startOfDay('2026-10-20').getHours(), 0);
    const r = rangeForDays('2026-10-20', 2);
    assert.equal(new Date(r.from).getDate(), 20);
    assert.equal(new Date(r.to).getDate(), 22);
    assert.equal(new Date(r.to).getHours(), 0);
  });

  it('dayChip e dayLongLabel em português', () => {
    assert.deepEqual(dayChip('2026-10-20'), { weekday: 'ter', day: '20' });
    assert.equal(dayLongLabel('2026-10-20'), 'terça-feira, 20 de outubro');
  });
});

describe('buildSlot', () => {
  it('monta o horário no relógio local e devolve ISO em UTC', () => {
    const r = buildSlot('2026-10-20', '19:00', '23:00', NOW);
    assert.ok(r.ok);
    assert.equal(new Date(r.start).getHours(), 19);
    assert.equal(new Date(r.end).getHours(), 23);
    assert.equal(r.start, new Date(2026, 9, 20, 19, 0).toISOString());
  });

  it('fim 00:00 significa meia-noite do dia seguinte', () => {
    const r = buildSlot('2026-10-20', '18:00', '00:00', NOW);
    assert.ok(r.ok);
    assert.equal(r.end, new Date(2026, 9, 21, 0, 0).toISOString());
    assert.equal(PRESETS.find((p) => p.label === 'Noite')!.end, '00:00');
  });

  it('recusa campos vazios, fim antes do início e horário que já passou', () => {
    assert.deepEqual(buildSlot('2026-10-20', '', '23:00', NOW), { ok: false, field: 'start', message: 'Informe a hora de início' });
    assert.deepEqual(buildSlot('2026-10-20', '19:00', '', NOW), { ok: false, field: 'end', message: 'Informe a hora de fim' });
    assert.deepEqual(buildSlot('2026-10-20', '23:00', '19:00', NOW), { ok: false, field: 'end', message: 'O fim precisa ser depois do início' });
    assert.deepEqual(buildSlot('2026-10-20', '19:00', '19:00', NOW), { ok: false, field: 'end', message: 'O fim precisa ser depois do início' });
    assert.deepEqual(buildSlot('2026-10-13', '08:00', '11:00', NOW), { ok: false, field: 'start', message: 'Esse horário já passou' });
    assert.ok(buildSlot('2026-10-13', '08:00', '13:00', NOW).ok, 'ainda em andamento pode');
  });
});

describe('horários por dia', () => {
  const a = slot('a', '2026-10-20', '19:00', '23:00');
  const b = slot('b', '2026-10-20', '08:00', '12:00', 'PARTIAL');
  const night = slot('n', '2026-10-20', '18:00', '00:00', 'UNAVAILABLE');

  it('slotsOnDay filtra pelo dia local e ordena por início', () => {
    assert.deepEqual(slotsOnDay([a, b], '2026-10-20').map((s) => s.id), ['b', 'a']);
    assert.deepEqual(slotsOnDay([a, b], '2026-10-21'), []);
    assert.deepEqual(slotsOnDay([a, b], '2026-10-19'), []);
  });

  it('um horário que termina à meia-noite não aparece no dia seguinte', () => {
    assert.equal(slotsOnDay([night], '2026-10-21').length, 0);
    assert.equal(slotsOnDay([night], '2026-10-20').length, 1);
  });

  it('um horário que atravessa a meia-noite aparece nos dois dias', () => {
    const late = slot('l', '2026-10-20', '22:00', '23:30');
    const crossing: Slot = { id: 'x', start: new Date(2026, 9, 20, 22, 0).toISOString(), end: new Date(2026, 9, 21, 2, 0).toISOString(), state: 'AVAILABLE' };
    assert.equal(slotsOnDay([late, crossing], '2026-10-21').length, 1);
    assert.equal(timeRangeLabel(crossing, '2026-10-20'), '22:00 – 24:00 (continua amanhã)');
    assert.equal(timeRangeLabel(crossing, '2026-10-21'), '00:00 – 02:00 (começou ontem)');
  });

  it('statesOnDay lista os estados sem repetir, em ordem fixa', () => {
    assert.deepEqual(statesOnDay([night, a, b], '2026-10-20'), ['AVAILABLE', 'PARTIAL', 'UNAVAILABLE']);
    assert.deepEqual(statesOnDay([a], '2026-10-21'), []);
  });

  it('timeRangeLabel e instantRangeLabel', () => {
    assert.equal(timeRangeLabel(a, '2026-10-20'), '19:00 – 23:00');
    assert.equal(timeRangeLabel(night, '2026-10-20'), '18:00 – 24:00');
    assert.equal(instantRangeLabel(a.start, a.end), 'ter., 20 de out. · 19:00 – 23:00');
  });
});
