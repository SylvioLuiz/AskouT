import assert from 'node:assert/strict';
import { test } from 'node:test';
import { goingLabel, peopleLabel, statusLabel, toggleId } from './meetup.ts';

test('goingLabel e peopleLabel', () => {
  assert.equal(goingLabel({ confirmedCount: 1, invitedCount: 0 }), '1 confirmado');
  assert.equal(goingLabel({ confirmedCount: 3, invitedCount: 2 }), '3 confirmados · 2 aguardando');
  assert.equal(peopleLabel(1), '1 pessoa');
  assert.equal(peopleLabel(4), '4 pessoas');
});

test('statusLabel e toggleId', () => {
  assert.equal(statusLabel('CONFIRMED'), 'Você vai');
  assert.equal(statusLabel('INVITED'), null);
  assert.deepEqual(toggleId(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleId(['a', 'b'], 'a'), ['b']);
});
