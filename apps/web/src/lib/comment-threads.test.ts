import assert from 'node:assert/strict';
import { test } from 'node:test';
import { removeComment, replyPrefill, threadComments } from './comment-threads.ts';

test('respostas ficam logo abaixo do comentário de cima, na ordem em que chegaram', () => {
  const items = [
    { id: 'a', parentId: null },
    { id: 'b', parentId: null },
    { id: 'a1', parentId: 'a' },
    { id: 'b1', parentId: 'b' },
    { id: 'a2', parentId: 'a' },
  ];
  assert.deepEqual(
    threadComments(items).map((r) => [r.comment.id, r.reply]),
    [['a', false], ['a1', true], ['a2', true], ['b', false], ['b1', true]],
  );
});

test('resposta sem o comentário de cima na lista aparece como comentário comum', () => {
  assert.deepEqual(threadComments([{ id: 'x1', parentId: 'x' }]).map((r) => r.reply), [false]);
});

test('apagar o comentário de cima solta as respostas', () => {
  const left = removeComment([{ id: 'a', parentId: null }, { id: 'a1', parentId: 'a' }], 'a');
  assert.deepEqual(left, [{ id: 'a1', parentId: null }]);
});

test('responder marca a pessoa com @, sem repetir nem marcar você mesmo', () => {
  assert.equal(replyPrefill('', 'bia', false), '@bia ');
  assert.equal(replyPrefill('@bia oi', 'bia', false), '@bia oi');
  assert.equal(replyPrefill('@caio oi', 'bia', false), '@bia oi', 'trocar de resposta troca a marcação');
  assert.equal(replyPrefill('oi', 'eu', true), 'oi');
  assert.equal(replyPrefill('oi', undefined, false), 'oi');
});
