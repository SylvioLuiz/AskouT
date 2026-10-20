import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boostTitle, boostTotalCents, canCancelBoost, daysLabel, formatBrl, sortBoosts } from './boost.ts';
import type { BoostPhase, BoostView } from './types.ts';

function boost(id: string, phase: BoostPhase, createdAt: string): BoostView {
  return { id, venueId: 'v', target: 'VENUE', eventId: null, eventTitle: null, days: 3, amountCents: 4500, phase, createdAt, startsAt: null, endsAt: null, payment: null };
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
});
