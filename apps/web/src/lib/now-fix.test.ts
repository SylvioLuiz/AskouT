import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recentNowFix, rememberNowFix } from './now-fix.ts';

test('now-fix: devolve a última posição só enquanto é recente (2 min)', () => {
  rememberNowFix({ lat: -23.5, lng: -46.6, accuracyM: 12 }, 1_000);
  assert.deepEqual(recentNowFix(60_000), { lat: -23.5, lng: -46.6, accuracyM: 12 });
  assert.equal(recentNowFix(1_000 + 2 * 60_000 + 1), undefined);
});
