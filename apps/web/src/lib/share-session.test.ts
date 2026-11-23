import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionStore } from './session.ts';
import { withShareSession } from './share-session.ts';

test('share-session: avisa a ponte ao abrir, ao entrar e ao sair; sem endereço completo, não manda', async () => {
  const calls: string[] = [];
  const host = { AskouTShareSession: { set: async (o: { token: string; apiBase: string }) => void calls.push(`set:${o.token}@${o.apiBase}`), clear: async () => void calls.push('clear') } };
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  storage.setItem('askout.token', 'antigo');
  const store = withShareSession(createSessionStore(storage), () => 'https://api.askout.com.br', host);
  store.set('novo');
  store.clear();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(calls.includes('set:novo@https://api.askout.com.br'));
  assert.ok(calls.includes('clear'));
  const relative: string[] = [];
  const s2 = withShareSession(createSessionStore(storage), () => '/api', { AskouTShareSession: { set: async () => void relative.push('set'), clear: async () => void relative.push('clear') } });
  s2.set('x');
  assert.deepEqual(relative, []);
});
