import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { followProgressLabel, markOnboardingDone, onboardingDone, ONBOARDING_SLIDES } from './onboarding.ts';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('onboarding', () => {
  it('tem as 3 telas combinadas', () => {
    assert.deepEqual(ONBOARDING_SLIDES.map((s) => s.title), ['Siga bares e baladas, veja eventos', 'Amigo é quem se segue', 'Flash: encontre quem quer sair agora']);
  });
  it('lembra por usuário', () => {
    const s = memory();
    assert.equal(onboardingDone(s, 'a'), false);
    markOnboardingDone(s, 'a');
    assert.equal(onboardingDone(s, 'a'), true);
    assert.equal(onboardingDone(s, 'b'), false);
  });
  it('sem armazenamento não quebra', () => {
    assert.equal(onboardingDone(undefined, 'a'), false);
    markOnboardingDone(undefined, 'a');
    assert.equal(onboardingDone({ getItem: () => { throw new Error('x'); } }, 'a'), false);
  });
  it('progresso do follow', () => {
    assert.equal(followProgressLabel(0), 'Siga mais 3 rolês (0 de 3)');
    assert.equal(followProgressLabel(2), 'Siga mais 1 rolê (2 de 3)');
    assert.match(followProgressLabel(3), /Pronto/);
  });
});
