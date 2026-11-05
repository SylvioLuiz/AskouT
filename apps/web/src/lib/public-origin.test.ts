import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC_ORIGIN, shareOrigin } from './public-origin.ts';

test('links compartilhados nunca levam localhost nem o endereço do app nativo', () => {
  for (const o of ['http://localhost:5173', 'capacitor://localhost', 'https://localhost', 'http://127.0.0.1:5173', 'http://192.168.0.12:5173', 'http://askout.localhost', 'ionic://localhost', 'lixo']) {
    assert.equal(shareOrigin(o), PUBLIC_ORIGIN, o);
  }
  assert.equal(shareOrigin('https://askout.com.br'), 'https://askout.com.br');
  assert.equal(shareOrigin('https://www.askout.com.br/'), 'https://www.askout.com.br');
  assert.equal(shareOrigin('https://staging.askout.com.br'), 'https://staging.askout.com.br');
});
