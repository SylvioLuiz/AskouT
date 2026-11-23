import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactName, nameMatches } from './explore-match.ts';

test('busca de local ignora acento, maiúscula, pontuação e espaços', () => {
  assert.ok(nameMatches('WHATS BAR', 'whats bar'));
  assert.ok(nameMatches("What's Bar", 'whats bar'));
  assert.ok(nameMatches('WHATS BAR', 'whatsbar'));
  assert.ok(nameMatches('Café do Zé', 'cafe do ze'));
  assert.ok(!nameMatches('Bar do Zé', 'whats'));
  assert.equal(compactName("What's Bar!"), 'whatsbar');
});
