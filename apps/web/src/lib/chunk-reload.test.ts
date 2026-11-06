import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { claimReload, RELOAD_GUARD_MS } from './chunk-reload.ts';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('claimReload', () => {
  it('recarrega na primeira falha', () => {
    assert.equal(claimReload(memory(), 1_000), true);
  });

  it('não recarrega de novo dentro da janela, evitando laço', () => {
    const store = memory();
    assert.equal(claimReload(store, 1_000), true);
    assert.equal(claimReload(store, 1_000 + RELOAD_GUARD_MS - 1), false);
  });

  it('volta a poder recarregar depois da janela (um deploy mais tarde)', () => {
    const store = memory();
    assert.equal(claimReload(store, 1_000), true);
    assert.equal(claimReload(store, 1_000 + RELOAD_GUARD_MS), true);
  });

  it('sem armazenamento ou com armazenamento bloqueado, não recarrega', () => {
    assert.equal(claimReload(null, 1_000), false);
    const broken = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => undefined,
    };
    assert.equal(claimReload(broken, 1_000), false);
  });
});
