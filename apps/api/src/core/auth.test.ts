import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD, makeWorld } from './testing/world.ts';
import { rejectsWith } from './testing/helpers.ts';

test('cadastro: cria usuário, normaliza dados e devolve token sem expor o hash', async () => {
  const w = makeWorld();
  const result = await w.core.auth.register({
    email: '  Ana@Exemplo.COM ',
    username: '@Ana.Silva',
    password: PASSWORD,
  });

  assert.equal(result.user.email, 'ana@exemplo.com');
  assert.equal(result.user.profile.username, 'ana.silva');
  assert.equal(result.user.profile.displayName, 'ana.silva', 'nome padrão = username');
  assert.equal(result.user.role, 'USER');
  assert.equal(result.user.profile.isPrivate, false, 'perfil começa público');

  const json = JSON.stringify(result);
  assert.ok(!json.includes('passwordHash'));
  assert.ok(!json.includes('scrypt$'));
  assert.ok(!json.includes(PASSWORD));

  const stored = await w.users.findById(result.user.id);
  assert.ok(stored);
  assert.notEqual(stored.passwordHash, PASSWORD);
  assert.equal(stored.status, 'ACTIVE');
});

test('cadastro: reúne todos os campos inválidos em um único erro', async () => {
  const w = makeWorld();
  const err = await rejectsWith(
    w.core.auth.register({ email: 'nao-e-email', username: 'a', password: '123' }),
    'VALIDATION',
  );
  assert.deepEqual(Object.keys(err.details ?? {}).sort(), ['email', 'password', 'username']);
});

test('cadastro: valores que não são texto viram erro de validação, sem quebrar', async () => {
  const w = makeWorld();
  await rejectsWith(w.core.auth.register({ email: 123, username: {}, password: null }), 'VALIDATION');
  await rejectsWith(w.core.auth.register({ email: ['a@b.com'], username: 'ana', password: PASSWORD }), 'VALIDATION');
});

test('cadastro: e-mail e username repetidos (sem diferenciar maiúsculas) dão CONFLICT', async () => {
  const w = makeWorld();
  await w.signUp('ana');

  const email = await rejectsWith(
    w.core.auth.register({ email: 'ANA@exemplo.com', username: 'outra', password: PASSWORD }),
    'CONFLICT',
  );
  assert.ok(email.details?.email);

  const username = await rejectsWith(
    w.core.auth.register({ email: 'outra@exemplo.com', username: '@ANA', password: PASSWORD }),
    'CONFLICT',
  );
  assert.ok(username.details?.username);
});

test('cadastro: o repositório também barra duplicatas (proteção contra corrida)', async () => {
  const w = makeWorld();
  const a = await w.signUp('ana');
  const user = (await w.users.findById(a.user.id))!;
  const profile = (await w.users.findProfileById(a.user.id))!;
  await rejectsWith(w.users.create({ ...user, id: 'x' }, { ...profile, userId: 'x', username: 'novo' }), 'CONFLICT');
  await rejectsWith(
    w.users.create({ ...user, id: 'y', email: 'novo@exemplo.com' }, { ...profile, userId: 'y' }),
    'CONFLICT',
  );
});

test('cadastro: username reservado é recusado', async () => {
  const w = makeWorld();
  await rejectsWith(w.core.auth.register({ email: 'a@b.com', username: 'admin', password: PASSWORD }), 'VALIDATION');
});

test('login: sucesso devolve token que autentica o usuário', async () => {
  const w = makeWorld();
  const reg = await w.signUp('ana');
  const login = await w.core.auth.login({ email: 'ANA@exemplo.com', password: PASSWORD });
  assert.equal(login.user.id, reg.user.id);

  const actor = await w.core.auth.authenticate(login.token);
  assert.deepEqual(actor, { userId: reg.user.id, role: 'USER' });
});

test('login: senha errada e e-mail inexistente dão a mesma resposta', async () => {
  const w = makeWorld();
  await w.signUp('ana');
  const wrongPassword = await rejectsWith(w.core.auth.login({ email: 'ana@exemplo.com', password: 'errada-123' }), 'UNAUTHORIZED');
  const unknownEmail = await rejectsWith(w.core.auth.login({ email: 'ninguem@exemplo.com', password: PASSWORD }), 'UNAUTHORIZED');
  assert.equal(wrongPassword.message, unknownEmail.message);
});

test('login: entradas absurdas são recusadas sem custo de hash', async () => {
  const w = makeWorld();
  await w.signUp('ana');
  await rejectsWith(w.core.auth.login({ email: 'ana@exemplo.com', password: '' }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.login({ email: 'ana@exemplo.com', password: 'x'.repeat(5000) }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.login({ email: undefined, password: undefined }), 'UNAUTHORIZED');
});

test('login: calcula o hash mesmo quando o e-mail não existe (sem vazar pelo tempo)', async () => {
  const w = makeWorld();
  await w.signUp('ana');
  const seen: string[] = [];
  const original = w.hasher.verify.bind(w.hasher);
  w.hasher.verify = async (password, stored) => {
    seen.push(stored);
    return original(password, stored);
  };
  await rejectsWith(w.core.auth.login({ email: 'ninguem@exemplo.com', password: PASSWORD }), 'UNAUTHORIZED');
  assert.equal(seen.length, 1);
  assert.match(seen[0]!, /^scrypt\$\d+\$\d+\$\d+\$/, 'verifica contra um hash real, com o custo completo');
});

test('login: conta suspensa só é revelada a quem sabe a senha', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  w.users.users.get(ana.user.id)!.status = 'SUSPENDED';

  await rejectsWith(w.core.auth.login({ email: 'ana@exemplo.com', password: PASSWORD }), 'FORBIDDEN');
  await rejectsWith(w.core.auth.login({ email: 'ana@exemplo.com', password: 'errada-123' }), 'UNAUTHORIZED');
});

test('login: conta com exclusão solicitada ainda pode entrar', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  w.users.users.get(ana.user.id)!.status = 'DELETION_REQUESTED';
  const login = await w.core.auth.login({ email: 'ana@exemplo.com', password: PASSWORD });
  assert.equal(login.user.id, ana.user.id);
});

test('autenticação: token adulterado, vazio ou de outro tipo é recusado', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  await rejectsWith(w.core.auth.authenticate(ana.token + 'x'), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.authenticate(''), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.authenticate(undefined), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.authenticate(42), 'UNAUTHORIZED');
});

test('autenticação: token expirado é recusado', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  w.clock.tick(2 * 60 * 60 * 1000); // TTL padrão é 1 hora
  await rejectsWith(w.core.auth.authenticate(ana.token), 'UNAUTHORIZED');
});

test('autenticação: suspensão vale na hora, mesmo com token ainda válido', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  assert.ok(await w.core.auth.authenticate(ana.token));
  w.users.users.get(ana.user.id)!.status = 'SUSPENDED';
  await rejectsWith(w.core.auth.authenticate(ana.token), 'UNAUTHORIZED');
});

test('autenticação: o papel vem do banco, não do token', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  w.users.users.get(ana.user.id)!.role = 'ADMIN';
  const actor = await w.core.auth.authenticate(ana.token);
  assert.equal(actor.role, 'ADMIN');
});

test('autenticação: usuário removido deixa o token inválido', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  w.users.users.delete(ana.user.id);
  await rejectsWith(w.core.auth.authenticate(ana.token), 'UNAUTHORIZED');
});
