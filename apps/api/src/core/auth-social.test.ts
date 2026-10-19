import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const tok = (v: { provider?: string; sub: string; email?: string | null; verified?: boolean; name?: string }) => JSON.stringify({ provider: 'GOOGLE', verified: true, ...v });

test('lista as plataformas configuradas com o ID público do aplicativo', () => {
  const w = makeWorld();
  assert.deepEqual(w.core.auth.socialProviders().map((p) => p.provider), ['GOOGLE', 'APPLE']);
});

test('conta nova: primeiro pede o nome de usuário; com ele cria e entra; da segunda vez entra direto', async () => {
  const w = makeWorld();
  const first = await w.core.auth.socialLogin({ provider: 'google', idToken: tok({ sub: 'g1', email: 'Bia.Silva@exemplo.com', name: 'Bia Silva' }) });
  assert.deepEqual(first, { needsProfile: true, suggestedUsername: 'bia.silva', displayName: 'Bia Silva' });
  assert.equal(await w.users.findByEmail('bia.silva@exemplo.com'), undefined, 'ainda não criou a conta');

  const created = await w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'g1', email: 'bia.silva@exemplo.com', name: 'Bia Silva' }), username: 'bia' });
  assert.ok('token' in created);
  assert.equal(created.user.profile.username, 'bia');
  assert.equal(created.user.email, 'bia.silva@exemplo.com');

  // Mudou o e-mail na plataforma: continua a mesma conta, porque liga pelo ID fixo.
  const again = await w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'g1', email: 'outro@exemplo.com' }) });
  assert.ok('token' in again);
  assert.equal(again.user.id, created.user.id);
  // Quem criou assim não tem senha: o login por senha não funciona.
  await rejectsWith(w.core.auth.login({ identifier: 'bia', password: 'qualquer-senha-123' }), 'UNAUTHORIZED');
});

test('e-mail verificado de conta existente liga a ela; não verificado é recusado', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  await rejectsWith(w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'g9', email: 'ana@exemplo.com', verified: false }) }), 'VALIDATION');
  const r = await w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'g9', email: 'ana@exemplo.com' }) });
  assert.ok('token' in r);
  assert.equal(r.user.id, ana.user.id);
  const viaApple = await w.core.auth.socialLogin({ provider: 'APPLE', idToken: tok({ provider: 'APPLE', sub: 'a1', email: 'ana@exemplo.com' }) });
  assert.ok('token' in viaApple);
  assert.equal(viaApple.user.id, ana.user.id, 'Google e Apple na mesma conta');
});

test('recusas: token inválido, plataforma errada, sem e-mail, nome de usuário em uso ou inválido, conta suspensa', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  await rejectsWith(w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: 'lixo' }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: '' }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.socialLogin({ provider: 'FACEBOOK', idToken: tok({ sub: 'x' }) }), 'VALIDATION');
  await rejectsWith(w.core.auth.socialLogin({ provider: 'APPLE', idToken: tok({ sub: 'x', email: 'a@b.com' }) }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'x', email: null }) }), 'VALIDATION');
  await rejectsWith(w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'x', email: 'novo@exemplo.com' }), username: 'ana' }), 'CONFLICT');
  await rejectsWith(w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'x', email: 'novo@exemplo.com' }), username: 'A B' }), 'VALIDATION');

  await w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'g1', email: 'ana@exemplo.com' }) });
  w.users.users.get(ana.user.id)!.status = 'SUSPENDED';
  await rejectsWith(w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'g1', email: 'ana@exemplo.com' }) }), 'FORBIDDEN');
});
