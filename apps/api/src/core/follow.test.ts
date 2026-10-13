import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './testing/world.ts';
import { rejectsWith } from './testing/helpers.ts';

async function setPrivate(w: ReturnType<typeof makeWorld>, userId: string) {
  await w.core.profiles.setPrivacy(userId, true);
}

test('seguir perfil público: vira ACCEPTED na hora', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  const r = await w.core.follows.follow(ana!, bia!);
  assert.deepEqual(r, { status: 'ACCEPTED', isFriend: false });
});

test('seguir perfil privado: fica PENDING até aprovação', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await setPrivate(w, bia!);
  const r = await w.core.follows.follow(ana!, bia!);
  assert.deepEqual(r, { status: 'PENDING', isFriend: false });
});

test('seguir: não pode seguir a si mesmo nem usuário inexistente ou suspenso', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await rejectsWith(w.core.follows.follow(ana!, ana!), 'VALIDATION');
  await rejectsWith(w.core.follows.follow(ana!, 'nao-existe'), 'NOT_FOUND');
  w.users.users.get(bia!)!.status = 'SUSPENDED';
  await rejectsWith(w.core.follows.follow(ana!, bia!), 'NOT_FOUND');
});

test('seguir é idempotente: não duplica nem promove um PENDING sozinho', async () => {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await w.core.follows.follow(ana!, caio!);
  await w.core.follows.follow(ana!, caio!);
  assert.equal(await w.follows.count(caio!, 'followers', 'ACCEPTED'), 1);

  await setPrivate(w, bia!);
  await w.core.follows.follow(ana!, bia!);
  const again = await w.core.follows.follow(ana!, bia!);
  assert.equal(again.status, 'PENDING');
  assert.equal(await w.follows.count(bia!, 'followers', 'PENDING'), 1);
});

test('amizade: só existe com seguimento mútuo aceito, nos dois sentidos de consulta', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  const f = w.core.follows;

  await f.follow(ana!, bia!);
  assert.equal(await f.areFriends(ana!, bia!), false, 'unilateral não é amizade');
  assert.equal(await f.areFriends(bia!, ana!), false);

  const back = await f.follow(bia!, ana!);
  assert.equal(back.isFriend, true);
  assert.equal(await f.areFriends(ana!, bia!), true);
  assert.equal(await f.areFriends(bia!, ana!), true);
  assert.equal(await f.areFriends(ana!, ana!), false, 'ninguém é amigo de si mesmo');
});

test('amizade: seguimento pendente não conta', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await setPrivate(w, bia!);
  await w.core.follows.follow(bia!, ana!);
  await w.core.follows.follow(ana!, bia!); // PENDING
  assert.equal(await w.core.follows.areFriends(ana!, bia!), false);
  assert.equal(await w.core.follows.areFriends(bia!, ana!), false, 'vale nos dois sentidos de consulta');
  assert.deepEqual(await w.core.follows.listFriends(ana!), []);
  assert.deepEqual(await w.core.follows.listFriends(bia!), []);
});

test('amizade: deixar de seguir encerra a amizade', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await w.core.follows.follow(ana!, bia!);
  await w.core.follows.follow(bia!, ana!);
  assert.equal(await w.core.follows.areFriends(ana!, bia!), true);

  const r = await w.core.follows.unfollow(ana!, bia!);
  assert.deepEqual(r, { removed: true });
  assert.equal(await w.core.follows.areFriends(ana!, bia!), false);
  assert.deepEqual(await w.core.follows.listFriends(bia!), []);
});

test('deixar de seguir é idempotente e também cancela solicitação pendente', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  assert.deepEqual(await w.core.follows.unfollow(ana!, bia!), { removed: false });

  await setPrivate(w, bia!);
  await w.core.follows.follow(ana!, bia!);
  assert.deepEqual(await w.core.follows.unfollow(ana!, bia!), { removed: true });
  assert.equal(await w.follows.count(bia!, 'followers', 'PENDING'), 0);
});

