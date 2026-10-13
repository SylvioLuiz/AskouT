import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

const plain = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;

type Handler = (event: Record<string, unknown>) => void;

function loadWorker() {
  const handlers = new Map<string, Handler>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const posted: unknown[] = [];
  let focused = 0;
  let windows: { focus(): Promise<void>; postMessage(m: unknown): void }[] = [];
  const self = {
    addEventListener: (name: string, fn: Handler) => handlers.set(name, fn),
    skipWaiting: () => undefined,
    clients: {
      claim: async () => undefined,
      matchAll: async () => windows,
      openWindow: async (u: string) => void opened.push(u),
    },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }) },
  };
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), { self });
  return {
    shown, opened, posted,
    setWindows: (n: number) => { windows = Array.from({ length: n }, () => ({ focus: async () => void (focused += 1), postMessage: (m: unknown) => void posted.push(m) })); },
    focused: () => focused,
    async push(json: unknown, raw = false) {
      let waited: Promise<unknown> = Promise.resolve();
      handlers.get('push')!({ data: { json: () => { if (raw) throw new Error('x'); return json; } }, waitUntil: (p: Promise<unknown>) => void (waited = p) });
      await waited;
    },
    async click(data: unknown) {
      let waited: Promise<unknown> = Promise.resolve();
      handlers.get('notificationclick')!({ notification: { close: () => undefined, data }, waitUntil: (p: Promise<unknown>) => void (waited = p) });
      await waited;
    },
  };
}

describe('service worker', () => {
  it('mostra o aviso com título, texto, tag e destino', async () => {
    const w = loadWorker();
    await w.push({ title: 'Bruno', body: 'Enviou uma mensagem', url: '/conversas/1', tag: 'msg:1' });
    assert.equal(w.shown[0]!.title, 'Bruno');
    assert.equal(w.shown[0]!.options['body'], 'Enviou uma mensagem');
    assert.equal(w.shown[0]!.options['tag'], 'msg:1');
    assert.deepEqual(plain(w.shown[0]!.options['data']), { url: '/conversas/1' });
  });
  it('aceita conteúdo vazio ou inválido e não deixa abrir endereço de fora', async () => {
    const w = loadWorker();
    await w.push(undefined, true);
    await w.push({ title: 'X', url: 'https://golpe.example' });
    assert.equal(w.shown[0]!.title, 'AskouT');
    assert.deepEqual(plain(w.shown[1]!.options['data']), { url: '/' });
  });
  it('ao tocar: usa a janela aberta ou abre uma nova', async () => {
    const w = loadWorker();
    await w.click({ url: '/flash' });
    assert.deepEqual(plain(w.opened), ['/flash']);
    w.setWindows(1);
    await w.click({ url: '/conversas/9' });
    assert.equal(w.focused(), 1);
    assert.deepEqual(plain(w.posted), [{ type: 'askout:navigate', url: '/conversas/9' }]);
    assert.deepEqual(plain(w.opened), ['/flash']);
  });
});
