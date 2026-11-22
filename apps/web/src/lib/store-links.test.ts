import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_STORE_DEFAULT, PLAY_STORE_DEFAULT, isNativeApp, storeLinks } from './store-links.ts';

test('sem configuração: as duas lojas com os endereços do AskouT', () => {
  assert.deepEqual(storeLinks({}), { apple: APP_STORE_DEFAULT, google: PLAY_STORE_DEFAULT });
  assert.equal(APP_STORE_DEFAULT, 'https://apps.apple.com/br/app/askout/id6826608065');
  assert.equal(PLAY_STORE_DEFAULT, 'https://play.google.com/store/apps/details?id=br.com.askout');
});

test('endereço próprio, só com https', () => {
  assert.equal(storeLinks({ apple: ' https://apps.apple.com/br/app/id1 ' }).apple, 'https://apps.apple.com/br/app/id1');
  assert.equal(storeLinks({ apple: 'javascript:alert(1)' }).apple, undefined);
  assert.equal(storeLinks({ apple: 'http://apps.apple.com/x' }).apple, undefined);
  assert.equal(storeLinks({ google: 'https://play.google.com/store/apps/details?id=x' }).google, 'https://play.google.com/store/apps/details?id=x');
  assert.equal(storeLinks({ google: 'lixo' }).google, undefined);
});

test('"off" esconde a loja', () => {
  assert.deepEqual(storeLinks({ google: 'off' }), { apple: APP_STORE_DEFAULT });
  assert.deepEqual(storeLinks({ apple: 'OFF', google: 'off' }), {});
});

test('fora do app nativo', () => {
  assert.equal(isNativeApp(), false);
});
