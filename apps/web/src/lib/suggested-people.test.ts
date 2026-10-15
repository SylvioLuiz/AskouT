import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldShowSuggestions, SUGGESTION_EVERY_MS } from './suggested-people.ts';

const NOW = 1_800_000_000_000;

test('segue menos de 5: sempre aparece', () => {
  assert.equal(shouldShowSuggestions(0, NOW - 1000, NOW), true);
  assert.equal(shouldShowSuggestions(4, NOW, NOW), true);
});

test('segue 5 ou mais: só de 3 em 3 dias', () => {
  assert.equal(shouldShowSuggestions(5, null, NOW), true);
  assert.equal(shouldShowSuggestions(5, NOW - SUGGESTION_EVERY_MS + 1, NOW), false);
  assert.equal(shouldShowSuggestions(20, NOW - SUGGESTION_EVERY_MS, NOW), true);
  assert.equal(shouldShowSuggestions(20, Number.NaN, NOW), true);
});
