import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHUNK_BYTES, createVideoBridge, qualityFor, type VideoBridgeDeps } from './video-bridge.ts';
import { createStoreBridge } from './store-bridge.ts';
import { createAppleBridge } from './apple-bridge.ts';
import { createCalendarBridge } from './calendar-bridge.ts';
import { createPushBridge, type PushPluginLike } from './push-bridge.ts';

function fakeVideoDeps(overrides: Partial<VideoBridgeDeps> = {}) {
  const log: string[] = [];
  const written = new Map<string, number>();
  let removed = 0;
  const deps: VideoBridgeDeps = {
    filesystem: {
      async writeFile(o) {
        log.push(`write:${o.path}`);
        written.set(o.path, o.data.length);
        return { uri: `file:///cache/${o.path}` };
      },
      async appendFile(o) {
        log.push(`append:${o.path}`);
        written.set(o.path, (written.get(o.path) ?? 0) + o.data.length);
      },
      async deleteFile(o) {
        log.push(`delete:${o.path}`);
      },
    },
    compressor: {
      async compressVideo(o) {
        log.push(`compress:${o.quality}`);
        return { success: true, destPath: 'file:///cache/out.mp4' };
      },
      async addListener(_e, fn) {
        fn({ status: 'compressing', percent: 50 });
        return { remove: () => void (removed += 1) };
      },
    },
    convertFileSrc: (p) => `https://localhost/_file_/${p}`,
    fetchFile: async () => new Blob([new Uint8Array(10)]),
    toBase64: async (chunk) => 'x'.repeat(chunk.size),
    newId: () => 'job1',
    ...overrides,
  };
  return { deps, log, written, removedCount: () => removed };
}

describe('qualityFor', () => {
  it('escolhe o degrau mais próximo do lado maior', () => {
    assert.equal(qualityFor(1280), 'HIGH');
    assert.equal(qualityFor(1920), 'VERY_HIGH');
    assert.equal(qualityFor(960), 'MEDIUM');
    assert.equal(qualityFor(480), 'LOW');
  });
});

describe('ponte de vídeo', () => {
  it('grava em pedaços, comprime, lê o resultado e apaga os temporários', async () => {
    const { deps, log, written, removedCount } = fakeVideoDeps();
    const progress: number[] = [];
    const file = new File([new Uint8Array(CHUNK_BYTES * 2 + 5)], 'Férias.MOV', { type: 'video/quicktime' });
    const out = await createVideoBridge(deps).compress(file, { maxEdge: 1280, videoBitsPerSecond: 3_500_000, onProgress: (f) => progress.push(f) });
    assert.ok(out);
    assert.equal(out.name, 'Férias.mp4');
    assert.equal(out.type, 'video/mp4');
    assert.equal(out.size, 10);
    assert.deepEqual(log.filter((l) => l.startsWith('write') || l.startsWith('append')), ['write:askout-in-job1.mov', 'append:askout-in-job1.mov', 'append:askout-in-job1.mov']);
    assert.equal(written.get('askout-in-job1.mov'), file.size);
    assert.ok(log.includes('compress:HIGH'));
    assert.deepEqual(progress, [0.5]);
    assert.equal(removedCount(), 1);
    assert.ok(log.includes('delete:askout-in-job1.mov'));
    assert.ok(log.includes('delete:file:///cache/out.mp4'));
  });

  it('devolve undefined quando o plugin não consegue, e limpa mesmo assim', async () => {
    const { deps, log } = fakeVideoDeps({ compressor: { compressVideo: async () => ({ success: false, destPath: '' }), addListener: async () => ({ remove() {} }) } });
    const out = await createVideoBridge(deps).compress(new File([new Uint8Array(10)], 'a.mp4'), { maxEdge: 1280, videoBitsPerSecond: 1 });
    assert.equal(out, undefined);
    assert.ok(log.includes('delete:askout-in-job1.mp4'));
  });

  it('repassa a falha do plugin (o app cai no navegador) e limpa o cache', async () => {
    const { deps, log } = fakeVideoDeps({ compressor: { compressVideo: async () => { throw new Error('boom'); }, addListener: async () => ({ remove() {} }) } });
    await assert.rejects(createVideoBridge(deps).compress(new File([new Uint8Array(10)], 'a.mp4'), { maxEdge: 1280, videoBitsPerSecond: 1 }), /boom/);
    assert.ok(log.includes('delete:askout-in-job1.mp4'));
  });

  it('resultado vazio vale como falha', async () => {
    const { deps } = fakeVideoDeps({ fetchFile: async () => new Blob([]) });
    assert.equal(await createVideoBridge(deps).compress(new File([new Uint8Array(10)], 'a.mp4'), { maxEdge: 1280, videoBitsPerSecond: 1 }), undefined);
  });
});

