import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GROUP_MAX_FRIENDS, scoreLabel, togglePerson } from './group-match.ts';

describe('sugestões para o grupo (web)', () => {
  it('marca e desmarca pessoas', () => {
    assert.deepEqual(togglePerson([], 'a'), ['a']);
    assert.deepEqual(togglePerson(['a', 'b'], 'a'), ['b']);
  });
  it('não passa do limite', () => {
    const full = Array.from({ length: GROUP_MAX_FRIENDS }, (_, i) => `p${i}`);
    assert.deepEqual(togglePerson(full, 'novo'), full);
    assert.equal(togglePerson(full, 'p0').length, GROUP_MAX_FRIENDS - 1);
  });
  it('dá nome à nota', () => {
    assert.equal(scoreLabel(90), 'Tudo a ver');
    assert.equal(scoreLabel(60), 'Combina bem');
    assert.equal(scoreLabel(10), 'Vale a ideia');
  });
});
