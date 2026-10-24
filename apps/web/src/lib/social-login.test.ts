import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeAppleBridge } from './social-login.ts';

test('nativeAppleBridge: só existe dentro do app do iPhone, com a função signIn', () => {
  assert.equal(nativeAppleBridge({}), undefined, 'navegador comum');
  assert.equal(nativeAppleBridge({ AskouTApple: {} }), undefined, 'ponte incompleta');
  const bridge = { signIn: async () => 'jwt' };
  assert.equal(nativeAppleBridge({ AskouTApple: bridge }), bridge);
});
