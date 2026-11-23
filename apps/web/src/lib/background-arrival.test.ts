import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BACKGROUND_SEND_EVERY_MS, backgroundLocationBridge, shouldSendFix } from './background-arrival.ts';

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
});
