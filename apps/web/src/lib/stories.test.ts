import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextStory, prevStory, startOf } from './stories.ts';

const groups = [
  { author: { userId: 'a' }, items: [1, 2] },
  { author: { userId: 'b' }, items: [1] },
] as never[];

test('passa de story em story, de pessoa em pessoa, e fecha no último', () => {
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

test('abre no primeiro story da pessoa tocada', () => {
  assert.deepEqual(startOf(groups, 'b'), { group: 1, item: 0 });
  assert.equal(startOf(groups, 'z'), null);
});
