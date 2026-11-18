import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleMode, nativeAppleBridge, nativeGoogleBridge } from './social-login.ts';

test('nativeAppleBridge: só existe dentro do app do iPhone, com a função signIn', () => {
  assert.equal(nativeAppleBridge({}), undefined, 'navegador comum');
  assert.equal(nativeAppleBridge({ AskouTApple: {} }), undefined, 'ponte incompleta');
  const bridge = { signIn: async () => 'jwt' };
  assert.equal(nativeAppleBridge({ AskouTApple: bridge }), bridge);
});

test('googleMode: botão do Google na web; janela nativa no app; some no app sem configuração nativa', () => {
  const item = { clientId: 'web' };
  assert.equal(googleMode(item, {}), 'web', 'navegador comum');
  assert.equal(nativeGoogleBridge({ AskouTGoogle: { signIn: () => undefined } }), undefined, 'ponte incompleta');
  const android = { AskouTGoogle: { signIn: async () => 't', available: () => true } };
  assert.equal(googleMode(item, android), 'native');
  const iphoneSemCliente = { AskouTGoogle: { signIn: async () => 't', available: (ids: { iosClientId?: string }) => Boolean(ids.iosClientId) } };
  assert.equal(googleMode(item, iphoneSemCliente), 'none');
  assert.equal(googleMode({ clientId: 'web', iosClientId: 'ios' }, iphoneSemCliente), 'native');
});
