import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLimitInput, parsePriceInput } from './cloakroom.ts';

test('preço digitado vira centavos; vazio e zero são grátis', () => {
  assert.equal(parsePriceInput(''), null);
  assert.equal(parsePriceInput('0'), null);
  assert.equal(parsePriceInput('12,50'), 1250);
  assert.equal(parsePriceInput('5'), 500);
  assert.equal(parsePriceInput('1.5'), 150);
  assert.equal(parsePriceInput('abc'), undefined);
  assert.equal(parsePriceInput('1,234'), undefined);
});

test('limite digitado: vazio é sem limite; zero e texto são inválidos', () => {
  assert.equal(parseLimitInput(' '), null);
  assert.equal(parseLimitInput('50'), 50);
  assert.equal(parseLimitInput('0'), undefined);
  assert.equal(parseLimitInput('2x'), undefined);
});
