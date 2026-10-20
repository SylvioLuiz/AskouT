import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextTickMs, timeAgo } from './format.ts';

describe('timeAgo', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  it('formata em português', () => {
    assert.equal(timeAgo('2026-10-13T11:59:50Z', now), 'agora');
    assert.equal(timeAgo('2026-10-13T11:55:00Z', now), 'há 5 min');
    assert.equal(timeAgo('2026-10-13T09:00:00Z', now), 'há 3 h');
    assert.equal(timeAgo('2026-10-12T09:00:00Z', now), 'há 1 dia');
    assert.equal(timeAgo('2026-10-10T09:00:00Z', now), 'há 3 dias');
    assert.equal(timeAgo('2026-10-14T09:00:00Z', now), 'agora', 'relógio adiantado não vira negativo');
  });
});

describe('timeAgo com segundos', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  it('mostra segundos só quando pedido e só no 1º minuto', () => {
    assert.equal(timeAgo('2026-10-13T11:59:48Z', now, { seconds: true }), 'há 12 s');
    assert.equal(timeAgo('2026-10-13T11:59:48Z', now), 'agora');
    assert.equal(timeAgo('2026-10-13T12:00:00Z', now, { seconds: true }), 'agora');
    assert.equal(timeAgo('2026-10-13T11:55:00Z', now, { seconds: true }), 'há 5 min');
  });
  it('define quando atualizar de novo', () => {
    const t = Date.parse('2026-10-13T12:00:00Z');
    assert.equal(nextTickMs('2026-10-13T11:59:50Z', t), 1000);
    assert.equal(nextTickMs('2026-10-13T11:50:00Z', t), 30_000);
    assert.equal(nextTickMs('2026-10-13T09:00:00Z', t), null);
    assert.equal(nextTickMs('lixo', t), null);
  });
});
