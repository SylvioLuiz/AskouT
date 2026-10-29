import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_CODE_ATTEMPTS, RESEND_COOLDOWN_SECONDS } from './auth-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia');
  const email = [...w.users.users.values()].find((x) => x.id === u['ana'])!.email;
  return { w, ana: u['ana']!, bia: u['bia']!, email };
}

test('esqueci a senha: código por e-mail (ou @usuário), nova senha, entra na conta e a antiga deixa de valer', async () => {
  const { w, ana, email } = await setup();
  await w.core.auth.requestPasswordReset(email);
  assert.equal(w.mailer.sentReset.length, 1);
  assert.equal(w.mailer.sentReset[0]!.to, email);
  const code = w.mailer.lastResetCodeFor(email);
  const result = await w.core.auth.confirmPasswordReset({ identifier: email, code, password: 'Nova-senha-123' });
  assert.equal(result.user.id, ana);
  assert.ok(result.token);
  await rejectsWith(w.core.auth.login({ identifier: email, password: 'senha-antiga-xyz' }), 'UNAUTHORIZED');
  assert.equal((await w.core.auth.login({ identifier: email, password: 'Nova-senha-123' })).user.id, ana);
  await rejectsWith(w.core.auth.confirmPasswordReset({ identifier: email, code, password: 'Outra-senha-123' }), 'VALIDATION');
});

test('conta que não existe: avisa na hora, nada é enviado', async () => {
  const { w, email } = await setup();
  await w.core.auth.requestPasswordReset(email);
  await rejectsWith(w.core.auth.requestPasswordReset('ninguem@exemplo.com'), 'VALIDATION');
  assert.equal(w.mailer.sentReset.length, 1, 'só a conta real recebeu e-mail');
  await rejectsWith(w.core.auth.confirmPasswordReset({ identifier: 'ninguem@exemplo.com', code: '123456', password: 'Nova-senha-123' }), 'VALIDATION');
});

test('limites: espera entre envios, tentativas erradas bloqueiam, código vence, senha fraca é recusada', async () => {
  const { w, email } = await setup();
  await w.core.auth.requestPasswordReset(email);
  await w.core.auth.requestPasswordReset(email);
  assert.equal(w.mailer.sentReset.length, 1, 'pedido repetido antes do intervalo não manda outro');
  w.clock.tick((RESEND_COOLDOWN_SECONDS + 1) * 1000);
  await w.core.auth.requestPasswordReset(email);
  assert.equal(w.mailer.sentReset.length, 2);
  const code = w.mailer.lastResetCodeFor(email);
  const wrong = code === '000000' ? '111111' : '000000';
  await rejectsWith(w.core.auth.confirmPasswordReset({ identifier: email, code, password: '123' }), 'VALIDATION');
  for (let i = 0; i < MAX_CODE_ATTEMPTS - 1; i += 1) await rejectsWith(w.core.auth.confirmPasswordReset({ identifier: email, code: wrong, password: 'Nova-senha-123' }), 'VALIDATION');
  await rejectsWith(w.core.auth.confirmPasswordReset({ identifier: email, code: wrong, password: 'Nova-senha-123' }), 'RATE_LIMITED');
  await rejectsWith(w.core.auth.confirmPasswordReset({ identifier: email, code, password: 'Nova-senha-123' }), 'VALIDATION', 'o pedido foi apagado: nem o código certo vale mais');
  w.clock.tick((RESEND_COOLDOWN_SECONDS + 1) * 1000);
  await w.core.auth.requestPasswordReset(email);
  const fresh = w.mailer.lastResetCodeFor(email);
  w.clock.tick(11 * 60_000);
  await rejectsWith(w.core.auth.confirmPasswordReset({ identifier: email, code: fresh, password: 'Nova-senha-123' }), 'VALIDATION');
});

test('falha no envio não aparece para quem pediu e o pedido pode ser refeito', async () => {
  const { w, email } = await setup();
  w.mailer.failNext = true;
  await w.core.auth.requestPasswordReset(email);
  assert.equal(w.mailer.sentReset.length, 0);
  assert.equal(w.passwordResets.rows.size, 0, 'pedido descartado para poder tentar de novo');
  await w.core.auth.requestPasswordReset(email);
  assert.equal(w.mailer.sentReset.length, 1);
});
