import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const tok = (v: { provider?: string; sub: string; email?: string | null; verified?: boolean; name?: string; picture?: string }) => JSON.stringify({ provider: 'GOOGLE', verified: true, ...v });

test('lista as plataformas configuradas com o ID público do aplicativo', () => {
  const w = makeWorld();
  assert.deepEqual(w.core.auth.socialProviders().map((p) => p.provider), ['GOOGLE', 'APPLE']);
});

test('conta nova: cria já no login (pendente); só depois de completar o cadastro libera; da segunda vez entra direto', async () => {
  const w = makeWorld();
  const first = await w.core.auth.socialLogin({ provider: 'google', idToken: tok({ sub: 'g1', email: 'Bia.Silva@exemplo.com', name: 'Bia Silva' }) });
  assert.ok('token' in first, 'já entra logado');
  assert.equal(first.user.profilePending, true);
  assert.equal(first.user.profile.username, 'bia.silva', 'nome sugerido pelo e-mail');
  assert.equal(first.user.profile.displayName, 'Bia Silva');
  const stored = await w.users.findByEmail('bia.silva@exemplo.com');
  assert.ok(stored, 'conta criada');
  assert.equal(stored.birthDate, null);
  assert.equal(stored.termsVersion, null);
  const actor = { userId: first.user.id, role: first.user.role };
  assert.equal((await w.core.auth.authenticate(first.token)).profilePending, true);

  // Saiu e entrou de novo sem completar: continua pendente.
  const relogin = await w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'g1', email: 'bia.silva@exemplo.com' }) });
  assert.ok('token' in relogin);
  assert.equal(relogin.user.id, first.user.id);
  assert.equal(relogin.user.profilePending, true);

  // Completa: sem data/aceite não vai; menor de 18 não vai; com tudo, conclui.
  await rejectsWith(w.core.auth.completeProfile(actor, { username: 'bia', birthDate: '', acceptTerms: true }), 'VALIDATION');
  await rejectsWith(w.core.auth.completeProfile(actor, { username: 'bia', birthDate: '1990-01-01', acceptTerms: false }), 'VALIDATION');
  await rejectsWith(w.core.auth.completeProfile(actor, { username: 'bia', birthDate: `${w.clock.now().getUTCFullYear() - 10}-01-01`, acceptTerms: true }), 'VALIDATION');
  await rejectsWith(w.core.auth.completeProfile(actor, { username: 'A B', birthDate: '1990-01-01', acceptTerms: true }), 'VALIDATION');
  const done = await w.core.auth.completeProfile(actor, { username: 'bia', birthDate: '1990-01-01', acceptTerms: true });
  assert.equal(done.profilePending, false);
  assert.equal(done.profile.username, 'bia');
  const user = await w.users.findById(first.user.id);
  assert.equal(user?.birthDate, '1990-01-01');
  assert.equal(user?.termsVersion, '2026-10-22');
  assert.equal((await w.core.auth.authenticate(first.token)).profilePending, undefined);
  await rejectsWith(w.core.auth.completeProfile(actor, { username: 'bia2', birthDate: '1990-01-01', acceptTerms: true }), 'CONFLICT');

  // Mudou o e-mail na plataforma: continua a mesma conta, porque liga pelo ID fixo.
  const again = await w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'g1', email: 'outro@exemplo.com' }) });
  assert.ok('token' in again);
  assert.equal(again.user.id, first.user.id);
  assert.equal(again.user.profilePending, false);
  // Quem criou assim não tem senha: o login por senha não funciona.
  await rejectsWith(w.core.auth.login({ identifier: 'bia', password: 'qualquer-senha-123' }), 'UNAUTHORIZED');
});

test('completar cadastro: pode manter o nome sugerido; nome de outra pessoa é recusado', async () => {
  const w = makeWorld();
  await w.signUp('ana');
  const r = await w.core.auth.socialLogin({ provider: 'APPLE', idToken: tok({ provider: 'APPLE', sub: 'a7', email: 'ana@outro.com' }) });
  assert.ok('token' in r);
  assert.equal(r.user.profile.username, 'ana2', 'sugere um livre');
  const actor = { userId: r.user.id, role: r.user.role };
  assert.deepEqual(await w.core.auth.usernameAvailable(actor, 'ana2'), { username: 'ana2', available: true });
  assert.equal((await w.core.auth.usernameAvailable(actor, 'ana')).available, false);
  await rejectsWith(w.core.auth.completeProfile(actor, { username: 'ana', birthDate: '1990-01-01', acceptTerms: true }), 'CONFLICT');
  const ok = await w.core.auth.completeProfile(actor, { username: 'ana2', birthDate: '1990-01-01', acceptTerms: true });
  assert.equal(ok.profile.username, 'ana2');
});

