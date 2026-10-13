import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pushState, subscriptionBody, urlBase64ToBytes } from './push.ts';
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
