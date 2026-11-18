import assert from 'node:assert/strict';
import { it } from 'node:test';
import { railBefore, railIndexAt, railIndexOf, railMonths } from './date-rail.ts';

it('meses do atual ao do post mais antigo', () => {
  const months = railMonths(new Date(2026, 10, 18), new Date(2025, 9, 3).toISOString());
  assert.equal(months.length, 14);
  assert.deepEqual(months[0], { year: 2026, month: 10 });
  assert.deepEqual(months[13], { year: 2025, month: 9 });
});

it('sem régua quando não há para onde pular', () => {
  assert.deepEqual(railMonths(new Date(2026, 10, 18), null), []);
  assert.deepEqual(railMonths(new Date(2026, 10, 18), new Date(2026, 10, 2).toISOString()), []);
  assert.deepEqual(railMonths(new Date(2026, 10, 18), 'x'), []);
});

it('posição na régua vira mês e volta', () => {
  assert.equal(railIndexAt(0, 10), 0);
  assert.equal(railIndexAt(0.55, 10), 5);
  assert.equal(railIndexAt(1, 10), 9);
  assert.equal(railIndexAt(-3, 10), 0);
  const months = railMonths(new Date(2026, 10, 18), new Date(2025, 0, 1).toISOString());
  assert.equal(railIndexOf(months, new Date(2026, 7, 9)), 3);
  assert.equal(railIndexOf(months, new Date(2020, 0, 1)), months.length - 1);
});

it('pular para um mês pede o que veio antes do mês seguinte', () => {
  assert.equal(railBefore({ year: 2025, month: 11 }), new Date(2026, 0, 1).toISOString());
});
