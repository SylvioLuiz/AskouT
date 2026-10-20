import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextPlan, planWhenLabel } from './agenda.ts';

const ev = (title: string, start: Date, hours = 3) => ({
  key: title,
  title,
  startsAt: start.toISOString(),
  endsAt: new Date(start.getTime() + hours * 3_600_000).toISOString(),
  venueName: null,
  to: '/x',
});
const now = new Date(2026, 9, 20, 12, 0);

describe('próximo plano', () => {
  it('pega o que vem primeiro e ignora o que já acabou', () => {
    const past = ev('passou', new Date(2026, 9, 19, 20, 0));
    const later = ev('depois', new Date(2026, 9, 23, 20, 0));
    const soon = ev('logo', new Date(2026, 9, 20, 20, 0));
    assert.equal(nextPlan([past, later, soon], now)?.title, 'logo');
    assert.equal(nextPlan([past], now), undefined);
  });
  it('o que está acontecendo agora ainda conta', () => {
    const live = ev('rolando', new Date(2026, 9, 20, 11, 0));
    assert.equal(nextPlan([live], now)?.title, 'rolando');
    assert.equal(planWhenLabel(live, now), 'Agora');
  });
  it('rótulo de quando', () => {
    assert.equal(planWhenLabel(ev('a', new Date(2026, 9, 20, 20, 0)), now), 'Hoje 20h');
    assert.equal(planWhenLabel(ev('a', new Date(2026, 9, 21, 20, 30)), now), 'Amanhã 20h30');
    assert.match(planWhenLabel(ev('a', new Date(2026, 9, 24, 20, 0)), now), /20h$/);
    assert.equal(planWhenLabel(ev('a', new Date(2026, 10, 5, 21, 0)), now), '05/11 21h');
  });
});
