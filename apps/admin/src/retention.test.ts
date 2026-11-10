import assert from 'node:assert/strict';
import { test } from 'node:test';
import { experimentVerdict, isThin, pct, pointsDiff, returnVerdict, seconds } from './retention.ts';

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

test('frase do teste A/B: palpite, sem efeito e com efeito', () => {
  const d = { diff: 0.05, low: 0.01, high: 0.09, significant: true };
  assert.match(experimentVerdict(null, true, 30), /Sem dados/);
  assert.match(experimentVerdict(d, true, 30), /Poucos dados.*\+5,0.*palpite/);
  assert.match(experimentVerdict({ ...d, low: -0.01, significant: false }, false, 30), /inclui zero/);
  assert.match(experimentVerdict(d, false, 30), /aumentou o retorno/);
  assert.match(experimentVerdict({ diff: -0.05, low: -0.09, high: -0.01, significant: true }, false, 30), /diminuiu/);
});
