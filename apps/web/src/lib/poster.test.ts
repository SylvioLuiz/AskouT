import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmedLabel, dateTile } from './poster.ts';

test('selo de data: dia da semana, dia e mês em maiúsculas', () => {
  const tile = dateTile(new Date(2026, 9, 25, 20, 0).toISOString());
  assert.deepEqual(tile, { weekday: 'DOM', day: '25', month: 'OUT' });
  assert.equal(dateTile('lixo'), null);
});

test('rótulo de confirmados', () => {
  assert.equal(confirmedLabel(undefined), '');
  assert.equal(confirmedLabel(0), 'Seja o primeiro a confirmar');
  assert.equal(confirmedLabel(1), '1 confirmado');
  assert.equal(confirmedLabel(12), '12 confirmados');
});