test('painel de gestão não cria conta nova pelo Google/Apple', async () => {
  const w = makeWorld();
  await rejectsWith(w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'g5', email: 'x@exemplo.com' }) }, { requireRole: 'ADMIN' }), 'UNAUTHORIZED');
  assert.equal(await w.users.findByEmail('x@exemplo.com'), undefined);
});

test('contas vinculadas: lista, liga Google numa conta de e-mail e senha, recusa conta de outro perfil e desliga', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  const actor = { userId: ana.user.id, role: ana.user.role };
  assert.deepEqual(await w.core.auth.linkedAccounts(actor), { items: [], hasPassword: true });

  // E-mail do Google diferente do da conta: vale mesmo assim.
  const linked = await w.core.auth.linkAccount(actor, { provider: 'GOOGLE', idToken: tok({ sub: 'g-ana', email: 'ana.pessoal@gmail.com' }) });
  assert.deepEqual(linked.items.map((i) => i.provider), ['GOOGLE']);
  const viaGoogle = await w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'g-ana', email: 'ana.pessoal@gmail.com' }) });
  assert.ok('token' in viaGoogle);
  assert.equal(viaGoogle.user.id, ana.user.id, 'passa a entrar pelo Google');
  // Ligar de novo a mesma conta não muda nada; outra conta Google no mesmo perfil, não.
  assert.equal((await w.core.auth.linkAccount(actor, { provider: 'GOOGLE', idToken: tok({ sub: 'g-ana', email: 'ana.pessoal@gmail.com' }) })).items.length, 1);
  await rejectsWith(w.core.auth.linkAccount(actor, { provider: 'GOOGLE', idToken: tok({ sub: 'g-outra' }) }), 'CONFLICT');
  await rejectsWith(w.core.auth.linkAccount(actor, { provider: 'GOOGLE', idToken: 'lixo' }), 'UNAUTHORIZED');

  // Conta Google de outro perfil: recusa.
  const bia = await w.signUp('bia');
  await rejectsWith(w.core.auth.linkAccount({ userId: bia.user.id, role: bia.user.role }, { provider: 'GOOGLE', idToken: tok({ sub: 'g-ana' }) }), 'CONFLICT');

  const after = await w.core.auth.unlinkAccount(actor, 'google');
  assert.deepEqual(after.items, []);
  assert.equal(await w.identities.find('GOOGLE', 'g-ana'), undefined, 'o Google não entra mais nesse perfil');
});

test('conta criada pelo Google sem senha: não desliga a última forma de entrar; com a Apple também ligada, desliga', async () => {
  const w = makeWorld();
  const r = await w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'g8', email: 'caio@exemplo.com' }) });
  assert.ok('token' in r);
  const actor = { userId: r.user.id, role: r.user.role };
  const list = await w.core.auth.linkedAccounts(actor);
  assert.equal(list.hasPassword, false);
  await rejectsWith(w.core.auth.unlinkAccount(actor, 'GOOGLE'), 'CONFLICT');
  await w.core.auth.linkAccount(actor, { provider: 'APPLE', idToken: tok({ provider: 'APPLE', sub: 'a8' }) });
  assert.deepEqual((await w.core.auth.unlinkAccount(actor, 'GOOGLE')).items.map((i) => i.provider), ['APPLE']);
  await rejectsWith(w.core.auth.unlinkAccount(actor, 'APPLE'), 'CONFLICT');

  // Cria uma senha (sem pedir atual): aí pode desligar a última e entrar com senha.
  await rejectsWith(w.core.account.createPassword(actor.userId, { newPassword: '123' }), 'VALIDATION');
  assert.deepEqual(await w.core.account.createPassword(actor.userId, { newPassword: 'Senha-Forte-2026' }), { hasPassword: true });
  assert.deepEqual(await w.core.account.passwordStatus(actor.userId), { hasPassword: true });
  await rejectsWith(w.core.account.createPassword(actor.userId, { newPassword: 'Outra-Senha-2026' }), 'CONFLICT');
  assert.deepEqual((await w.core.auth.unlinkAccount(actor, 'APPLE')).items, []);
  const byPassword = await w.core.auth.login({ identifier: 'caio@exemplo.com', password: 'Senha-Forte-2026' });
  assert.ok('token' in byPassword);
});

test('e-mail verificado de conta existente liga a ela; não verificado é recusado', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  await rejectsWith(w.core.auth.socialLogin({ birthDate: "1990-01-01", acceptTerms: true, provider: 'GOOGLE', idToken: tok({ sub: 'g9', email: 'ana@exemplo.com', verified: false }) }), 'VALIDATION');
  const r = await w.core.auth.socialLogin({ birthDate: "1990-01-01", acceptTerms: true, provider: 'GOOGLE', idToken: tok({ sub: 'g9', email: 'ana@exemplo.com' }) });
  assert.ok('token' in r);
  assert.equal(r.user.id, ana.user.id);
  const viaApple = await w.core.auth.socialLogin({ birthDate: "1990-01-01", acceptTerms: true, provider: 'APPLE', idToken: tok({ provider: 'APPLE', sub: 'a1', email: 'ana@exemplo.com' }) });
  assert.ok('token' in viaApple);
  assert.equal(viaApple.user.id, ana.user.id, 'Google e Apple na mesma conta');
});