test('aprovar: PENDING vira ACCEPTED e gera amizade se o seguimento for mútuo', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await setPrivate(w, bia!);
  await w.core.follows.follow(bia!, ana!); // bia segue ana (pública)
  await w.core.follows.follow(ana!, bia!); // ana pede para seguir bia

  const r = await w.core.follows.approve(bia!, ana!);
  assert.deepEqual(r, { isFriend: true });
  assert.equal(await w.core.follows.areFriends(ana!, bia!), true);
});

test('aprovar: só o destinatário aprova; inexistente ou já aceita dá NOT_FOUND', async () => {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await setPrivate(w, bia!);
  await w.core.follows.follow(ana!, bia!);

  // Caio não é o destinatário da solicitação de Ana
  await rejectsWith(w.core.follows.approve(caio!, ana!), 'NOT_FOUND');
  // Ana não pode aprovar a própria solicitação (ela é a seguidora, não a dona)
  await rejectsWith(w.core.follows.approve(ana!, bia!), 'NOT_FOUND');

  await w.core.follows.approve(bia!, ana!);
  await rejectsWith(w.core.follows.approve(bia!, ana!), 'NOT_FOUND');
});

test('recusar: remove a solicitação; só vale para pendentes', async () => {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await setPrivate(w, bia!);
  await w.core.follows.follow(ana!, bia!);
  await w.core.follows.reject(bia!, ana!);
  assert.equal(await w.follows.get(ana!, bia!), undefined);

  await rejectsWith(w.core.follows.reject(bia!, ana!), 'NOT_FOUND');

  await w.core.profiles.setPrivacy(bia!, false);
  await w.core.follows.follow(caio!, bia!);
  await rejectsWith(w.core.follows.reject(bia!, caio!), 'NOT_FOUND'); // já aceito
});

test('remover seguidor: encerra o seguimento e a amizade', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await w.core.follows.follow(ana!, bia!);
  await w.core.follows.follow(bia!, ana!);

  await w.core.follows.removeFollower(bia!, ana!);
  assert.equal(await w.core.follows.areFriends(ana!, bia!), false);
  await rejectsWith(w.core.follows.removeFollower(bia!, ana!), 'NOT_FOUND');
});

test('remover seguidor: não serve para solicitação pendente', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await setPrivate(w, bia!);
  await w.core.follows.follow(ana!, bia!);
  await rejectsWith(w.core.follows.removeFollower(bia!, ana!), 'NOT_FOUND');
});

test('bloqueio: quem foi bloqueado não vê nem segue o bloqueador; o bloqueador precisa desbloquear', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await w.core.blocks.block(bia!, ana!);

  await rejectsWith(w.core.follows.follow(ana!, bia!), 'NOT_FOUND'); // bia bloqueou ana
  await rejectsWith(w.core.follows.follow(bia!, ana!), 'CONFLICT'); // bia precisa desbloquear
});

test('listas de seguidores/seguindo: públicas visíveis, paginadas e com total', async () => {
  const w = makeWorld();
  const { alvo, aaa: a, bbb: b, ccc: c } = await w.signUpMany('alvo', 'aaa', 'bbb', 'ccc');
  for (const id of [a!, b!, c!]) {
    w.clock.tick();
    await w.core.follows.follow(id, alvo!);
  }

  const all = await w.core.follows.listFollowers(a!, alvo!);
  assert.equal(all.total, 3);
  assert.deepEqual(all.items.map((p) => p.username), ['ccc', 'bbb', 'aaa'], 'mais recentes primeiro');

  const page = await w.core.follows.listFollowers(a!, alvo!, { limit: 2, offset: 1 });
  assert.deepEqual(page.items.map((p) => p.username), ['bbb', 'aaa']);
  assert.equal(page.limit, 2);
  assert.equal(page.offset, 1);

  const following = await w.core.follows.listFollowing(a!, a!);
  assert.deepEqual(following.items.map((p) => p.username), ['alvo']);
});

test('listas: limite e offset absurdos são ajustados', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  const r = await w.core.follows.listFollowers(ana!, ana!, { limit: 100000, offset: -5 });
  assert.equal(r.limit, 100);
  assert.equal(r.offset, 0);
  const z = await w.core.follows.listFollowers(ana!, ana!, { limit: 0 });
  assert.equal(z.limit, 1);
});

