import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLiveNow, liveEvents, liveFirst, timeRange } from './live-events.ts';
import type { ExploreEvent } from './types.ts';

const ev = (id: string, start: string, end: string, distanceM: number | null): ExploreEvent =>
  ({ id, title: id, startsAt: start, endsAt: end, distanceM, kind: 'SHOW', isFree: false, imageUrl: null, tags: [], sample: false, description: null, venue: { id: 'v', name: 'V', address: null, category: null, lat: 0, lng: 0, logoUrl: null } }) as unknown as ExploreEvent;

test('só eventos em andamento, do mais perto ao mais longe', () => {
  const now = new Date('2026-10-15T22:00:00-03:00');
  const list = liveEvents(
    [
      ev('longe', '2026-10-15T20:00:00-03:00', '2026-10-16T02:00:00-03:00', 5000),
      ev('perto', '2026-10-15T21:00:00-03:00', '2026-10-15T23:00:00-03:00', 300),
      ev('sem', '2026-10-15T21:30:00-03:00', '2026-10-15T23:30:00-03:00', null),
      ev('futuro', '2026-10-15T22:30:00-03:00', '2026-10-15T23:30:00-03:00', 10),
      ev('acabou', '2026-10-15T18:00:00-03:00', '2026-10-15T22:00:00-03:00', 10),
    ],
    now,
  );
  assert.deepEqual(list.map((e) => e.id), ['perto', 'longe', 'sem']);
});

test('faixa de horário no relógio do aparelho', () => {
  assert.equal(timeRange('2026-10-15T20:00:00-03:00', '2026-10-16T02:30:00-03:00'), '20:00 – 02:30');
});

test('liveFirst: patrocinado no topo, depois o que está rolando, e o resto na ordem de antes', () => {
  const now = new Date('2026-10-15T22:00:00-03:00');
  const mk = (id: string, start: string, end: string, sponsored = false) => ({ id, startsAt: start, endsAt: end, sponsored });
  const out = liveFirst(
    [
      mk('amanha', '2026-10-16T20:00:00-03:00', '2026-10-17T02:00:00-03:00'),
      mk('agora1', '2026-10-15T21:00:00-03:00', '2026-10-15T23:00:00-03:00'),
      mk('ad', '2026-10-20T20:00:00-03:00', '2026-10-20T23:00:00-03:00', true),
      mk('depois', '2026-10-15T23:00:00-03:00', '2026-10-16T01:00:00-03:00'),
      mk('agora2', '2026-10-15T20:00:00-03:00', '2026-10-16T02:00:00-03:00'),
    ],
    now,
  ).map((e) => e.id);
  assert.deepEqual(out, ['ad', 'agora1', 'agora2', 'amanha', 'depois']);
  assert.equal(isLiveNow({ startsAt: '2026-10-15T22:00:00-03:00', endsAt: '2026-10-15T23:00:00-03:00' }, now), true);
  assert.equal(isLiveNow({ startsAt: '2026-10-15T21:00:00-03:00', endsAt: '2026-10-15T22:00:00-03:00' }, now), false);
});
