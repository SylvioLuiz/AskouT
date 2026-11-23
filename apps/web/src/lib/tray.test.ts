import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearTrayFor, rememberNotifications, trayMatchFor } from './tray.ts';

test('tray: junta título e texto dos avisos que abrem a mesma tela (ignora ?query)', () => {
  const items = [
    { url: '/conversas/1?m=9', title: 'ana', body: 'oi' },
    { url: '/conversas/2', title: 'bia', body: 'e aí' },
  ];
  assert.deepEqual(trayMatchFor('/conversas/1', items), { url: '/conversas/1', texts: [{ title: 'ana', body: 'oi' }] });
});

test('tray: chama a ponte com o que a lista do app conhece; sem ponte, nada acontece', () => {
  rememberNotifications([{ url: '/now', title: 'ana ligou o NOW', body: 'Bora?' }]);
  const calls: unknown[] = [];
  clearTrayFor('/now', { AskouTPush: { clearDelivered: async (m: unknown) => (calls.push(m), 1) } });
  assert.deepEqual(calls, [{ url: '/now', texts: [{ title: 'ana ligou o NOW', body: 'Bora?' }] }]);
  assert.doesNotThrow(() => clearTrayFor('/now', {}));
});
