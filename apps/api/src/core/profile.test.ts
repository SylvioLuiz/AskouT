import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './testing/world.ts';
import { rejectsWith } from './testing/helpers.ts';

test('perfil: visão do próprio usuário', async () => {
  const w = makeWorld();
  const ana = (await w.signUp('ana', { displayName: 'Ana Silva' })).user.id;
  const view = await w.core.profiles.getByUsername(ana, '@Ana');
  assert.equal(view.profile.displayName, 'Ana Silva');
  assert.equal(view.relationship.isSelf, true);
  assert.equal(view.canViewContent, true);
  assert.deepEqual(view.counts, { followers: 0, following: 0, events: 0 });
});

test('perfil: contadores contam só seguimentos aceitos', async () => {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await w.core.profiles.setPrivacy(bia!, true);
  await w.core.follows.follow(ana!, bia!); // pendente
  await w.core.follows.follow(caio!, bia!); // pendente
  await w.core.follows.approve(bia!, caio!);
  await w.core.follows.follow(bia!, ana!);

  const view = await w.core.profiles.getByUsername(ana!, 'bia');
  assert.deepEqual(view.counts, { followers: 1, following: 1, events: 0 });
});

test('perfil: relacionamento com o visitante (seguindo, pendente, seguido, amigo)', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');

  let v = await w.core.profiles.getByUsername(ana!, 'bia');
  assert.deepEqual(
    [v.relationship.following, v.relationship.followsYou, v.relationship.isFriend],
    ['NONE', 'NONE', false],
  );

  await w.core.profiles.setPrivacy(bia!, true);
  await w.core.follows.follow(ana!, bia!);
  v = await w.core.profiles.getByUsername(ana!, 'bia');
  assert.equal(v.relationship.following, 'PENDING');

  await w.core.follows.approve(bia!, ana!);
  await w.core.follows.follow(bia!, ana!);
  v = await w.core.profiles.getByUsername(ana!, 'bia');
  assert.deepEqual(
    [v.relationship.following, v.relationship.followsYou, v.relationship.isFriend],
    ['ACCEPTED', 'ACCEPTED', true],
  );
});

test('perfil: conteúdo de conta privada só para o dono e seguidores aprovados', async () => {
  const w = makeWorld();
  const { dona, seguidor, pendente, estranho } = await w.signUpMany('dona', 'seguidor', 'pendente', 'estranho');
  await w.core.profiles.setPrivacy(dona!, true);
  await w.core.follows.follow(seguidor!, dona!);
  await w.core.follows.approve(dona!, seguidor!);
  await w.core.follows.follow(pendente!, dona!);

  const can = async (viewer: string) => (await w.core.profiles.getByUsername(viewer, 'dona')).canViewContent;
  assert.equal(await can(dona!), true);
  assert.equal(await can(seguidor!), true);
  assert.equal(await can(pendente!), false);
  assert.equal(await can(estranho!), false);
});

test('perfil: conta pública libera o conteúdo; suspenso e inexistente dão NOT_FOUND', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  assert.equal((await w.core.profiles.getByUsername(ana!, 'bia')).canViewContent, true);

  await rejectsWith(w.core.profiles.getByUsername(ana!, 'fantasma'), 'NOT_FOUND');
  await rejectsWith(w.core.profiles.getByUsername(ana!, undefined), 'NOT_FOUND');
  w.users.users.get(bia!)!.status = 'SUSPENDED';
  await rejectsWith(w.core.profiles.getByUsername(ana!, 'bia'), 'NOT_FOUND');
});

test('editar perfil: atualiza só o que foi enviado', async () => {
  const w = makeWorld();
  const ana = (await w.signUp('ana', { displayName: 'Ana' })).user.id;
  const updated = await w.core.profiles.updateOwn(ana, {
    displayName: '  Ana   Luiza ',
    bio: ' Quem topa um chopp? ',
    avatarUrl: 'https://cdn.exemplo.com/ana.png',
  });
  assert.equal(updated.displayName, 'Ana Luiza');
  assert.equal(updated.bio, 'Quem topa um chopp?');
  assert.equal(updated.avatarUrl, 'https://cdn.exemplo.com/ana.png');

  const partial = await w.core.profiles.updateOwn(ana, { bio: '' });
  assert.equal(partial.bio, null, 'vazio limpa a bio');
  assert.equal(partial.displayName, 'Ana Luiza', 'nome preservado');

  const cleared = await w.core.profiles.updateOwn(ana, { avatarUrl: null });
  assert.equal(cleared.avatarUrl, null);

  assert.equal((await w.users.findProfileById(ana))!.username, 'ana', 'username não muda por aqui');
});