test('recusas: token inválido, plataforma errada, sem e-mail, nome de usuário em uso ou inválido, conta suspensa', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  await rejectsWith(w.core.auth.socialLogin({ birthDate: "1990-01-01", acceptTerms: true, provider: 'GOOGLE', idToken: 'lixo' }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.socialLogin({ birthDate: "1990-01-01", acceptTerms: true, provider: 'GOOGLE', idToken: '' }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.socialLogin({ birthDate: "1990-01-01", acceptTerms: true, provider: 'FACEBOOK', idToken: tok({ sub: 'x' }) }), 'VALIDATION');
  await rejectsWith(w.core.auth.socialLogin({ birthDate: "1990-01-01", acceptTerms: true, provider: 'APPLE', idToken: tok({ sub: 'x', email: 'a@b.com' }) }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.socialLogin({ birthDate: "1990-01-01", acceptTerms: true, provider: 'GOOGLE', idToken: tok({ sub: 'x', email: null }) }), 'VALIDATION');
  await rejectsWith(w.core.auth.socialLogin({ birthDate: "1990-01-01", acceptTerms: true, provider: 'GOOGLE', idToken: tok({ sub: 'x', email: 'novo@exemplo.com' }), username: 'ana' }), 'CONFLICT');
  await rejectsWith(w.core.auth.socialLogin({ birthDate: "1990-01-01", acceptTerms: true, provider: 'GOOGLE', idToken: tok({ sub: 'x', email: 'novo@exemplo.com' }), username: 'A B' }), 'VALIDATION');

  await w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'g1', email: 'ana@exemplo.com' }) });
  w.users.users.get(ana.user.id)!.status = 'SUSPENDED';
  await rejectsWith(w.core.auth.socialLogin({ birthDate: "1990-01-01", acceptTerms: true, provider: 'GOOGLE', idToken: tok({ sub: 'g1', email: 'ana@exemplo.com' }) }), 'FORBIDDEN');
});

test('conta nova com Google: sem data de nascimento ou sem aceite não cria; com os dois, guarda', async () => {
  const w = makeWorld();
  const idToken = tok({ sub: 'g7', email: 'caio@exemplo.com', name: 'Caio' });
  await rejectsWith(w.core.auth.socialLogin({ provider: 'GOOGLE', idToken, username: 'caio' }), 'VALIDATION');
  await rejectsWith(w.core.auth.socialLogin({ provider: 'GOOGLE', idToken, username: 'caio', birthDate: '1990-01-01' }), 'VALIDATION');
  await rejectsWith(w.core.auth.socialLogin({ provider: 'GOOGLE', idToken, username: 'caio', acceptTerms: true, birthDate: `${w.clock.now().getUTCFullYear() - 10}-01-01` }), 'VALIDATION');
  assert.equal(await w.users.findByEmail('caio@exemplo.com'), undefined, 'nada foi criado');
  const ok = await w.core.auth.socialLogin({ provider: 'GOOGLE', idToken, username: 'caio', acceptTerms: true, birthDate: '1990-01-01' });
  assert.ok('token' in ok);
  const user = await w.users.findById(ok.user.id);
  assert.equal(user?.birthDate, '1990-01-01');
  assert.equal(user?.termsVersion, '2026-10-22');
});

test('foto do Google: conta nova já vem com ela; conta sem foto ganha ao entrar; foto já escolhida não muda', async () => {
  const w = makeWorld();
  const pic = 'https://lh3.googleusercontent.com/a/abc123=s96-c';
  const r = await w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'gp', email: 'duda@exemplo.com', picture: pic }) });
  assert.ok('token' in r);
  assert.equal(r.user.profile.avatarUrl, 'https://lh3.googleusercontent.com/a/abc123=s400-c');

  const ana = await w.signUp('ana');
  const linked = await w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'g-ana', email: 'ana@exemplo.com', picture: pic }) });
  assert.ok('token' in linked);
  assert.equal(linked.user.id, ana.user.id);
  assert.equal(linked.user.profile.avatarUrl, 'https://lh3.googleusercontent.com/a/abc123=s400-c');

  const mine = (await w.users.findProfileById(ana.user.id))!;
  await w.users.updateProfile({ ...mine, avatarUrl: 'https://exemplo.com/minha.jpg' });
  const again = await w.core.auth.socialLogin({ provider: 'GOOGLE', idToken: tok({ sub: 'g-ana', email: 'ana@exemplo.com', picture: 'https://lh3.googleusercontent.com/a/outra=s96-c' }) });
  assert.ok('token' in again);
  assert.equal(again.user.profile.avatarUrl, 'https://exemplo.com/minha.jpg');
});
