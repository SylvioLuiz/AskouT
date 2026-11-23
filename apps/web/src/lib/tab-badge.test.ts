import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tabTitle } from './tab-badge.ts';

test('tabTitle: número na frente só quando há mensagem nova', () => {
  assert.equal(tabTitle('Conversas · AskouT', 0), 'Conversas · AskouT');
  assert.equal(tabTitle('Conversas · AskouT', 2), '(2) Conversas · AskouT');
  assert.equal(tabTitle('AskouT', 150), '(99+) AskouT');
});
