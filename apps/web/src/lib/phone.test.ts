import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, normalizePhone } from './phone.ts';

test('celular: vira E.164, entendendo Brasil quando falta o código do país', () => {
  assert.equal(normalizePhone('(11) 98765-4321'), '+5511987654321');
  assert.equal(normalizePhone('11 3456-7890'), '+551134567890');
  assert.equal(normalizePhone('011 98765-4321'), '+5511987654321');
  assert.equal(normalizePhone('0 21 11 98765 4321'), '+5511987654321');
  assert.equal(normalizePhone('+55 11 98765-4321'), '+5511987654321');
  assert.equal(normalizePhone('5511987654321'), '+5511987654321');
  assert.equal(normalizePhone('0055 11 98765 4321'), '+5511987654321');
  assert.equal(normalizePhone('+1 (415) 555-2671'), '+14155552671');
  assert.equal(normalizePhone('+351 912 345 678'), '+351912345678');
});

test('celular: recusa o que não é número de telefone', () => {
  for (const bad of ['', '   ', '123', '98765-4321', '+55 01 98765-4321', 'abc', '+0123456789', '+55 11 1234']) {
    assert.equal(normalizePhone(bad), undefined, bad);
  }
});

test('celular: mostra no formato brasileiro', () => {
  assert.equal(formatPhone('+5511987654321'), '(11) 98765-4321');
  assert.equal(formatPhone('+551134567890'), '(11) 3456-7890');
  assert.equal(formatPhone('+14155552671'), '+14155552671');
});
