import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './pipeline.ts';
import { dedupKey } from './dedup.ts';
import { score } from './confidence.ts';
import type { Candidate } from './types.ts';

const now = new Date('2026-11-23T12:00:00Z');
const base: Candidate = { source: 's', sourceUrl: 'https://x.com/e', officialSource: true, title: 'Samba no Bar', venueName: 'Bar do Zé', startsAt: '2026-12-01T22:00:00Z', imageUrl: 'https://x.com/i.jpg' };
const opt = { mode: 'publish' as const, minConfidence: 90 };

test('tudo certo publica', () => {
  const r = evaluate(base, { venueMatched: true, sourceCount: 2, now }, opt);
  assert.equal(r.total, 100); assert.equal(r.decision, 'PUBLISH');
});
test('observação nunca publica', () => {
  assert.equal(evaluate(base, { venueMatched: true, sourceCount: 2, now }, { ...opt, mode: 'observation' }).decision, 'REVIEW');
});
test('sem imagem fica abaixo de 90 e vai para revisão', () => {
  const r = evaluate({ ...base, imageUrl: undefined }, { venueMatched: true, sourceCount: 1, now }, opt);
  assert.ok(r.total < 90); assert.equal(r.decision, 'REVIEW');
});
test('imagem http não conta', () => {
  assert.equal(score({ ...base, imageUrl: 'http://x.com/i.jpg' }, { venueMatched: true, sourceCount: 1, now }).breakdown.image, 0);
});
test('sem local vai para a seção separada', () => {
  assert.equal(evaluate({ ...base, venueName: undefined }, { venueMatched: false, sourceCount: 1, now }, opt).decision, 'NO_VENUE');
});
test('data passada não pontua', () => {
  assert.equal(score({ ...base, startsAt: '2026-01-01T00:00:00Z' }, { venueMatched: true, sourceCount: 1, now }).breakdown.dateTime, 0);
});
test('dedup ignora acento, caixa e fonte', () => {
  assert.equal(dedupKey(base), dedupKey({ ...base, source: 'outra', title: 'SAMBA no bar', venueName: 'bar do ze' }));
});
