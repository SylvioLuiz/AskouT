import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automatedPublishGate } from './automated-publish-gate.ts';

test('local sem responsável e sem pedido: pode publicar', () => {
  assert.deepEqual(automatedPublishGate({ ownerId: null }, []), { allowed: true });
});

test('local com responsável: não publica', () => {
  assert.deepEqual(automatedPublishGate({ ownerId: 'u1' }, ['APPROVED']), { allowed: false, reason: 'OWNED' });
  assert.deepEqual(automatedPublishGate({ ownerId: 'u1' }, []), { allowed: false, reason: 'OWNED' });
});

test('pedido pendente suspende a publicação, mesmo com outro rejeitado', () => {
  assert.deepEqual(automatedPublishGate({ ownerId: null }, ['PENDING']), { allowed: false, reason: 'CLAIM_PENDING' });
  assert.deepEqual(automatedPublishGate({ ownerId: null }, ['REJECTED', 'PENDING']), { allowed: false, reason: 'CLAIM_PENDING' });
});

test('pedido rejeitado sozinho libera', () => {
  assert.deepEqual(automatedPublishGate({ ownerId: null }, ['REJECTED']), { allowed: true });
});

test('aprovado sem responsável atual (dono removido) libera: vale o ownerId', () => {
  assert.deepEqual(automatedPublishGate({ ownerId: null }, ['APPROVED']), { allowed: true });
});

test('local desconhecido ou consulta que falhou: não publica', () => {
  assert.deepEqual(automatedPublishGate(null, []), { allowed: false, reason: 'UNKNOWN' });
  assert.deepEqual(automatedPublishGate(undefined, []), { allowed: false, reason: 'UNKNOWN' });
  assert.deepEqual(automatedPublishGate({ ownerId: null }, null), { allowed: false, reason: 'UNKNOWN' });
});
