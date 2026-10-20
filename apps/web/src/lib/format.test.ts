import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { timeAgo } from './format.ts';

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
