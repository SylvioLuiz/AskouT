import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nativeEndpoint, nativePushAction, nativePushBridge, nativePushState, nativeSubscription, pushState, shouldAutoAskPush, subscriptionBody, urlBase64ToBytes } from './push.ts';
import type { PushEnvironment } from './push.ts';

const base: PushEnvironment = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, secureContext: true, permission: 'default', isApple: false, standalone: false, serverKey: 'k', subscribed: false };

describe('push', () => {
  it('decide o estado do botão', () => {
    assert.equal(pushState(base), 'off');
    assert.equal(pushState({ ...base, permission: 'granted', subscribed: true }), 'on');
    assert.equal(pushState({ ...base, permission: 'granted', subscribed: false }), 'off');
    assert.equal(pushState({ ...base, permission: 'denied' }), 'denied');
    assert.equal(pushState({ ...base, serverKey: null }), 'not-configured');
    assert.equal(pushState({ ...base, hasPushManager: false }), 'unsupported');
    assert.equal(pushState({ ...base, secureContext: false }), 'unsupported');
    assert.equal(pushState({ ...base, isApple: true, standalone: false }), 'needs-install');
    assert.equal(pushState({ ...base, isApple: true, standalone: true }), 'off');
  });
  it('converte a chave base64url', () => {
    assert.deepEqual([...urlBase64ToBytes('AQID')], [1, 2, 3]);
    assert.deepEqual([...urlBase64ToBytes('-_8')], [251, 255]);
  });
  it('valida a inscrição do navegador', () => {
    assert.deepEqual(subscriptionBody({ endpoint: 'https://x', keys: { p256dh: 'a', auth: 'b' } }), { endpoint: 'https://x', keys: { p256dh: 'a', auth: 'b' } });
    assert.throws(() => subscriptionBody({ endpoint: 'https://x' }));
    assert.throws(() => subscriptionBody({ keys: { p256dh: 'a', auth: 'b' } }));
  });
});

describe('push no app do iPhone', () => {
  it('estado do botão com a ponte nativa', () => {
    const ok = { serverNative: true, permission: 'prompt' as const, hasToken: false };
    assert.equal(nativePushState(ok), 'off');
    assert.equal(nativePushState({ ...ok, permission: 'granted', hasToken: true }), 'on');
    assert.equal(nativePushState({ ...ok, permission: 'granted', hasToken: false }), 'off');
    assert.equal(nativePushState({ ...ok, permission: 'denied' }), 'denied');
    assert.equal(nativePushState({ ...ok, serverNative: false }), 'not-configured');
  });
  it('só reconhece a ponte completa e monta o endereço do aparelho', () => {
    assert.equal(nativePushBridge({}), undefined);
    assert.equal(nativePushBridge({ AskouTPush: { permission: async () => 'granted' } }), undefined, 'ponte incompleta');
    const bridge = { permission: async () => 'granted' as const, register: async () => 'ab12' };
    assert.equal(nativePushBridge({ AskouTPush: bridge }), bridge);
    assert.equal(nativeEndpoint('ab12'), 'apns:ab12');
    assert.equal(nativeEndpoint('cAb:APA91b-x_y'), 'fcm:cAb:APA91b-x_y');
  });
  it('pede permissão sozinho só uma vez e só se o iPhone ainda não decidiu', () => {
    const ok = { serverNative: true, permission: 'prompt' as const, alreadyAsked: false };
    assert.equal(shouldAutoAskPush(ok), true);
    assert.equal(shouldAutoAskPush({ ...ok, alreadyAsked: true }), false);
    assert.equal(shouldAutoAskPush({ ...ok, permission: 'denied' }), false);
    assert.equal(shouldAutoAskPush({ ...ok, permission: 'granted' }), false);
    assert.equal(shouldAutoAskPush({ ...ok, serverNative: false }), false);
  });
  it('ao abrir o app: pede, registra (Android que já libera sem perguntar), atualiza ou não faz nada', () => {
    const base = { serverNative: true, permission: 'prompt' as const, alreadyAsked: false, hasToken: false, optedOut: false };
    assert.equal(nativePushAction(base), 'ask');
    assert.equal(nativePushAction({ ...base, alreadyAsked: true }), 'none');
    assert.equal(nativePushAction({ ...base, permission: 'granted' }), 'register');
    assert.equal(nativePushAction({ ...base, permission: 'granted', alreadyAsked: true }), 'register');
    assert.equal(nativePushAction({ ...base, permission: 'granted', hasToken: true }), 'refresh');
    assert.equal(nativePushAction({ ...base, permission: 'granted', optedOut: true }), 'none');
    assert.equal(nativePushAction({ ...base, permission: 'denied' }), 'none');
    assert.equal(nativePushAction({ ...base, permission: 'granted', serverNative: false }), 'none');
  });
});

describe('"Responder" na notificação', () => {
  it('só pede o campo de resposta quando a casca nativa sabe mostrar', () => {
    const iphone = 'a'.repeat(64);
    assert.deepEqual(nativeSubscription({ replies: true }, iphone), { endpoint: `apns:${iphone}`, reply: true });
    assert.deepEqual(nativeSubscription({}, iphone), { endpoint: `apns:${iphone}` }, 'app antigo: aviso de sempre (no Android, o novo formato não apareceria)');
  });
});
