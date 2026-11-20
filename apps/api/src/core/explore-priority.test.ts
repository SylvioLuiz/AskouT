import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byDayAndNightlife, nightlifeTier, saoPauloDay } from './explore-priority.ts';
import type { EventKind } from './types.ts';

const ev = (id: string, startsAt: string, kind: EventKind, category: string | null) => ({ id, startsAt, kind, venue: { category } });

test('noite, bares e baladas vêm primeiro dentro do dia; o dia manda', () => {
  const items = [
    ev('teatro-hoje', '2026-11-20T22:00:00Z', 'THEATER', 'Teatro'),
    ev('balada-amanha', '2026-11-22T02:00:00Z', 'NIGHT', null),
    ev('bar-hoje-tarde', '2026-11-20T23:30:00Z', 'SHOW', 'Bar com música ao vivo'),
    ev('show-hoje-cedo', '2026-11-20T14:00:00Z', 'SHOW', 'Casa de show'),
    ev('balada-hoje', '2026-11-21T01:00:00Z', 'NIGHT', 'Balada'),
  ];
  assert.deepEqual(byDayAndNightlife(items).map((i) => i.id), ['bar-hoje-tarde', 'balada-hoje', 'show-hoje-cedo', 'teatro-hoje', 'balada-amanha']);
});

test('categoria do Google também conta e o dia é o de São Paulo', () => {
  assert.equal(nightlifeTier(ev('a', '2026-11-20T20:00:00Z', 'OTHER', 'night_club')), 0);
  assert.equal(nightlifeTier(ev('b', '2026-11-20T20:00:00Z', 'OTHER', 'Barbearia')), 1);
  assert.equal(nightlifeTier(ev('c', '2026-11-20T20:00:00Z', 'OTHER', null)), 1);
  assert.equal(saoPauloDay('2026-11-21T01:00:00Z'), '2026-11-20');
  assert.equal(saoPauloDay('2026-11-21T03:30:00Z'), '2026-11-21');
});

test('não altera a lista original e é estável para empates', () => {
  const items = [ev('b', '2026-11-20T20:00:00Z', 'OTHER', null), ev('a', '2026-11-20T20:00:00Z', 'OTHER', null)];
  assert.deepEqual(byDayAndNightlife(items).map((i) => i.id), ['a', 'b']);
  assert.deepEqual(items.map((i) => i.id), ['b', 'a']);
});