describe('ponte da loja', () => {
  const purchases = (tx: object) => ({ purchaseProduct: async () => tx });
  it('iOS devolve a transação assinada (ou o recibo antigo)', async () => {
    assert.equal(await createStoreBridge({ purchases: purchases({ jwsRepresentation: 'jws', receipt: 'old' }), platform: () => 'ios' }).purchase('p'), 'jws');
    assert.equal(await createStoreBridge({ purchases: purchases({ receipt: 'old' }), platform: () => 'ios' }).purchase('p'), 'old');
  });
  it('Android devolve o token de compra', async () => {
    assert.equal(await createStoreBridge({ purchases: purchases({ purchaseToken: 'tok' }), platform: () => 'android' }).purchase('p'), 'tok');
  });
  it('sem recibo é erro', async () => {
    await assert.rejects(createStoreBridge({ purchases: purchases({}), platform: () => 'android' }).purchase('p'), /recibo/);
  });
  it('pede a compra consumível do produto certo', async () => {
    let seen: unknown;
    await createStoreBridge({ purchases: { purchaseProduct: async (o) => ((seen = o), { purchaseToken: 't' }) }, platform: () => 'android' }).purchase('askout.boost.day');
    assert.deepEqual(seen, { productIdentifier: 'askout.boost.day', productType: 'inapp', isConsumable: true, quantity: 1 });
  });
});

describe('ponte da Apple', () => {
  it('inicializa uma vez e devolve o token de identidade', async () => {
    const calls: string[] = [];
    const bridge = createAppleBridge({
      login: {
        async initialize() {
          calls.push('init');
        },
        async login(o) {
          calls.push(`login:${o.options.scopes.join(',')}`);
          return { result: { idToken: 'jwt-da-apple' } };
        },
      },
    });
    assert.equal(await bridge.signIn(), 'jwt-da-apple');
    assert.equal(await bridge.signIn(), 'jwt-da-apple');
    assert.deepEqual(calls, ['init', 'login:email,name', 'login:email,name']);
  });

  it('cancelar não é erro; falha de verdade sobe; sem token devolve undefined', async () => {
    const mk = (login: () => Promise<{ result: { idToken?: string | null } }>) => createAppleBridge({ login: { initialize: async () => undefined, login } });
    assert.equal(await mk(async () => { throw new Error('The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)'); }).signIn(), undefined);
    await assert.rejects(mk(async () => { throw new Error('Sem rede'); }).signIn(), /Sem rede/);
    assert.equal(await mk(async () => ({ result: { idToken: null } })).signIn(), undefined);
  });

  it('se a inicialização falhar, tenta de novo na próxima vez', async () => {
    let n = 0;
    const bridge = createAppleBridge({
      login: {
        async initialize() {
          n += 1;
          if (n === 1) throw new Error('falhou');
        },
        async login() {
          return { result: { idToken: 'ok' } };
        },
      },
    });
    await assert.rejects(bridge.signIn(), /falhou/);
    assert.equal(await bridge.signIn(), 'ok');
  });
});

function fakePush(opts: { receive?: string; requested?: string; token?: string; error?: string } = {}) {
  const listeners = new Map<string, (p: never) => void>();
  const removed: string[] = [];
  let requests = 0;
  const push = {
    async checkPermissions() {
      return { receive: opts.receive ?? 'prompt' };
    },
    async requestPermissions() {
      requests++;
      return { receive: opts.requested ?? 'granted' };
    },
    async register() {
      queueMicrotask(() => {
        if (opts.error) listeners.get('registrationError')?.({ error: opts.error } as never);
        else if (opts.token) listeners.get('registration')?.({ value: opts.token } as never);
      });
    },
    async addListener(event: string, cb: (p: never) => void) {
      listeners.set(event, cb);
      return { remove: async () => void removed.push(event) };
    },
  } as unknown as PushPluginLike;
  return { push, listeners, removed, requests: () => requests };
}

