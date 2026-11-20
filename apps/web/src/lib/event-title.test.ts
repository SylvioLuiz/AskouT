import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitEventTitle } from './event-title.ts';

test('separa no primeiro ":" e mantém o resto', () => {
  assert.deepEqual(splitEventTitle('Festival X: Noite do Rock'), { lead: 'Festival X:', rest: 'Noite do Rock' });
  assert.deepEqual(splitEventTitle('A: B: C'), { lead: 'A:', rest: 'B: C' });
});

test('sem ":" útil, o título fica inteiro', () => {
  assert.deepEqual(splitEventTitle('Noite do Rock'), { lead: null, rest: 'Noite do Rock' });
  assert.deepEqual(splitEventTitle('Rock:'), { lead: null, rest: 'Rock:' });
  assert.deepEqual(splitEventTitle(': Rock'), { lead: null, rest: ': Rock' });
});
