import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boostTitle, boostTotalCents, canCancelBoost, daysLabel, distanceText, formatBrl, matchLabel, reachText, roundCoordinate, sortBoosts, toggleTag } from './boost.ts';
import type { BoostPhase, BoostView } from './types.ts';

function boost(id: string, phase: BoostPhase, createdAt: string): BoostView {
  return { id, venueId: 'v', target: 'VENUE', eventId: null, eventTitle: null, days: 3, amountCents: 4500, audience: 'ALL', radiusKm: null, matchTags: [], phase, createdAt, startsAt: null, endsAt: null, payment: null };
}

describe('impulsionamento (web)', () => {
  it('formata reais e calcula o total', () => {
    assert.equal(formatBrl(1500), 'R$ 15,00');
    assert.equal(formatBrl(4550), 'R$ 45,50');
    assert.equal(formatBrl(-3), 'R$ 0,00');
    assert.equal(boostTotalCents(1500, 7), 10500);
    assert.equal(boostTotalCents(1500, 0), 0);
  });
  it('escreve dias no singular e no plural', () => {
    assert.equal(daysLabel(1), '1 dia');
    assert.equal(daysLabel(7), '7 dias');
  });
  it('só cancela o que ainda não foi pago', () => {
    assert.equal(canCancelBoost({ phase: 'PENDING_PAYMENT' }), true);
    assert.equal(canCancelBoost({ phase: 'ACTIVE' }), false);
    assert.equal(canCancelBoost({ phase: 'ENDED' }), false);
  });
  it('ordena em aberto primeiro, depois no ar, depois o resto por data', () => {
    const out = sortBoosts([boost('a', 'ENDED', '2026-01-02'), boost('b', 'ACTIVE', '2026-01-01'), boost('c', 'PENDING_PAYMENT', '2026-01-01'), boost('d', 'CANCELLED', '2026-01-05')]);
    assert.deepEqual(out.map((b) => b.id), ['c', 'b', 'd', 'a']);
  });
  it('nomeia o alvo', () => {
    assert.equal(boostTitle({ target: 'EVENT', eventTitle: 'Samba' }), 'Samba');
    assert.equal(boostTitle({ target: 'VENUE', eventTitle: null }), 'O rolê (página do local)');
  });
  it('marca e desmarca hashtags até o máximo', () => {
    assert.deepEqual(toggleTag(['rock'], 'metal', 5), ['rock', 'metal']);
    assert.deepEqual(toggleTag(['rock', 'metal'], 'rock', 5), ['metal']);
    assert.deepEqual(toggleTag(['a', 'b'], 'c', 2), ['a', 'b'], 'não passa do máximo');
  });
  it('descreve o Match só quando existe', () => {
    assert.equal(matchLabel({ audience: 'ALL', radiusKm: null, matchTags: [] }), null);
    assert.equal(matchLabel({ audience: 'MATCH', radiusKm: 5, matchTags: ['rock', 'metal'] }), 'Match · 5 km · #rock #metal');
  });
  it('escreve a estimativa e a distância', () => {
    assert.equal(reachText({ label: 'menos de 10 pessoas', partial: false }), 'Menos de 10 pessoas combinam hoje com este Match.');
    assert.equal(reachText({ label: 'cerca de 40 pessoas', partial: true }), 'Cerca de 40 pessoas combinam hoje com este Match (estimativa: só parte da região foi examinada).');
    assert.equal(distanceText(1), 'Pertinho de você');
    assert.equal(distanceText(3), 'A cerca de 3 km de você');
  });
  it('arredonda a coordenada para ~1 km', () => {
    assert.equal(roundCoordinate(-23.55123), -23.55);
  });
});
