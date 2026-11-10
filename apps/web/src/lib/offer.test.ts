import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { offerDurationLabel, offerIsLive, OFFER_DURATION_CHOICES } from './offer.ts';

describe('oferta relâmpago (web)', () => {
  it('some ao vencer', () => {
    const now = new Date('2030-01-10T20:00:00.000Z');
    assert.equal(offerIsLive({ endsAt: '2030-01-10T20:00:01.000Z' }, now), true);
    assert.equal(offerIsLive({ endsAt: '2030-01-10T20:00:00.000Z' }, now), false);
    assert.equal(offerIsLive({ endsAt: 'lixo' }, now), false);
  });
  it('escreve a duração', () => {
    assert.equal(offerDurationLabel(30), '30 min');
    assert.equal(offerDurationLabel(60), '1 hora');
    assert.equal(offerDurationLabel(120), '2 horas');
    assert.ok(OFFER_DURATION_CHOICES.every((m) => m >= 15 && m <= 240));
  });
});
