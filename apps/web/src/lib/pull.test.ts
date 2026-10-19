import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PULL_MAX, isVerticalPull, pullDistance, shouldRefresh } from './pull.ts';

test('o indicador acompanha o dedo com resistência e para no máximo', () => {
  assert.equal(pullDistance(-20), 0);
  assert.equal(pullDistance(0), 0);
  assert.equal(pullDistance(60), 30);
  assert.equal(pullDistance(1000), PULL_MAX);
});

test('só atualiza se puxou o bastante', () => {
  assert.equal(shouldRefresh(pullDistance(40)), false);
  assert.equal(shouldRefresh(pullDistance(70)), true);
  assert.equal(shouldRefresh(0), false);
});

test('rolagem de lado não conta como puxão', () => {
  assert.equal(isVerticalPull(2, 30), true);
  assert.equal(isVerticalPull(40, 30), false);
  assert.equal(isVerticalPull(0, 3), false);
  assert.equal(isVerticalPull(0, -30), false);
});
