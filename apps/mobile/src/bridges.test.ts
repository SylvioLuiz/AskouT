import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { CHUNK_BYTES, createVideoBridge, qualityFor, type VideoBridgeDeps } from './video-bridge.ts';
import { createStoreBridge } from './store-bridge.ts';
import { createFilesBridge } from './files-bridge.ts';
import { createAppleBridge } from './apple-bridge.ts';
import { createGoogleBridge } from './google-bridge.ts';
import { createCalendarBridge } from './calendar-bridge.ts';
import { createDeviceCalendarBridge } from './device-calendar-bridge.ts';
import { createContactsBridge } from './contacts-bridge.ts';
import { createPushBridge, openInApp, type PushPluginLike } from './push-bridge.ts';

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
    assert.equal(await createStoreBridge({ purchases: purchases({ purchaseToken: 'tok' }), platform: () => 'android' }).purchase('p'), '{"productId":"p","purchaseToken":"tok"}');
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

  it('avisa o app web que esta casca sabe mostrar "Responder" na notificação', () => {
    assert.equal(createPushBridge({ push: fakePush({ token: 'ab12' }).push, open: () => undefined }).replies, true);
  });

  it('liveActivityToken: devolve o token "push-to-start" do iPhone, e nada sem o plugin ou com token estranho', async () => {
    const push = fakePush({ token: 'ab12' }).push;
    assert.equal(await createPushBridge({ push, open: () => undefined }).liveActivityToken(), undefined);
    const hex = 'ab'.repeat(32);
    assert.equal(await createPushBridge({ push, open: () => undefined, liveActivity: { startToken: async () => ({ token: hex }) } }).liveActivityToken(), hex);
    assert.equal(await createPushBridge({ push, open: () => undefined, liveActivity: { startToken: async () => ({ token: 'x y' }) } }).liveActivityToken(), undefined);
    assert.equal(await createPushBridge({ push, open: () => undefined, liveActivity: { startToken: async () => Promise.reject(new Error('x')) } }).liveActivityToken(), undefined);
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

  it('abre o caminho sem recarregar, inclusive perfil com ponto no nome', () => {
    const pushed: string[] = [];
    const events: string[] = [];
    const win = {
      location: { pathname: '/', search: '' },
      history: { pushState: (_d: unknown, _u: string, url: string) => void pushed.push(url) },
      dispatchEvent: (e: Event) => (events.push(e.type), true),
    };
    openInApp('/u/ana.souza', win);
    assert.deepEqual(pushed, ['/u/ana.souza']);
    assert.deepEqual(events, ['popstate']);
    win.location.pathname = '/u/ana.souza';
    openInApp('/u/ana.souza', win);
    assert.deepEqual(pushed, ['/u/ana.souza'], 'já está lá: não empilha de novo');
  });
});

