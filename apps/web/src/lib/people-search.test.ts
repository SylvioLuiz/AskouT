import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesPerson, peopleQuery } from './people-search.ts';

const ana = { username: 'ana.souza', displayName: 'Ana Júlia Souza' };

test('peopleQuery tira @ e espaços', () => {
  assert.equal(peopleQuery('  @ana '), 'ana');
  assert.equal(peopleQuery('@@'), '');
});

test('matchesPerson acha por @ (começo) e por nome (qualquer parte, sem acento)', () => {
  assert.equal(matchesPerson(ana, ''), true);
  assert.equal(matchesPerson(ana, '@ana.s'), true);
  assert.equal(matchesPerson(ana, 'ANA'), true);
  assert.equal(matchesPerson(ana, 'julia'), true);
  assert.equal(matchesPerson(ana, 'souza'), true);
  assert.equal(matchesPerson(ana, '@souza'), true);
  assert.equal(matchesPerson(ana, 'bruno'), false);
});
