import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BACKGROUND_SEND_EVERY_MS, backgroundLocationBridge, ownArrivalStep, shouldSendFix } from './background-arrival.ts';

describe('chegada em segundo plano', () => {
  it('só usa a ponte do app quando ela está completa', () => {
    assert.equal(backgroundLocationBridge(undefined), undefined);
    assert.equal(backgroundLocationBridge({ AskouTBackgroundLocation: { start: async () => async () => {} } }), undefined);
    const bridge = { start: async () => async () => {}, put: async () => 200, openSettings: async () => {} };
    assert.equal(backgroundLocationBridge({ AskouTBackgroundLocation: bridge }), bridge);
  });

  it('respeita o intervalo, mas manda logo quando andou bastante', () => {
    const fix = { lat: -23.55, lng: -46.63, accuracyM: 10, time: 0 };
    assert.equal(shouldSendFix(undefined, fix, 0), true);
    const last = { at: 0, lat: -23.55, lng: -46.63 };
    assert.equal(shouldSendFix(last, fix, 10_000), false);
    assert.equal(shouldSendFix(last, fix, BACKGROUND_SEND_EVERY_MS), true);
    assert.equal(shouldSendFix(last, { ...fix, lat: -23.548 }, 6_000), true, '~220 m em 6 s');
    assert.equal(shouldSendFix(last, { ...fix, lat: -23.548 }, 2_000), false, 'mas não mais que a cada 5 s');
  });

  it('barra do aviso fixo: começa vazia, enche no caminho e fica cheia na chegada', () => {
    const target = { lat: -23.55, lng: -46.63 };
    const far = { lat: -23.56, lng: -46.63 }; // ~1,1 km
    const first = ownArrivalStep(undefined, far, target);
    assert.equal(first.progress, 0);
    assert.equal(first.arrived, false);
    assert.ok(first.minutes >= 15 && first.minutes <= 20, `minutos: ${first.minutes}`);
    const half = ownArrivalStep(first.startM, { lat: -23.555, lng: -46.63 }, target);
    assert.ok(half.progress > 40 && half.progress < 60, `progresso: ${half.progress}`);
    assert.equal(half.startM, first.startM);
    const there = ownArrivalStep(half.startM, { lat: -23.5502, lng: -46.63 }, target);
    assert.deepEqual([there.progress, there.arrived, there.minutes], [100, true, 0]);
    // Se afastou além do começo: o começo passa a ser a nova distância (a barra não fica negativa).
    const back = ownArrivalStep(first.startM, { lat: -23.57, lng: -46.63 }, target);
    assert.equal(back.progress, 0);
    assert.ok(back.startM > first.startM);
  });
});
