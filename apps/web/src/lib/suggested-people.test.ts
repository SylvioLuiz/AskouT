import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldShowSuggestions, SUGGESTION_HIDE_MS } from './suggested-people.ts';

const NOW = 1_800_000_000_000;

test('aparece sempre enquanto a pessoa não oculta', () => {
  assert.equal(shouldShowSuggestions(null, NOW), true);
  assert.equal(shouldShowSuggestions(Number.NaN, NOW), true);
});

test('ocultado: some por 3 dias e depois volta', () => {
  assert.equal(shouldShowSuggestions(NOW - 1000, NOW), false);
  assert.equal(shouldShowSuggestions(NOW - SUGGESTION_HIDE_MS + 1, NOW), false);
  assert.equal(shouldShowSuggestions(NOW - SUGGESTION_HIDE_MS, NOW), true);
});
