import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { takeFirstFollowHint } from './hints.ts';

describe('dica do primeiro Seguir', () => {
  it('só na primeira vez', () => {
    const data = new Map<string, string>();
    const s = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    assert.equal(takeFirstFollowHint(s), true);
    assert.equal(takeFirstFollowHint(s), false);
  });
  it('sem armazenamento mostra', () => {
    assert.equal(takeFirstFollowHint(undefined), true);
  });
});
