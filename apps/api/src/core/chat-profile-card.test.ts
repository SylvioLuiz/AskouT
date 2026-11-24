import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

type World = ReturnType<typeof makeWorld>;

async function befriend(w: World, a: string, b: string) {
  await w.core.follows.follow(a, b);
  await w.core.follows.follow(b, a);
}

/** ana e bia conversam; caio é público, duda é privada (ninguém a segue). */
async function setup() {
  const w = makeWorld();
  const { ana, bia, caio, duda } = await w.signUpMany('ana', 'bia', 'caio', 'duda');
  await befriend(w, ana!, bia!);
  await w.core.profiles.setPrivacy(duda!, true);
  const chat = await w.core.conversations.open(ana!, bia!);
  return { w, ana: ana!, bia: bia!, caio: caio!, duda: duda!, id: chat.id };
}

const cardFor = async (w: World, viewer: string, id: string) => (await w.core.conversations.messages(viewer, id)).messages.at(-1)!;

test('perfil no chat: vai como cartão, com texto neutro na prévia', async () => {
  const { w, ana, bia, id } = await setup();
  const sent = await w.core.conversations.send(ana, id, { profileUsername: '@Caio' });
  assert.equal(sent.body, 'Perfil compartilhado');
  assert.equal(sent.sharedProfile?.profile?.username, 'caio');
  assert.equal(sent.sharedProfile?.canView, true);
  const seen = await cardFor(w, bia, id);
  assert.equal(seen.sharedProfile?.profile?.username, 'caio');
  assert.equal(seen.sharedProfile?.following, 'NONE');
  const item = (await w.core.conversations.list(bia)).find((c) => c.id === id)!;
  assert.equal(item.lastMessage?.body, 'Perfil compartilhado', 'a lista não revela de quem é o perfil');
  const own = await w.core.conversations.send(ana, id, { profileUsername: 'ana' });
  assert.equal(own.sharedProfile?.following, 'SELF');
});

test('perfil privado: cartão só com nome, @ e foto para quem não segue', async () => {
  const { w, ana, bia, duda, id } = await setup();
  await w.core.conversations.send(ana, id, { profileUsername: 'duda' });
  const seen = await cardFor(w, bia, id);
  assert.equal(seen.sharedProfile?.profile?.isPrivate, true);
  assert.equal(seen.sharedProfile?.canView, false);
  assert.deepEqual(Object.keys(seen.sharedProfile!.profile!).sort(), ['avatarUrl', 'displayName', 'isPrivate', 'userId', 'username']);
  await w.core.follows.follow(bia, duda);
  assert.equal((await cardFor(w, bia, id)).sharedProfile?.following, 'PENDING');
  assert.equal((await cardFor(w, bia, id)).sharedProfile?.canView, false, 'pedido pendente ainda não abre o perfil');
});

test('bloqueio: não dá para compartilhar, e quem tem bloqueio vê "indisponível"', async () => {
  const { w, ana, bia, caio, id } = await setup();
  await w.core.blocks.block(caio, ana);
  await rejectsWith(w.core.conversations.send(ana, id, { profileUsername: 'caio' }), 'NOT_FOUND');
  await w.core.blocks.unblock(caio, ana);
  await w.core.conversations.send(ana, id, { profileUsername: 'caio' });
  await w.core.blocks.block(bia, caio);
  const seen = await cardFor(w, bia, id);
  assert.equal(seen.sharedProfile?.profile, null, 'quem bloqueou não vê nada da pessoa');
  assert.equal(seen.body, 'Perfil compartilhado');
  assert.equal((await cardFor(w, ana, id)).sharedProfile?.profile?.username, 'caio', 'quem não tem bloqueio continua vendo');
});

test('perfil inexistente ou inválido: não encontrado; só um conteúdo por mensagem', async () => {
  const { w, ana, id } = await setup();
  await rejectsWith(w.core.conversations.send(ana, id, { profileUsername: 'ninguem' }), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.send(ana, id, { profileUsername: 42 }), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.send(ana, id, { profileUsername: 'caio', body: 'oi' }), 'VALIDATION');
});

test('mensagem apagada leva o cartão junto', async () => {
  const { w, ana, bia, id } = await setup();
  const sent = await w.core.conversations.send(ana, id, { profileUsername: 'caio' });
  await w.core.conversations.deleteMessage(ana, id, sent.id);
  assert.equal((await cardFor(w, bia, id)).sharedProfile, null);
});
