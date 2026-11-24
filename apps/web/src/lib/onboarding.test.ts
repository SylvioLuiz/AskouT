import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { followProgressLabel, markOnboardingDone, onboardingDone, placesFromEvents, shouldShowOnboarding, TOUR_STEPS, tourPlacement, tourProgressLabel } from './onboarding.ts';
import type { ExploreEvent } from './types.ts';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('onboarding', () => {
  it('o tour passa pelos botões principais, na ordem do menu', () => {
    assert.deepEqual(TOUR_STEPS.map((s) => s.target), ['home', 'explore', 'create', 'now', 'agenda', 'chats', 'profile']);
    assert.equal(TOUR_STEPS.find((s) => s.target === 'create')?.to, undefined, 'Criar só explica: o toque abriria uma janela');
    assert.equal(tourProgressLabel(1), '2 de 7');
  });
  it('balão ao lado no menu lateral, acima na barra de baixo, abaixo na barra de cima', () => {
    const desk = { width: 1280, height: 800 };
    const phone = { width: 390, height: 844 };
    assert.equal(tourPlacement({ left: 12, right: 220, top: 100, bottom: 140 }, desk), 'right');
    assert.equal(tourPlacement({ left: 0, right: 78, top: 780, bottom: 844 }, phone), 'above');
    assert.equal(tourPlacement({ left: 300, right: 340, top: 10, bottom: 50 }, phone), 'below');
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
  it('só aparece no primeiro login: a conta manda, o navegador ajuda', () => {
    const s = memory();
    assert.equal(shouldShowOnboarding(s, { id: 'a', onboarded: false }), true);
    assert.equal(shouldShowOnboarding(s, { id: 'a', onboarded: true }), false, 'já visto em outro aparelho');
    assert.equal(shouldShowOnboarding(s, { id: 'a' }), true, 'API antiga sem o campo');
    markOnboardingDone(s, 'a');
    assert.equal(shouldShowOnboarding(s, { id: 'a', onboarded: false }), false, 'já visto neste navegador');
  });
  it('progresso do follow', () => {
    assert.equal(followProgressLabel(0), 'Siga mais 3 locais (0 de 3)');
    assert.equal(followProgressLabel(2), 'Siga mais 1 local (2 de 3)');
    assert.match(followProgressLabel(3), /Pronto/);
  });
  it('sem locais perto, usa os locais dos próximos eventos (um por local, sem evento de pessoa sem rolê)', () => {
    const ev = (id: string, venueId: string, name: string): ExploreEvent => ({
      id, title: id, description: null, startsAt: '2026-11-22T20:00:00Z', endsAt: '2026-11-22T23:00:00Z', kind: 'PARTY' as ExploreEvent['kind'], isFree: false, imageUrl: null, tags: [], sample: false,
      venue: { id: venueId, name, address: null, category: 'bar', lat: 1, lng: 2, logoUrl: null }, distanceM: null,
    });
    const places = placesFromEvents([ev('e1', 'v1', 'Bar A'), ev('e2', 'v1', 'Bar A'), ev('e3', '', 'Casa da Ana'), ev('e4', 'v2', 'Bar B')]);
    assert.deepEqual(places.map((p) => [p.key, p.name, p.venue?.id]), [['askout:v1', 'Bar A', 'v1'], ['askout:v2', 'Bar B', 'v2']]);
  });
});
