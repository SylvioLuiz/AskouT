import assert from 'node:assert/strict';
import { test } from 'node:test';
import { badgeProgressText, broughtText } from './referrals.ts';

test('broughtText: singular com um amigo, plural nos demais', () => {
  assert.equal(broughtText(1), 'Você trouxe 1 amigo');
  assert.equal(broughtText(0), 'Você trouxe 0 amigos');
  assert.equal(broughtText(5), 'Você trouxe 5 amigos');
});

test('badgeProgressText: mostra o progresso até o selo e a conquista', () => {
  assert.match(badgeProgressText({ confirmed: 1, badgeThreshold: 3, badgeEarned: false }), /^1 de 3 amigos já voltaram/);
  assert.match(badgeProgressText({ confirmed: 3, badgeThreshold: 3, badgeEarned: true }), /ganhou o selo/);
});
