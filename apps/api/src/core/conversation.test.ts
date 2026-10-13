import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MESSAGES_PER_MINUTE, MESSAGE_MAX } from './conversation-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

type World = ReturnType<typeof makeWorld>;

async function befriend(w: World, a: string, b: string) {
  await w.core.follows.follow(a, b);
  await w.core.follows.follow(b, a);
}

async function friends() {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await befriend(w, ana!, bia!);
  const chat = await w.core.conversations.open(ana!, bia!);
  return { w, ana: ana!, bia: bia!, caio: caio!, id: chat.id };
}

const card = { source: 'EVENT', title: 'Jazz', venueName: 'Bar do Zé', lat: -23.55, lng: -46.63, startsAt: '2026-10-13T20:00:00.000Z', endsAt: null, sample: true, externalId: 'event:1' };

test('open: só entre amigos, idempotente nos dois sentidos, nunca com bloqueado', async () => {
  const { w, ana, bia, caio, id } = await friends();
  assert.equal((await w.core.conversations.open(bia, ana)).id, id);
  assert.equal((await w.core.conversations.open(ana, bia)).id, id);
  await rejectsWith(w.core.conversations.open(ana, caio), 'FORBIDDEN');
  await rejectsWith(w.core.conversations.open(ana, ana), 'VALIDATION');
  await rejectsWith(w.core.conversations.open(ana, 'xyz'), 'FORBIDDEN');
  await rejectsWith(w.core.conversations.open(ana, undefined), 'VALIDATION');
  await w.core.blocks.block(ana, bia);
  await rejectsWith(w.core.conversations.open(bia, ana), 'NOT_FOUND');
});

test('send: texto é aparado, normaliza quebra de linha e respeita limites', async () => {
  const { w, ana, id } = await friends();
  const sent = await w.core.conversations.send(ana, id, { body: '  oi\r\ntudo bem?  ' });
  assert.equal(sent.body, 'oi\ntudo bem?');
  assert.equal(sent.mine, true);
  assert.equal(sent.kind, 'TEXT');
  assert.equal(sent.suggestion, null);
  for (const bad of ['', '   ', 'a\u0000b', 'x'.repeat(MESSAGE_MAX + 1), 42, {}]) {
    await rejectsWith(w.core.conversations.send(ana, id, { body: bad }), 'VALIDATION');
  }
  await w.core.conversations.send(ana, id, { body: 'x'.repeat(MESSAGE_MAX) });
  await rejectsWith(w.core.conversations.send(ana, id, {}), 'VALIDATION');
  await rejectsWith(w.core.conversations.send(ana, id, { body: 'a', suggestion: card }), 'VALIDATION');
});

test('send: cartão de sugestão é validado campo a campo e só os campos conhecidos passam', async () => {
  const { w, ana, id } = await friends();
  const ok = await w.core.conversations.send(ana, id, { suggestion: { ...card, intruso: 'x' } });
  assert.equal(ok.kind, 'SUGGESTION');
  assert.deepEqual(ok.suggestion, card);
  assert.equal(ok.body, 'Jazz — Bar do Zé');
  const bads: Record<string, unknown>[] = [
    { ...card, source: 'OUTRO' },
    { ...card, title: '' },
    { ...card, lat: 91 },
    { ...card, lng: 'x' },
    { ...card, startsAt: 'ontem' },
    { ...card, sample: 'sim' },
    { ...card, externalId: 'x'.repeat(81) },
  ];
  for (const bad of bads) await rejectsWith(w.core.conversations.send(ana, id, { suggestion: bad }), 'VALIDATION');
  await rejectsWith(w.core.conversations.send(ana, id, { suggestion: [] }), 'VALIDATION');
});

