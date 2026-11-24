import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';
import { ONLINE_WINDOW_MS } from './presence-service.ts';

type World = ReturnType<typeof makeWorld>;

async function befriend(w: World, a: string, b: string) {
  await w.core.follows.follow(a, b);
  await w.core.follows.follow(b, a);
}

test('online: amigo com o app aberto aparece; some depois do tempo sem sinal ou ao sair', async () => {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await befriend(w, ana!, bia!);

  assert.deepEqual(await w.core.presence.heartbeat(ana!), [], 'ninguém mais online; nunca inclui a própria pessoa');
  await w.core.presence.heartbeat(bia!);
  await w.core.presence.heartbeat(caio!);
  assert.deepEqual(await w.core.presence.heartbeat(ana!), [bia], 'só a amiga; quem não é amigo nem conversa não aparece');

  w.clock.tick(ONLINE_WINDOW_MS + 1000);
  assert.deepEqual(await w.core.presence.heartbeat(ana!), [], 'sem sinal do app, sai do online');

  await w.core.presence.heartbeat(bia!);
  w.core.presence.leave(bia!);
  assert.deepEqual(await w.core.presence.heartbeat(ana!), []);
});

test('online: conversa 1 a 1 liberada mostra; solicitação pendente e bloqueio não', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await w.core.follows.follow(ana!, bia!);
  const opened = await w.core.conversations.open(ana!, bia!);
  await w.core.conversations.send(ana!, opened.id, { body: 'oi' });
  await w.core.presence.heartbeat(ana!);
  await w.core.presence.heartbeat(bia!);
  assert.deepEqual(await w.core.presence.heartbeat(ana!), [], 'solicitação ainda não aceita');

  await w.core.conversations.acceptRequest(bia!, opened.id);
  assert.deepEqual(await w.core.presence.heartbeat(ana!), [bia]);
  assert.deepEqual(await w.core.presence.heartbeat(bia!), [ana]);

  await w.core.blocks.block(bia!, ana!);
  assert.deepEqual(await w.core.presence.heartbeat(ana!), []);
});

test('online: quem esconde a bolinha some para os outros e também não vê a deles', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await befriend(w, ana!, bia!);
  assert.deepEqual(await w.core.presence.settings(bia!), { showOnline: true });
  await rejectsWith(w.core.presence.setSettings(bia!, { showOnline: 'não' }), 'VALIDATION');
  assert.deepEqual(await w.core.presence.setSettings(bia!, { showOnline: false }), { showOnline: false });

  await w.core.presence.heartbeat(bia!);
  assert.deepEqual(await w.core.presence.heartbeat(ana!), []);
  assert.deepEqual(await w.core.presence.heartbeat(bia!), [], 'escondida, não vê a amiga online');

  await w.core.presence.setSettings(bia!, { showOnline: true });
  assert.deepEqual(await w.core.presence.heartbeat(ana!), [bia]);
});
