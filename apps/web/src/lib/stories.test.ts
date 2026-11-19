import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextStory, prevStory, queueFrom, startOf } from './stories.ts';

const groups = [
  { author: { userId: 'a' }, items: [1, 2] },
  { author: { userId: 'b' }, items: [1] },
] as never[];

test('passa de flash em flash, de pessoa em pessoa, e fecha no último', () => {
  assert.deepEqual(nextStory(groups, { group: 0, item: 0 }), { group: 0, item: 1 });
  assert.deepEqual(nextStory(groups, { group: 0, item: 1 }), { group: 1, item: 0 });
  assert.equal(nextStory(groups, { group: 1, item: 0 }), null);
  assert.equal(nextStory(groups, { group: 5, item: 0 }), null);
});

test('voltar vai ao anterior e, no primeiro de todos, recomeça', () => {
  assert.deepEqual(prevStory(groups, { group: 1, item: 0 }), { group: 0, item: 1 });
  assert.deepEqual(prevStory(groups, { group: 0, item: 1 }), { group: 0, item: 0 });
  assert.deepEqual(prevStory(groups, { group: 0, item: 0 }), { group: 0, item: 0 });
});

test('abre no primeiro flash da pessoa tocada', () => {
  assert.deepEqual(startOf(groups, 'b'), { group: 1, item: 0 });
  assert.equal(startOf(groups, 'z'), null);
});

test('a fila começa em quem foi tocado e segue a ordem do "Quem vai", passando por todo mundo', () => {
  // Servidor manda do mais recente para o mais antigo; a faixa mostra outra ordem.
  const fromServer = [{ author: { userId: 'c' } }, { author: { userId: 'a' } }, { author: { userId: 'z' } }, { author: { userId: 'b' } }];
  const ids = (q: { author: { userId: string } }[]) => q.map((g) => g.author.userId);
  assert.deepEqual(ids(queueFrom(fromServer, ['a', 'x', 'b', 'c'], 'b')), ['b', 'c', 'a', 'z'], 'segue a faixa, volta ao começo, e quem não está nela vai no fim');
  assert.deepEqual(ids(queueFrom(fromServer, ['a', 'b', 'c'], 'a')), ['a', 'b', 'c', 'z']);
  assert.deepEqual(ids(queueFrom(fromServer, ['a', 'b'], 'z')), ['z', 'a', 'b', 'c'], 'quem não está na faixa abre primeiro mesmo assim');
});
