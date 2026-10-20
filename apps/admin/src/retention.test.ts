import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isThin, pct, pointsDiff, returnVerdict, seconds } from './retention.ts';

const r = (sample: number, returned: number) => ({ sample, returned, rate: sample ? returned / sample : null });

test('porcentagem e tempo em português', () => {
  assert.equal(pct(0.1234), '12,3%');
  assert.equal(pct(null), '—');
  assert.equal(seconds(4200), '4,2 s');
  assert.equal(seconds(75_000), '1 min 15 s');
  assert.equal(seconds(null), '—');
});

test('diferença em pontos', () => {
  assert.equal(pointsDiff(0.5, 0.4)?.toFixed(1), '10.0');
  assert.equal(pointsDiff(null, 0.4), null);
});

test('amostra pequena', () => {
  assert.equal(isThin({ sample: 29 }, 30), true);
  assert.equal(isThin({ sample: 30 }, 30), false);
});

test('veredito: avisa quando há poucos dados, nunca afirma causa', () => {
  assert.match(returnVerdict(r(10, 5), r(100, 40), 30), /^Poucos dados/);
  assert.match(returnVerdict(r(100, 50), r(100, 40), 30), /10,0 pontos percentuais mais.*não prova causa/);
  assert.match(returnVerdict(r(100, 30), r(100, 40), 30), /10,0 pontos percentuais menos/);
  assert.match(returnVerdict(r(100, 41), r(100, 40), 30), /quase igual/);
});