describe('ponte da agenda', () => {
  const ics = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
  const event = { title: 'Samba', startsAt: '2026-11-07T22:00:00.000Z', endsAt: '2026-11-08T02:00:00.000Z', location: 'Bar do Zé, Rua A, 10', description: 'Roda', url: 'https://askout.com.br/eventos/ev1' };
  it('abre a tela nativa de novo evento já preenchida, sem compartilhar o .ics', async () => {
    const calls: unknown[] = [];
    const bridge = createCalendarBridge({
      calendar: { createEventWithPrompt: async (o) => void calls.push(o) },
      writeFile: async () => (calls.push('write'), { uri: 'file:///x' }),
      share: async () => void calls.push('share'),
    });
    await bridge.addEvent({ filename: 'samba.ics', ics, event });
    assert.deepEqual(calls, [
      { title: 'Samba', startDate: Date.parse(event.startsAt), endDate: Date.parse(event.endsAt), location: event.location, description: 'Roda', url: event.url, alerts: [-60] },
    ]);
  });
  it('fechar a tela nativa não é erro; falha dela cai no .ics', async () => {
    const calls: string[] = [];
    const deps = { writeFile: async () => ({ uri: 'file:///x' }), share: async () => void calls.push('share') };
    await createCalendarBridge({ ...deps, calendar: { createEventWithPrompt: async () => Promise.reject(new Error('User canceled')) } }).addEvent({ filename: 'x.ics', ics, event });
    assert.deepEqual(calls, []);
    await createCalendarBridge({ ...deps, calendar: { createEventWithPrompt: async () => Promise.reject(new Error('No activity')) } }).addEvent({ filename: 'x.ics', ics, event });
    assert.deepEqual(calls, ['share']);
  });
  it('sem os campos do evento (site antigo), grava o arquivo e abre o menu de compartilhar', async () => {
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

describe('ponte de salvar fotos', () => {
  it('grava cada foto e abre um só menu de compartilhar com todas', async () => {
    const calls: string[] = [];
    const bridge = createFilesBridge({
      writeFile: async (o) => (calls.push(`write:${o.path}`), { uri: `file:///cache/${o.path}` }),
      share: async (o) => void calls.push(`share:${o.files.join(',')}`),
    });
    await bridge.saveImages({ files: [{ filename: 'a.jpg', base64: 'AA==' }, { filename: 'b.jpg', base64: 'AA==' }] });
    assert.deepEqual(calls, ['write:a.jpg', 'write:b.jpg', 'share:file:///cache/a.jpg,file:///cache/b.jpg']);
  });
  it('recusa nome estranho e ignora o cancelamento do menu', async () => {
    const ok = createFilesBridge({ writeFile: async () => ({ uri: 'file:///x' }), share: async () => undefined });
    await assert.rejects(ok.saveImages({ files: [{ filename: '../a.jpg', base64: 'AA==' }] }), /inválido/);
    await assert.rejects(ok.saveImages({ files: [] }), /Nada/);
    const cancelled = createFilesBridge({ writeFile: async () => ({ uri: 'file:///x' }), share: async () => Promise.reject(new Error('Share canceled')) });
    await cancelled.saveImages({ files: [{ filename: 'a.jpg', base64: 'AA==' }] });
  });
  it('compartilha um cartão com a legenda e avisa quando a pessoa fecha o menu', async () => {
    const calls: unknown[] = [];
    const bridge = createFilesBridge({
      writeFile: async (o) => ({ uri: `file:///cache/${o.path}` }),
      share: async (o) => void calls.push(o),
    });
    assert.equal(await bridge.shareImage({ filename: 'askout-samba.png', base64: 'AA==', text: 'Bora?' }), true);
    assert.deepEqual(calls, [{ files: ['file:///cache/askout-samba.png'], dialogTitle: 'Compartilhar', text: 'Bora?' }]);
    await assert.rejects(bridge.shareImage({ filename: 'x.exe', base64: 'AA==' }), /inválido/);
    const cancelled = createFilesBridge({ writeFile: async () => ({ uri: 'file:///x' }), share: async () => Promise.reject(new Error('Share canceled')) });
    assert.equal(await cancelled.shareImage({ filename: 'a.png', base64: 'AA==' }), false);
  });
});

describe('ponte dos contatos', () => {
  const agenda = { contacts: [{ phones: [{ number: '(11) 98765-4321' }, { number: null }], emails: [{ address: 'ana@x.com' }] }, {}] };
  it('pede permissão quando falta e devolve só celulares e e-mails', async () => {
    const calls: string[] = [];
    const bridge = createContactsBridge({
      contacts: {
        checkPermissions: async () => (calls.push('check'), { contacts: 'prompt' }),
        requestPermissions: async () => (calls.push('request'), { contacts: 'granted' }),
        getContacts: async () => (calls.push('read'), agenda),
      },
    });
    assert.deepEqual(await bridge.readAll(), { phones: ['(11) 98765-4321'], emails: ['ana@x.com'] });
    assert.deepEqual(calls, ['check', 'request', 'read']);
  });
  it('sem permissão, avisa e não lê a agenda', async () => {
    let read = false;
    const bridge = createContactsBridge({
      contacts: {
        checkPermissions: async () => ({ contacts: 'denied' }),
        requestPermissions: async () => ({ contacts: 'denied' }),
        getContacts: async () => ((read = true), agenda),
      },
    });
    await assert.rejects(bridge.readAll(), /permissão/);
    assert.equal(read, false);
  });
});

describe('ponte do Google', () => {
  it('Android: inicializa uma vez com o cliente web e devolve o token', async () => {
    const inits: unknown[] = [];
    let logins = 0;
    const bridge = createGoogleBridge({
      platform: () => 'android',
      login: {
        async initialize(o) {
          inits.push(o.google);
        },
        async login(o) {
          logins += 1;
          assert.deepEqual(o, { provider: 'google', options: {} });
          return { result: { idToken: 'jwt-do-google' } };
        },
      },
    });
    assert.equal(bridge.available({ webClientId: 'web' }), true);
    assert.equal(await bridge.signIn({ webClientId: 'web' }), 'jwt-do-google');
    assert.equal(await bridge.signIn({ webClientId: 'web' }), 'jwt-do-google');
    assert.deepEqual(inits, [{ webClientId: 'web', mode: 'online', skipAuthOnlyAuthorizationAfterSignIn: true }]);
    assert.equal(logins, 2);
  });

  it('iPhone: precisa do cliente iOS e pede o token para o cliente web', async () => {
    const inits: unknown[] = [];
    const bridge = createGoogleBridge({
      platform: () => 'ios',
      login: { initialize: async (o) => void inits.push(o.google), login: async () => ({ result: { idToken: 't' } }) },
    });
    assert.equal(bridge.available({ webClientId: 'web' }), false);
    assert.equal(bridge.available({ webClientId: 'web', iosClientId: 'ios' }), true);
    await assert.rejects(bridge.signIn({ webClientId: 'web' }), /iPhone/);
    assert.equal(await bridge.signIn({ webClientId: 'web', iosClientId: 'ios' }), 't');
    assert.deepEqual(inits, [{ webClientId: 'web', iOSClientId: 'ios', iOSServerClientId: 'web', mode: 'online' }]);
  });

  it('cancelar não é erro; falha de verdade sobe; inicialização que falhou é refeita', async () => {
    const mk = (login: () => Promise<{ result: { idToken?: string | null } }>) => createGoogleBridge({ platform: () => 'android', login: { initialize: async () => undefined, login } });
    assert.equal(await mk(async () => { throw new Error('GetCredentialCancellationException: activity is cancelled by the user.'); }).signIn({ webClientId: 'w' }), undefined);
    assert.equal(await mk(async () => { throw new Error('The user canceled the sign-in flow.'); }).signIn({ webClientId: 'w' }), undefined);
    await assert.rejects(mk(async () => { throw new Error('[28444] Developer console is not set up correctly.'); }).signIn({ webClientId: 'w' }), /28444/);
    assert.equal(await mk(async () => ({ result: { idToken: null } })).signIn({ webClientId: 'w' }), undefined);
    let n = 0;
    const bridge = createGoogleBridge({
      platform: () => 'android',
      login: {
        async initialize() {
          n += 1;
          if (n === 1) throw new Error('falhou');
        },
        login: async () => ({ result: { idToken: 'ok' } }),
      },
    });
    await assert.rejects(bridge.signIn({ webClientId: 'w' }), /falhou/);
    assert.equal(await bridge.signIn({ webClientId: 'w' }), 'ok');
  });
});

describe('ponte da agenda do celular', () => {
  const cal = (granted = true) => {
    const asked: string[] = [];
    return {
      asked,
      calendar: {
        async requestReadOnlyCalendarAccess() {
          asked.push('read');
          return { result: granted ? 'granted' : 'denied' };
        },
        async requestFullCalendarAccess() {
          asked.push('full');
          return { result: granted ? 'granted' : 'denied' };
        },
        async listCalendars() {
          return {
            result: [
              { id: '2', title: 'Trabalho', color: '#f00', accountName: 'ana@empresa.com', source: { title: 'Exchange' } },
              { id: '1', title: 'Ana', color: null, accountName: null, source: { title: 'iCloud' } },
              { id: '3', title: 'Oculta', color: null, accountName: 'x', source: null, visible: false },
            ],
          };
        },
        async listEventsInRange() {
          return {
            result: [
              { calendarId: '1', startDate: Date.parse('2026-10-14T13:00Z'), endDate: Date.parse('2026-10-14T14:00Z'), isAllDay: false, availability: 0, status: 'confirmed' },
              { calendarId: '1', startDate: Date.parse('2026-10-15T00:00Z'), endDate: Date.parse('2026-10-16T00:00Z'), isAllDay: true, availability: 0, status: null },
              { calendarId: '1', startDate: Date.parse('2026-10-14T16:00Z'), endDate: Date.parse('2026-10-14T17:00Z'), isAllDay: false, availability: 1, status: null },
              { calendarId: '1', startDate: Date.parse('2026-10-14T18:00Z'), endDate: Date.parse('2026-10-14T19:00Z'), isAllDay: false, availability: 0, status: 'canceled' },
              { calendarId: '9', startDate: Date.parse('2026-10-14T20:00Z'), endDate: Date.parse('2026-10-14T21:00Z'), isAllDay: false, availability: 0, status: null },
            ],
          };
        },
      },
    };
  };

  it('lista as agendas visíveis com a conta, pedindo a permissão certa em cada sistema', async () => {
    const a = cal();
    const android = createDeviceCalendarBridge({ calendar: a.calendar, platform: () => 'android' });
    assert.deepEqual(await android.listCalendars(), [
      { id: '2', name: 'Trabalho', account: 'ana@empresa.com', color: '#f00' },
      { id: '1', name: 'Ana', account: 'iCloud', color: null },
    ]);
    const i = cal();
    await createDeviceCalendarBridge({ calendar: i.calendar, platform: () => 'ios' }).listCalendars();
    assert.deepEqual([a.asked, i.asked], [['read'], ['full']]);
  });

  it('só horários ocupados com hora: sem dia inteiro, livres, cancelados nem de outra agenda', async () => {
    const b = createDeviceCalendarBridge({ calendar: cal().calendar, platform: () => 'android' });
    assert.deepEqual(await b.busy({ calendarIds: ['1'], from: '2026-10-13T00:00:00Z', to: '2026-10-20T00:00:00Z' }), [{ start: '2026-10-14T13:00:00.000Z', end: '2026-10-14T14:00:00.000Z' }]);
    assert.deepEqual(await b.busy({ calendarIds: [], from: '2026-10-13T00:00:00Z', to: '2026-10-20T00:00:00Z' }), []);
  });

  it('sem permissão avisa com mensagem clara', async () => {
    await assert.rejects(createDeviceCalendarBridge({ calendar: cal(false).calendar, platform: () => 'ios' }).listCalendars(), /Ajustes/);
  });
});

it('botão voltar do Android: volta uma tela, e na primeira manda o app para segundo plano', async () => {
  const { installBackButton } = await import('./back-button.ts');
  let handler: ((e: { canGoBack: boolean }) => void) | undefined;
  const calls: string[] = [];
  let allow = true;
  installBackButton({ addListener: (_e, cb) => { handler = cb; }, minimizeApp: () => calls.push('min'), goBack: () => calls.push('back'), dispatch: () => allow });
  handler?.({ canGoBack: true });
  handler?.({ canGoBack: false });
  allow = false;
  handler?.({ canGoBack: true });
  assert.deepEqual(calls, ['back', 'min']);
});

it('localização: pede a permissão do aparelho quando ainda não tem', async () => {
  const { createLocationBridge } = await import('./location-bridge.ts');
  let asked = 0;
  const bridge = createLocationBridge({ checkPermissions: async () => ({ location: 'prompt' }), requestPermissions: async () => { asked += 1; return { location: 'granted' }; } });
  assert.equal(await bridge.ensure(), 'granted');
  assert.equal(asked, 1);
  const denied = createLocationBridge({ checkPermissions: async () => ({ location: 'denied' }), requestPermissions: async () => ({ location: 'denied' }) });
  assert.equal(await denied.ensure(), 'denied');
  const has = createLocationBridge({ checkPermissions: async () => ({ location: 'denied', coarseLocation: 'granted' }), requestPermissions: async () => { throw new Error('não devia pedir'); } });
  assert.equal(await has.ensure(), 'granted');
});

it('localização: as telas pedem a permissão antes de ler a posição, e o cancelamento funciona', async () => {
  const { guardGeolocation } = await import('./location-bridge.ts');
  const log: string[] = [];
  const geo = {
    getCurrentPosition: () => { log.push('get'); },
    watchPosition: () => { log.push('watch'); return 7; },
    clearWatch: (id: number) => { log.push(`clear ${id}`); },
  } as unknown as Geolocation;
  let result: 'granted' | 'denied' = 'granted';
  guardGeolocation(geo, async () => result);
  geo.getCurrentPosition(() => undefined);
  const id = geo.watchPosition(() => undefined);
  await new Promise((r) => setTimeout(r, 0));
  geo.clearWatch(id);
  result = 'denied';
  let code = 0;
  geo.getCurrentPosition(() => undefined, (e) => { code = e.code; });
  const cancelled = geo.watchPosition(() => undefined);
  geo.clearWatch(cancelled);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(log, ['get', 'watch', 'clear 7']);
  assert.equal(code, 1);
});

it('link br.com.askout:// abre só rotas conhecidas do app', async () => {
  const { deepLinkPath } = await import('./deep-link.ts');
  assert.equal(deepLinkPath('br.com.askout://agenda?agendas=google'), '/agenda?agendas=google');
  assert.equal(deepLinkPath('br.com.askout:///agenda/'), '/agenda');
  assert.equal(deepLinkPath('br.com.askout://configuracoes'), undefined);
  assert.equal(deepLinkPath('br.com.askout://now/encontro/3f2a-77'), '/now/encontro/3f2a-77', 'Live Activity da chegada');
  assert.equal(deepLinkPath('br.com.askout://now/encontro/../x'), undefined);
  assert.equal(deepLinkPath('https://evil.example/agenda'), undefined);
});

it('link do convite abre o app pelo site (Universal Link / App Link) ou pelo intent do Android', async () => {
  const { deepLinkPath } = await import('./deep-link.ts');
  assert.equal(deepLinkPath('https://askout.com.br/convite/ana.s'), '/convite/ana.s');
  assert.equal(deepLinkPath('https://www.askout.com.br/convite/ana.s/?x=1'), '/convite/ana.s');
  assert.equal(deepLinkPath('br.com.askout://convite/ana.s'), '/convite/ana.s');
  assert.equal(deepLinkPath('https://askout.com.br/agenda?agendas=google'), '/agenda?agendas=google');
  assert.equal(deepLinkPath('https://askout.com.br/configuracoes'), undefined);
  assert.equal(deepLinkPath('https://askout.com.br.evil.example/convite/ana'), undefined);
  assert.equal(deepLinkPath('http://askout.com.br/convite/ana'), undefined);
  assert.equal(deepLinkPath('https://askout.com.br/convite/<x>'), undefined);
});

describe('galeria (iPhone)', () => {
  it('lê o arquivo exportado, devolve como File e apaga o temporário', async () => {
    const { createGalleryBridge } = await import('./gallery-bridge.ts');
    const discarded: string[] = [];
    const bridge = createGalleryBridge({
      plugin: {
        access: async () => ({ access: 'limited' }),
        request: async () => ({ access: 'weird' }),
        recent: async (o) => ({ items: [{ id: 'a', kind: 'IMAGE', thumb: 'data:x' }, { id: 'b', kind: 'VIDEO', thumb: '' }], more: o.offset === 0 }),
        file: async () => ({ path: 'file:///tmp/x.jpg', mime: 'image/jpeg', name: 'foto.jpg' }),
        discard: async (o) => void discarded.push(o.path),
        manage: async () => undefined,
        openSettings: async () => undefined,
      },
      convertFileSrc: (p) => `capacitor://localhost/_capacitor_file_${p}`,
      fetchFile: async () => new Blob([new Uint8Array([1, 2, 3])]),
      pixelRatio: () => 3,
    });
    assert.equal(await bridge.access(), 'limited');
    assert.equal(await bridge.request(), 'denied', 'resposta desconhecida conta como negado');
    const page = await bridge.recent({ offset: 0, limit: 60 });
    assert.deepEqual(page.items.map((i) => i.id), ['a'], 'sem miniatura não entra na grade');
    assert.equal(page.more, true);
    const file = await bridge.file('a');
    assert.equal(file.type, 'image/jpeg');
    assert.equal(file.size, 3);
    assert.deepEqual(discarded, ['file:///tmp/x.jpg']);
  });
});

describe('ponte de localização em segundo plano', () => {
  it('liga o vigia com o aviso do Android, repassa posições e erros, e para uma vez só', async () => {
    const { createBackgroundLocationBridge } = await import('./background-location-bridge.ts');
    let cb: ((l?: { latitude: number; longitude: number; accuracy: number; time: number | null }, e?: { code?: string }) => void) | undefined;
    const removed: string[] = [];
    let options: Record<string, unknown> = {};
    const bridge = createBackgroundLocationBridge({
      plugin: {
        async addWatcher(o, c) {
          options = o;
          cb = c;
          return 'w1';
        },
        async removeWatcher(o) {
          removed.push(o.id);
        },
        async openSettings() {},
      },
      http: { request: async () => ({ status: 200 }) },
    });
    const fixes: number[] = [];
    const errors: string[] = [];
    const stop = await bridge.start({ title: 'T', message: 'M', onFix: (f) => fixes.push(f.lat), onError: (c) => errors.push(c) });
    assert.equal(options['backgroundMessage'], 'M');
    assert.equal(options['backgroundTitle'], 'T');
    cb?.({ latitude: -23.5, longitude: -46.6, accuracy: 9.6, time: 1 });
    cb?.(undefined, { code: 'NOT_AUTHORIZED' });
    assert.deepEqual(fixes, [-23.5]);
    assert.deepEqual(errors, ['NOT_AUTHORIZED']);
    await stop();
    await stop();
    assert.deepEqual(removed, ['w1']);
  });

  it('put: manda JSON pelo HTTP nativo e devolve 0 quando a conexão falha', async () => {
    const { createBackgroundLocationBridge } = await import('./background-location-bridge.ts');
    const sent: { headers: Record<string, string>; data?: unknown }[] = [];
    const ok = createBackgroundLocationBridge({
      plugin: { addWatcher: async () => 'x', removeWatcher: async () => {}, openSettings: async () => {} },
      http: { request: async (o) => (sent.push(o), { status: 204 }) },
    });
    assert.equal(await ok.put('https://api/x', { Authorization: 'Bearer t' }, { lat: 1 }), 204);
    assert.equal(sent[0]?.headers['Content-Type'], 'application/json');
    assert.equal(sent[0]?.headers['Authorization'], 'Bearer t');
    const down = createBackgroundLocationBridge({
      plugin: { addWatcher: async () => 'x', removeWatcher: async () => {}, openSettings: async () => {} },
      http: { request: async () => Promise.reject(new Error('offline')) },
    });
    assert.equal(await down.put('https://api/x', {}, {}), 0);
  });

  it('progress: atualiza o aviso fixo pelo plugin do app e não faz nada sem ele (iPhone, build antigo)', async () => {
    const { createBackgroundLocationBridge } = await import('./background-location-bridge.ts');
    const plugin = { addWatcher: async () => 'x', removeWatcher: async () => {}, openSettings: async () => {} };
    const http = { request: async () => ({ status: 200 }) };
    const updates: unknown[] = [];
    const android = createBackgroundLocationBridge({ plugin, http, progress: { update: async (o) => (updates.push(o), { shown: true }) } });
    await android.progress({ title: 'Mostrando', text: '~5 min', progress: 40, arrived: false });
    assert.deepEqual(updates, [{ title: 'Mostrando', text: '~5 min', progress: 40, arrived: false }]);
    const failing = createBackgroundLocationBridge({ plugin, http, progress: { update: async () => Promise.reject(new Error('x')) } });
    await failing.progress({ title: 't', text: '', progress: 0, arrived: false });
    await createBackgroundLocationBridge({ plugin, http }).progress({ title: 't', text: '', progress: 0, arrived: false });
  });
});

test('push: tira da bandeja só os avisos da tela aberta (caminho no iPhone/Android ou título e texto)', async () => {
  const { createPushBridge } = await import('./push-bridge.ts');
  const delivered = [
    { id: 1, data: { url: '/conversas/1' } },
    { id: 2, tag: 'msg:2', data: { 'askout.url': '/conversas/2' } },
    { id: 3, title: 'ana ligou o NOW', body: 'Bora?', data: {} },
    { id: 4, data: { url: '/conversas/9' } },
  ];
  let removed: unknown[] = [];
  const push = {
    checkPermissions: async () => ({ receive: 'granted' }),
    requestPermissions: async () => ({ receive: 'granted' }),
    register: async () => undefined,
    addListener: async () => ({ remove: async () => undefined }),
    getDeliveredNotifications: async () => ({ notifications: delivered }),
    removeDeliveredNotifications: async (o: { notifications: unknown[] }) => void (removed = o.notifications),
  };
  const bridge = createPushBridge({ push: push as never, open: () => undefined });
  assert.equal(await bridge.clearDelivered({ url: '/conversas/2', texts: [] }), 1);
  assert.deepEqual(removed.map((n) => (n as { id: number }).id), [2]);
  assert.equal(await bridge.clearDelivered({ url: '/now', texts: [{ title: 'ana ligou o NOW', body: 'Bora?' }] }), 1);
  assert.deepEqual(removed.map((n) => (n as { id: number }).id), [3]);
});

test('localização nativa: erros do plugin viram os códigos do navegador', async () => {
  const { toGeoError, SERVICES_OFF } = await import('./location-bridge.ts');
  assert.equal(toGeoError({ code: 'OS-PLUG-GLOC-0003', message: 'Location permission request was denied.' }).code, 1);
  const off = toGeoError({ code: 'OS-PLUG-GLOC-0007', message: 'Location services are not enabled.' });
  assert.equal(off.code, 2);
  assert.equal(off.message, SERVICES_OFF);
  assert.equal(toGeoError({ code: 'OS-PLUG-GLOC-0010', message: 'Could not obtain location in time.' }).code, 3);
  assert.equal(toGeoError(new Error('Location services are disabled')).message, SERVICES_OFF);
});

test('localização nativa: watchPosition entrega posições do plugin e clearWatch para a leitura', async () => {
  const { useNativeGeolocation } = await import('./location-bridge.ts');
  let cb: ((p: unknown, e?: unknown) => void) | undefined;
  const cleared: string[] = [];
  const plugin = {
    getCurrentPosition: async () => ({ timestamp: 1, coords: { latitude: 1, longitude: 2, accuracy: 5 } }),
    watchPosition: async (_o: unknown, c: (p: unknown, e?: unknown) => void) => ((cb = c), 'w1'),
    clearWatch: async (o: { id: string }) => void cleared.push(o.id),
  };
  const geo = { getCurrentPosition: () => undefined, watchPosition: () => 0, clearWatch: () => undefined } as unknown as Geolocation;
  useNativeGeolocation(geo, plugin as never, async () => 'granted');
  const got: number[] = [];
  const id = geo.watchPosition((p) => got.push(p.coords.latitude));
  await new Promise((r) => setTimeout(r, 0));
  cb!({ timestamp: 2, coords: { latitude: -23.5, longitude: -46.6, accuracy: 10 } });
  assert.deepEqual(got, [-23.5]);
  geo.clearWatch(id);
  assert.deepEqual(cleared, ['w1']);
  let denied = 0;
  useNativeGeolocation(geo, plugin as never, async () => 'denied');
  geo.watchPosition(() => undefined, (e) => (denied = e.code));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(denied, 1);
});