test('listas de conta privada: só o dono e seguidores aprovados enxergam', async () => {
  const w = makeWorld();
  const { dona, seguidor, pendente, estranho } = await w.signUpMany('dona', 'seguidor', 'pendente', 'estranho');
  await setPrivate(w, dona!);
  await w.core.follows.follow(seguidor!, dona!);
  await w.core.follows.approve(dona!, seguidor!);
  await w.core.follows.follow(pendente!, dona!);

  assert.equal((await w.core.follows.listFollowers(dona!, dona!)).total, 1, 'dono vê');
  assert.equal((await w.core.follows.listFollowers(seguidor!, dona!)).total, 1, 'seguidor aprovado vê');
  await rejectsWith(w.core.follows.listFollowers(pendente!, dona!), 'FORBIDDEN');
  await rejectsWith(w.core.follows.listFollowers(estranho!, dona!), 'FORBIDDEN');
  await rejectsWith(w.core.follows.listFollowing(estranho!, dona!), 'FORBIDDEN');
});

test('listas: quem bloqueou o visitante não aparece, e o dono bloqueado vira NOT_FOUND', async () => {
  const w = makeWorld();
  const { alvo, ana, bia } = await w.signUpMany('alvo', 'ana', 'bia');
  await w.core.follows.follow(ana!, alvo!);
  await w.core.follows.follow(bia!, alvo!);
  await w.core.blocks.block(bia!, ana!); // bia bloqueia ana

  const forAna = await w.core.follows.listFollowers(ana!, alvo!);
  assert.deepEqual(forAna.items.map((p) => p.username), ['ana'], 'ana não vê bia');
  const forBia = await w.core.follows.listFollowers(bia!, alvo!);
  assert.deepEqual(forBia.items.map((p) => p.username), ['bia'], 'bia não vê ana');

  await w.core.blocks.block(alvo!, ana!);
  await rejectsWith(w.core.follows.listFollowers(ana!, alvo!), 'NOT_FOUND');
});

test('solicitações pendentes: só as recebidas pelo próprio usuário, mais recentes primeiro', async () => {
  const w = makeWorld();
  const { dona, xxx: x, yyy: y, zzz: z } = await w.signUpMany('dona', 'xxx', 'yyy', 'zzz');
  await setPrivate(w, dona!);
  w.clock.tick();
  await w.core.follows.follow(x!, dona!);
  w.clock.tick();
  await w.core.follows.follow(y!, dona!);
  await w.core.follows.follow(z!, y!); // pedido a outra pessoa, não aparece para dona

  const pending = await w.core.follows.listPendingRequests(dona!);
  assert.deepEqual(pending.items.map((p) => p.username), ['yyy', 'xxx']);
  assert.equal(pending.total, 2);
  assert.equal((await w.core.follows.listPendingRequests(x!)).total, 0);
});

test('amigos: lista só seguimento mútuo, em ordem alfabética, sem suspensos', async () => {
  const w = makeWorld();
  const me = (await w.signUp('eumesmo', { displayName: 'Eu' })).user.id;
  const zeca = (await w.signUp('zeca', { displayName: 'Zeca' })).user.id;
  const ana = (await w.signUp('ana', { displayName: 'Ana' })).user.id;
  const bia = (await w.signUp('bia', { displayName: 'Bia' })).user.id;
  const solo = (await w.signUp('solo', { displayName: 'Solo' })).user.id;

  for (const friend of [zeca, ana, bia]) {
    await w.core.follows.follow(me, friend);
    await w.core.follows.follow(friend, me);
  }
  await w.core.follows.follow(me, solo); // só eu sigo

  assert.deepEqual((await w.core.follows.listFriends(me)).map((p) => p.displayName), ['Ana', 'Bia', 'Zeca']);

  w.users.users.get(bia)!.status = 'SUSPENDED';
  assert.deepEqual((await w.core.follows.listFriends(me)).map((p) => p.displayName), ['Ana', 'Zeca']);
});
