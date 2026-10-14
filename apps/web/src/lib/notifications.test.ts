import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasNewActivity, readActivitySeen, writeActivitySeen } from './notifications.ts';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test('hasNewActivity: bolinha só para o que chegou depois da última visita', () => {
  const none = { newsAt: null, requests: 0 };
  assert.equal(hasNewActivity({ latestUnreadAt: null, requests: 0 }, none), false);
  assert.equal(hasNewActivity({ latestUnreadAt: '2026-10-14T10:00:00.000Z', requests: 0 }, none), true);
  const seen = { newsAt: '2026-10-14T10:00:00.000Z', requests: 2 };
  assert.equal(hasNewActivity({ latestUnreadAt: '2026-10-14T10:00:00.000Z', requests: 2 }, seen), false, 'visto, mesmo não aberto');
  assert.equal(hasNewActivity({ latestUnreadAt: '2026-10-14T10:05:00.000Z', requests: 2 }, seen), true, 'chegou outro depois');
  assert.equal(hasNewActivity({ latestUnreadAt: '2026-10-14T09:00:00.000Z', requests: 3 }, seen), true, 'novo pedido para seguir');
  assert.equal(hasNewActivity({ latestUnreadAt: null, requests: 1 }, seen), false, 'menos pedidos que antes: nada novo');
});

test('readActivitySeen/writeActivitySeen: guarda por pessoa e aguenta lixo', () => {
  const s = store();
  assert.deepEqual(readActivitySeen(s, 'u1'), { newsAt: null, requests: 0 });
  writeActivitySeen(s, 'u1', { newsAt: '2026-10-14T10:00:00.000Z', requests: 3 });
  assert.deepEqual(readActivitySeen(s, 'u1'), { newsAt: '2026-10-14T10:00:00.000Z', requests: 3 });
  assert.deepEqual(readActivitySeen(s, 'u2'), { newsAt: null, requests: 0 });
  s.setItem('askout:activity-seen:u3', '{lixo');
  assert.deepEqual(readActivitySeen(s, 'u3'), { newsAt: null, requests: 0 });
  assert.deepEqual(readActivitySeen(undefined, 'u1'), { newsAt: null, requests: 0 });
});
