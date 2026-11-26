import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyMention, applyMentionAt, filterMentionCandidates, mentionQueryAt, mentionQueryBefore, splitMentions } from './mentions.ts';

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

test('no chat, a marcação vale no meio do texto (antes do cursor)', () => {
  assert.equal(mentionQueryBefore('oi @an tudo bem', 6), 'an');
  assert.equal(mentionQueryBefore('oi @an tudo bem', 15), undefined);
  assert.deepEqual(applyMentionAt('oi @an tudo bem', 6, 'ana.silva'), { text: 'oi @ana.silva tudo bem', caret: 14 });
  assert.deepEqual(applyMentionAt('oi @', 4, 'bia'), { text: 'oi @bia ', caret: 8 });
  // Cursor no meio do nome: o resto do nome digitado some.
  assert.deepEqual(applyMentionAt('@anx bom', 2, 'ana'), { text: '@ana bom', caret: 5 });
});

test('sugestões do grupo: @ sozinho mostra todos; letras filtram por usuário e nome', () => {
  const people = [
    { username: 'carla', displayName: 'Carla Souza' },
    { username: 'bia_m', displayName: 'Beatriz Melo' },
    { username: 'joao', displayName: 'João Ananias' },
    { username: 'ana', displayName: 'Ana Lima' },
  ];
  assert.equal(filterMentionCandidates(people, '').length, 4);
  assert.deepEqual(filterMentionCandidates(people, 'an').map((p) => p.username), ['ana', 'joao']);
  assert.deepEqual(filterMentionCandidates(people, 'jo').map((p) => p.username), ['joao']);
  assert.deepEqual(filterMentionCandidates(people, 'melo').map((p) => p.username), ['bia_m']);
  assert.deepEqual(filterMentionCandidates(people, 'ouz').map((p) => p.username), ['carla']);
  assert.equal(filterMentionCandidates(people, '', 2).length, 2);
});