test('editar perfil: valida cada campo e não grava nada se algum falhar', async () => {
  const w = makeWorld();
  const ana = (await w.signUp('ana', { displayName: 'Ana' })).user.id;
  const err = await rejectsWith(
    w.core.profiles.updateOwn(ana, { displayName: 'Nova', bio: 'a'.repeat(151), avatarUrl: 'http://x.com/a.png' }),
    'VALIDATION',
  );
  assert.deepEqual(Object.keys(err.details ?? {}).sort(), ['avatarUrl', 'bio']);
  assert.equal((await w.users.findProfileById(ana))!.displayName, 'Ana');

  await rejectsWith(w.core.profiles.updateOwn(ana, { displayName: '   ' }), 'VALIDATION');
  await rejectsWith(w.core.profiles.updateOwn(ana, { displayName: 42 }), 'VALIDATION');
  await rejectsWith(w.core.profiles.updateOwn(ana, { bio: 42 }), 'VALIDATION');
  await rejectsWith(w.core.profiles.updateOwn(ana, { avatarUrl: 42 }), 'VALIDATION');
  await rejectsWith(w.core.profiles.updateOwn('nao-existe', { bio: 'oi' }), 'NOT_FOUND');
});

test('privacidade: tornar público aceita as solicitações pendentes', async () => {
  const w = makeWorld();
  const { dona, xxx: x, yyy: y } = await w.signUpMany('dona', 'xxx', 'yyy');
  await w.core.profiles.setPrivacy(dona!, true);
  await w.core.follows.follow(x!, dona!);
  await w.core.follows.follow(y!, dona!);

  const r = await w.core.profiles.setPrivacy(dona!, false);
  assert.deepEqual(r, { isPrivate: false, acceptedPending: 2 });
  assert.equal((await w.follows.get(x!, dona!))!.status, 'ACCEPTED');
  assert.equal((await w.core.profiles.getByUsername(x!, 'dona')).counts.followers, 2);
});

test('privacidade: tornar privado mantém os seguidores atuais e repetir não faz nada', async () => {
  const w = makeWorld();
  const { dona, xxx: x } = await w.signUpMany('dona', 'xxx');
  await w.core.follows.follow(x!, dona!);

  assert.deepEqual(await w.core.profiles.setPrivacy(dona!, true), { isPrivate: true, acceptedPending: 0 });
  assert.equal((await w.follows.get(x!, dona!))!.status, 'ACCEPTED');
  assert.deepEqual(await w.core.profiles.setPrivacy(dona!, true), { isPrivate: true, acceptedPending: 0 });

  await rejectsWith(w.core.profiles.setPrivacy(dona!, 'sim'), 'VALIDATION');
  await rejectsWith(w.core.profiles.setPrivacy('nao-existe', true), 'NOT_FOUND');
});

test('busca: exige ao menos 2 caracteres', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  await rejectsWith(w.core.profiles.search(ana!, 'a'), 'VALIDATION');
  await rejectsWith(w.core.profiles.search(ana!, '@'), 'VALIDATION');
  await rejectsWith(w.core.profiles.search(ana!, undefined), 'VALIDATION');
});

test('busca: por prefixo de username ou trecho do nome, sem o próprio usuário', async () => {
  const w = makeWorld();
  const eu = (await w.signUp('maria.eu', { displayName: 'Maria Eu' })).user.id;
  await w.signUp('maria.souza', { displayName: 'Maria Souza' });
  await w.signUp('joao', { displayName: 'João da Maria' });
  await w.signUp('pedro', { displayName: 'Pedro' });

  const found = await w.core.profiles.search(eu, '@Maria');
  assert.deepEqual(found.map((p) => p.username), ['joao', 'maria.souza']);
  assert.ok(!JSON.stringify(found).includes('email'));
});

test('busca: ignora suspensos, respeita o limite e não passa de 50', async () => {
  const w = makeWorld();
  const eu = (await w.signUp('eu.mesmo')).user.id;
  const ids = await w.signUpMany('luz.a', 'luz.b', 'luz.c', 'luz.d');
  w.users.users.get(ids['luz.d']!)!.status = 'SUSPENDED';

  assert.deepEqual((await w.core.profiles.search(eu, 'luz')).map((p) => p.username), ['luz.a', 'luz.b', 'luz.c']);
  assert.equal((await w.core.profiles.search(eu, 'luz', 2)).length, 2);
  assert.equal((await w.core.profiles.search(eu, 'luz', 9999)).length, 3);
});
