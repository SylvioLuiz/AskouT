import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyMention, mentionQueryAt, splitMentions } from './mentions.ts';

test('detecta marcação em andamento só no fim do texto', () => {
  assert.equal(mentionQueryAt('oi @An'), 'an');
  assert.equal(mentionQueryAt('@'), '');
  assert.equal(mentionQueryAt('oi @ana e'), undefined);
  assert.equal(mentionQueryAt('ana@exemplo'), undefined);
});

test('escolher alguém troca a marcação e deixa um espaço', () => {
  assert.equal(applyMention('oi @an', 'ana.silva'), 'oi @ana.silva ');
  assert.equal(applyMention('@', 'bia'), '@bia ');
});

test('só vira link quem existe; o resto fica texto', () => {
  assert.deepEqual(splitMentions('Vem @Ana, e @fulano!', ['ana']), [
    { text: 'Vem ' },
    { text: '@Ana', mention: 'ana' },
    { text: ', e @fulano!' },
  ]);
  assert.deepEqual(splitMentions('sem nada', []), [{ text: 'sem nada' }]);
  assert.deepEqual(splitMentions('@ana.', ['ana']), [{ text: '@ana', mention: 'ana' }, { text: '.' }]);
});
