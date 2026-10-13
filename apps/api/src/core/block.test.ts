import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './testing/world.ts';
import { rejectsWith } from './testing/helpers.ts';

test('bloquear: remove seguimentos e solicitações nos dois sentidos e encerra a amizade', async () => {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await w.core.follows.follow(ana!, bia!);
  await w.core.follows.follow(bia!, ana!);
  assert.equal(await w.core.follows.areFriends(ana!, bia!), true);

  await w.core.blocks.block(ana!, bia!);
  assert.equal(await w.follows.get(ana!, bia!), undefined);
  assert.equal(await w.follows.get(bia!, ana!), undefined);
  assert.equal(await w.core.follows.areFriends(ana!, bia!), false);
  assert.deepEqual(await w.core.follows.listFriends(ana!), []);
  assert.deepEqual(await w.core.follows.listFriends(bia!), []);

  // solicitação pendente também some
  await w.core.profiles.setPrivacy(caio!, true);
  await w.core.follows.follow(ana!, caio!);
  await w.core.blocks.block(caio!, ana!);
  assert.equal(await w.follows.get(ana!, caio!), undefined);
});

test('bloquear: é idempotente e não mexe em terceiros', async () => {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await w.core.follows.follow(caio!, ana!);
  await w.core.blocks.block(ana!, bia!);
  await w.core.blocks.block(ana!, bia!);
  assert.deepEqual((await w.core.blocks.list(ana!)).map((p) => p.username), ['bia']);
  assert.ok(await w.follows.get(caio!, ana!), 'seguimento de terceiro permanece');
});

test('bloquear: não pode a si mesmo nem usuário inexistente', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  await rejectsWith(w.core.blocks.block(ana!, ana!), 'VALIDATION');
  await rejectsWith(w.core.blocks.block(ana!, 'nao-existe'), 'NOT_FOUND');
});

test('bloqueado não encontra, não vê o perfil e não aparece na busca do bloqueador', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await w.core.blocks.block(ana!, bia!);

  await rejectsWith(w.core.profiles.getByUsername(bia!, 'ana'), 'NOT_FOUND');
  assert.deepEqual(await w.core.profiles.search(bia!, 'an'), []);
  assert.deepEqual(await w.core.profiles.search(ana!, 'bi'), []);

  // o bloqueador ainda consegue abrir o perfil de quem bloqueou, para poder desbloquear
  const view = await w.core.profiles.getByUsername(ana!, 'bia');
  assert.equal(view.relationship.blockedByViewer, true);
  assert.equal(view.canViewContent, false);
});

test('desbloquear: remove só o bloqueio; seguimentos antigos não voltam', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await w.core.follows.follow(ana!, bia!);
  await w.core.blocks.block(ana!, bia!);

  assert.deepEqual(await w.core.blocks.unblock(ana!, bia!), { removed: true });
  assert.deepEqual(await w.core.blocks.unblock(ana!, bia!), { removed: false });
  assert.equal(await w.follows.get(ana!, bia!), undefined);

  // depois de desbloquear, voltam a poder se seguir
  assert.equal((await w.core.follows.follow(ana!, bia!)).status, 'ACCEPTED');
});

test('bloqueio vale mesmo se a limpeza dos seguimentos falhar (segurança da ordem de gravação)', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await w.core.follows.follow(ana!, bia!);
  await w.core.follows.follow(bia!, ana!);

  // simula falha depois de gravar o bloqueio: só o bloqueio existe, os seguimentos continuam
  await w.blocks.add(ana!, bia!, w.clock.now());

  assert.equal(await w.core.follows.areFriends(ana!, bia!), false);
  assert.deepEqual(await w.core.follows.listFriends(ana!), []);
  assert.deepEqual(await w.core.follows.listFriends(bia!), []);
  assert.equal((await w.core.follows.listFollowers(ana!, ana!)).items.length, 0, 'bia some das listas de ana');

  // repetir a operação conclui a limpeza sem erro
  await w.core.blocks.block(ana!, bia!);
  assert.equal(await w.follows.get(bia!, ana!), undefined);
});

test('lista de bloqueados é só de quem bloqueou', async () => {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await w.core.blocks.block(ana!, bia!);
  await w.core.blocks.block(caio!, ana!);
  assert.deepEqual((await w.core.blocks.list(ana!)).map((p) => p.username), ['bia']);
  assert.deepEqual((await w.core.blocks.list(bia!)).map((p) => p.username), []);
});
