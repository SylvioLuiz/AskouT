import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendPage, applyReaction, commentCountLabel, policyNote, reactionSummary } from './feed.ts';
import type { FeedPost } from './types.ts';

test('reagir, trocar e tirar a reação atualiza as contagens na hora', () => {
  const start = { counts: [{ emoji: '❤️', count: 2 }, { emoji: '😂', count: 1 }], mine: null };
  const liked = applyReaction(start, '❤️');
  assert.deepEqual(liked, { mine: '❤️', counts: [{ emoji: '❤️', count: 3 }, { emoji: '😂', count: 1 }] });
  const swapped = applyReaction(liked, '😂');
  assert.deepEqual(swapped, { mine: '😂', counts: [{ emoji: '❤️', count: 2 }, { emoji: '😂', count: 2 }] });
  const removed = applyReaction({ counts: [{ emoji: '🔥', count: 1 }], mine: '🔥' }, null);
  assert.deepEqual(removed, { mine: null, counts: [] });
});

test('resumo: total e os três emojis mais usados', () => {
  assert.deepEqual(reactionSummary({ counts: [{ emoji: '❤️', count: 3 }, { emoji: '😂', count: 2 }, { emoji: '🔥', count: 1 }, { emoji: '👍', count: 1 }], mine: null }), { total: 7, top: ['❤️', '😂', '🔥'] });
  assert.deepEqual(reactionSummary({ counts: [], mine: null }), { total: 0, top: [] });
});

test('próxima página não repete publicações', () => {
  const p = (id: string) => ({ id }) as FeedPost;
  assert.deepEqual(appendPage([p('a'), p('b')], [p('b'), p('c')]).map((x) => x.id), ['a', 'b', 'c']);
});

test('textos de regra e de comentários', () => {
  assert.match(policyNote({ policy: 'OPEN', hasModerator: false, isModerator: false }), /não tem responsável/);
  assert.match(policyNote({ policy: 'MODERATED', hasModerator: true, isModerator: false }), /aprova/);
  assert.match(policyNote({ policy: 'OWNER_ONLY', hasModerator: true, isModerator: true }), /^Só eu/);
  assert.equal(commentCountLabel(1), '1 comentário');
  assert.equal(commentCountLabel(4), '4 comentários');
});