test('privacidade: quem não participa não vê nem envia; bloqueio esconde; deixar de ser amigo deixa só leitura', async () => {
  const { w, ana, bia, caio, id } = await friends();
  await w.core.conversations.send(ana, id, { body: 'segredo' });
  await rejectsWith(w.core.conversations.messages(caio, id), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.send(caio, id, { body: 'x' }), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.markRead(caio, id), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.messages(ana, 'nao-e-uuid'), 'NOT_FOUND');
  assert.deepEqual(await w.core.conversations.list(caio), []);

  await w.core.follows.unfollow(bia, ana);
  const view = await w.core.conversations.messages(ana, id);
  assert.equal(view.canSend, false);
  assert.equal(view.messages.length, 1, 'histórico continua legível');
  await rejectsWith(w.core.conversations.send(ana, id, { body: 'oi?' }), 'FORBIDDEN');
  assert.equal((await w.core.conversations.list(ana))[0]!.canSend, false);

  await w.core.blocks.block(bia, ana);
  await rejectsWith(w.core.conversations.messages(ana, id), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.messages(bia, id), 'NOT_FOUND');
  assert.deepEqual(await w.core.conversations.list(ana), []);
  assert.deepEqual(await w.core.conversations.list(bia), []);
  await w.core.blocks.unblock(bia, ana);
  assert.equal((await w.core.conversations.list(ana)).length, 1, 'ao desbloquear, o histórico volta');
});

test('list e messages: última mensagem, não lidas e leitura ao abrir', async () => {
  const { w, ana, bia, id } = await friends();
  w.clock.tick(1000);
  await w.core.conversations.send(ana, id, { body: 'um' });
  w.clock.tick(1000);
  await w.core.conversations.send(ana, id, { body: 'dois' });
  const [item] = await w.core.conversations.list(bia);
  assert.equal(item!.unread, 2);
  assert.equal(item!.lastMessage!.body, 'dois');
  assert.equal(item!.lastMessage!.mine, false);
  assert.equal(item!.other.username, 'ana');
  assert.equal((await w.core.conversations.list(ana))[0]!.unread, 0, 'o que você enviou não conta como não lido');

  const view = await w.core.conversations.messages(bia, id);
  assert.deepEqual(view.messages.map((m) => m.body), ['um', 'dois']);
  assert.equal(view.hasMore, false);
  assert.equal((await w.core.conversations.list(bia))[0]!.unread, 0);
  assert.equal(JSON.stringify(view).includes('passwordHash'), false);
});

test('messages: paginação para trás com before e limite', async () => {
  const { w, ana, id } = await friends();
  for (let i = 1; i <= 5; i++) {
    w.clock.tick(1000);
    await w.core.conversations.send(ana, id, { body: `m${i}` });
  }
  const first = await w.core.conversations.messages(ana, id, { limit: 2 });
  assert.deepEqual(first.messages.map((m) => m.body), ['m4', 'm5']);
  assert.equal(first.hasMore, true);
  const older = await w.core.conversations.messages(ana, id, { limit: 2, before: first.messages[0]!.createdAt });
  assert.deepEqual(older.messages.map((m) => m.body), ['m2', 'm3']);
  assert.equal(older.hasMore, true);
  const oldest = await w.core.conversations.messages(ana, id, { limit: 2, before: older.messages[0]!.createdAt });
  assert.deepEqual(oldest.messages.map((m) => m.body), ['m1']);
  assert.equal(oldest.hasMore, false);
  await rejectsWith(w.core.conversations.messages(ana, id, { limit: 0 }), 'VALIDATION');
  await rejectsWith(w.core.conversations.messages(ana, id, { before: 'ontem' }), 'VALIDATION');
});

test('send: limite de mensagens por minuto; passada a janela, libera', async () => {
  const { w, ana, id } = await friends();
  for (let i = 0; i < MESSAGES_PER_MINUTE; i++) await w.core.conversations.send(ana, id, { body: `m${i}` });
  const err = await rejectsWith(w.core.conversations.send(ana, id, { body: 'a mais' }), 'RATE_LIMITED');
  assert.ok(err.details?.retryAfterSeconds);
  w.clock.tick(61_000);
  await w.core.conversations.send(ana, id, { body: 'liberou' });
});
