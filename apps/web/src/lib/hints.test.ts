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

import { FLASH_PRIVACY_POINTS, flashNoticeSeen, markFlashNoticeSeen } from './hints.ts';

describe('aviso de privacidade do Flash', () => {
  it('lembra depois de visto', () => {
    const data = new Map<string, string>();
    const s = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    assert.equal(flashNoticeSeen(s), false);
    markFlashNoticeSeen(s);
    assert.equal(flashNoticeSeen(s), true);
    assert.equal(flashNoticeSeen(undefined), false);
  });
  it('tem os pontos combinados', () => {
    assert.equal(FLASH_PRIVACY_POINTS.length, 4);
    assert.ok(FLASH_PRIVACY_POINTS.every((p) => p.length > 20));
  });
});
