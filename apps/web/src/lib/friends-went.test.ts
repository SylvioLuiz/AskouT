import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { friendsWentLabel } from './venue-profile.ts';

describe('amigos que já foram', () => {
  it('texto por quantidade', () => {
    assert.equal(friendsWentLabel({ count: 0, sample: [] }), '');
    assert.equal(friendsWentLabel({ count: 1, sample: [{ username: 'bia' }] }), '@bia já foi aqui');
    assert.equal(friendsWentLabel({ count: 2, sample: [{ username: 'bia' }, { username: 'caio' }] }), '@bia e mais 1 amigo já foram aqui');
    assert.equal(friendsWentLabel({ count: 5, sample: [{ username: 'bia' }] }), '@bia e mais 4 amigos já foram aqui');
  });
});
