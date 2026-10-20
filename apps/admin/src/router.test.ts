import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchRoute } from './routes.ts';

test('matchRoute: reconhece páginas, ignora barra final e cai no painel', () => {
  assert.equal(matchRoute('/'), '/');
  assert.equal(matchRoute('/pedidos'), '/pedidos');
  assert.equal(matchRoute('/pedidos/'), '/pedidos');
  assert.equal(matchRoute('/auditoria'), '/auditoria');
  assert.equal(matchRoute('/retencao'), '/retencao');
  assert.equal(matchRoute('/nada'), '/');
});