describe('ponte de avisos (push)', () => {
  it('pede permissão, registra e devolve o token do aparelho', async () => {
    const f = fakePush({ token: 'ab12' });
    const bridge = createPushBridge({ push: f.push, open: () => undefined });
    assert.equal(await bridge.permission(), 'prompt');
    assert.equal(await bridge.register(), 'ab12');
    assert.equal(f.requests(), 1);
    assert.deepEqual(f.removed.sort(), ['registration', 'registrationError'], 'solta os ouvintes depois');
  });

  it('não pede de novo quando já está liberado, e devolve undefined quando a pessoa recusa', async () => {
    const ok = fakePush({ receive: 'granted', token: 'cd34' });
    assert.equal(await createPushBridge({ push: ok.push, open: () => undefined }).register(), 'cd34');
    assert.equal(ok.requests(), 0);
    const no = fakePush({ requested: 'denied', token: 'x' });
    assert.equal(await createPushBridge({ push: no.push, open: () => undefined }).register(), undefined);
    const blocked = fakePush({ receive: 'denied' });
    const bridge = createPushBridge({ push: blocked.push, open: () => undefined });
    assert.equal(await bridge.permission(), 'denied');
    assert.equal(await bridge.register(), undefined);
    assert.equal(blocked.requests(), 0);
  });

  it('erro da Apple e falta de resposta viram mensagem clara', async () => {
    const bad = fakePush({ receive: 'granted', error: 'sem rede' });
    await assert.rejects(createPushBridge({ push: bad.push, open: () => undefined }).register(), /sem rede/);
    const silent = fakePush({ receive: 'granted' });
    await assert.rejects(createPushBridge({ push: silent.push, open: () => undefined, timeoutMs: 20 }).register(), /não respondeu/);
  });

  it('tocar no aviso abre só caminhos de dentro do app', () => {
    const f = fakePush();
    const opened: string[] = [];
    createPushBridge({ push: f.push, open: (p) => opened.push(p) });
    const tap = (url: unknown) => (f.listeners.get('pushNotificationActionPerformed') as (a: unknown) => void)({ notification: { data: { url } } });
    tap('/conversas/1');
    tap('https://golpe.example');
    tap('//golpe.example');
    tap(42);
    assert.deepEqual(opened, ['/conversas/1']);
  });
});

describe('ponte da agenda', () => {
  const ics = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
  it('grava o arquivo e abre o menu de compartilhar com o endereço dele', async () => {
    const calls: string[] = [];
    const bridge = createCalendarBridge({
      writeFile: async (o) => (calls.push(`write:${o.path}:${o.data.length}`), { uri: `file:///cache/${o.path}` }),
      share: async (o) => void calls.push(`share:${o.url}`),
    });
    await bridge.addEvent({ filename: 'samba.ics', ics });
    assert.deepEqual(calls, [`write:samba.ics:${ics.length}`, 'share:file:///cache/samba.ics']);
  });
  it('recusa nome ou conteúdo estranho e ignora o cancelamento do menu', async () => {
    const ok = createCalendarBridge({ writeFile: async () => ({ uri: 'file:///x' }), share: async () => undefined });
    await assert.rejects(ok.addEvent({ filename: '../x.ics', ics }), /Nome/);
    await assert.rejects(ok.addEvent({ filename: 'x.txt', ics }), /Nome/);
    await assert.rejects(ok.addEvent({ filename: 'x.ics', ics: 'qualquer coisa' }), /inválido/);
    const cancelled = createCalendarBridge({ writeFile: async () => ({ uri: 'file:///x' }), share: async () => Promise.reject(new Error('Share canceled')) });
    await cancelled.addEvent({ filename: 'x.ics', ics });
    const broken = createCalendarBridge({ writeFile: async () => ({ uri: 'file:///x' }), share: async () => Promise.reject(new Error('falhou')) });
    await assert.rejects(broken.addEvent({ filename: 'x.ics', ics }), /falhou/);
  });
});
