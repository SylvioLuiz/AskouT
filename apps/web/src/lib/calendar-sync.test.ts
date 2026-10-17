import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addSynced, parseSynced, removeSynced } from './calendar-sync.ts';

test('lê só valores válidos, sem repetir, na ordem de exibição', () => {
  assert.deepEqual(parseSynced(null), []);
  assert.deepEqual(parseSynced('lixo'), []);
  assert.deepEqual(parseSynced('{"a":1}'), []);
  assert.deepEqual(parseSynced('["OUTLOOK","GOOGLE","GOOGLE","X"]'), ['GOOGLE', 'OUTLOOK']);
});

test('sincronizar soma às já ligadas e dessincronizar tira só a escolhida', () => {
  assert.deepEqual(addSynced(['GOOGLE'], ['PHONE']), ['PHONE', 'GOOGLE']);
  assert.deepEqual(addSynced(['GOOGLE'], ['GOOGLE']), ['GOOGLE']);
  assert.deepEqual(removeSynced(['PHONE', 'GOOGLE'], 'PHONE'), ['GOOGLE']);
  assert.deepEqual(removeSynced(['GOOGLE'], 'OUTLOOK'), ['GOOGLE']);
});
