import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'dani');
  const ana = u['ana']!, bia = u['bia']!, caio = u['caio']!, dani = u['dani']!;
  for (const other of [bia, caio]) {
    await w.core.follows.follow(ana, other);
    await w.core.follows.follow(other, ana);
  }
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A', category: 'bar', lat: -23.58, lng: -46.65, isSample: true });
  const t0 = w.clock.now().getTime();
  const event = (id: string, inH: number, lenH = 3) =>
    w.places.createEvent({ id, venueId: 'v1', title: `Evento ${id}`, description: null, kind: 'NIGHT', isFree: true, imageUrl: null, tags: [], startsAt: new Date(t0 + inH * H), endsAt: new Date(t0 + (inH + lenH) * H), isSample: true });
  await event('e1', 2);
  await event('e2', 26);
  await event('e3', 50);
  return { w, ana, bia, caio, dani };
}

test('widgets: agenda pessoal por início, encontro confirmado esconde o "Eu vou" do mesmo evento', async () => {
  const { w, ana, bia } = await setup();
  await w.core.eventPages.go(ana, 'e3');
  await w.core.eventPages.go(ana, 'e1');
  const meetup = await w.core.meetups.create(ana, { eventId: 'e1', guestIds: [bia] });
  // Convite que bia ainda não aceitou não entra na agenda dela.
  const pending = await w.core.meetups.create(ana, { eventId: 'e2', guestIds: [bia] });

  const mine = await w.core.widgets.snapshot(ana);
  assert.deepEqual(mine.plans.map((p) => p.key), [`m:${meetup.id}`, `m:${pending.id}`, 'e:e3']);
  const [first] = mine.plans;
  assert.equal(first?.kind, 'MEETUP');
  assert.equal(first?.venueName, 'Bar do Zé');
  assert.equal(first?.url, `/conversas/${meetup.conversationId}`);
  assert.equal(first?.people, 1);
  assert.equal(mine.plans[2]?.url, '/eventos/e3');

  assert.deepEqual((await w.core.widgets.snapshot(bia)).plans, [], 'convite sem resposta não é plano');
  await w.core.meetups.respond(bia, meetup.id, 'accept');
  assert.deepEqual((await w.core.widgets.snapshot(bia)).plans.map((p) => p.key), [`m:${meetup.id}`]);

  w.clock.tick(6 * H);
  assert.equal((await w.core.widgets.snapshot(ana)).plans[0]?.key, `m:${pending.id}`, 'o que acabou sai');
});

test('widgets: encontro do NOW em andamento, amigos com NOW ligado e convites esperando', async () => {
  const { w, ana, bia, caio, dani } = await setup();
  const empty = await w.core.widgets.snapshot(ana);
  assert.deepEqual([empty.flash.on, empty.friendsOnNow.count, empty.matches.length, empty.pendingInvites], [false, 0, 0, 0]);

  await w.core.flash.turnOn(ana, { hours: 2 });
  await w.core.flash.turnOn(bia, { hours: 2 });
  await w.core.flash.turnOn(caio, { hours: 1 });
  await w.core.flash.turnOn(dani, { hours: 1 });
  const on = await w.core.widgets.snapshot(ana);
  assert.equal(on.flash.on, true);
  assert.ok(on.flash.expiresAt);
  assert.equal(on.friendsOnNow.count, 2, 'só amigos; quem não é amigo (dani) não aparece');
  assert.deepEqual(on.friendsOnNow.people.map((p) => p.username).sort(), ['bia', 'caio']);

  const fromCaio = await w.core.flash.invite(caio, ana);
  assert.equal((await w.core.widgets.snapshot(ana)).pendingInvites, 1);
  await w.core.flash.respond(ana, fromCaio.id, 'decline');

  const invite = await w.core.flash.invite(ana, bia);
  await w.core.flash.respond(bia, invite.id, 'accept');
  const matched = await w.core.widgets.snapshot(ana);
  assert.equal(matched.matches.length, 1);
  assert.equal(matched.matches[0]?.url, `/now/encontro/${invite.id}`);
  assert.equal(matched.matches[0]?.placeName, null);
  await w.core.flash.chooseDestination(bia, invite.id, { name: 'Bar do Zé', lat: -23.58, lng: -46.65 });
  assert.equal((await w.core.widgets.snapshot(ana)).matches[0]?.placeName, 'Bar do Zé');
  assert.equal(JSON.stringify(matched).includes('"lat"'), false, 'nunca leva posição');
});

const WEBM_VOICE = `data:audio/webm;codecs=opus;base64,${Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...new Array(40).fill(7)]).toString('base64')}`;

/** Ana é amiga de Bia e Caio; grupo "Turma" com os três; Dani só segue a Ana (escreve como solicitação). */
async function chatsWorld() {
  const { w, ana, bia, caio, dani } = await setup();
  await w.core.follows.follow(dani, ana);
  const withBia = (await w.core.conversations.open(ana, bia)).id;
  const withCaio = (await w.core.conversations.open(ana, caio)).id;
  const group = (await w.core.conversations.createGroup(ana, { name: 'Turma', memberIds: [bia, caio] })).id;
  return { w, ana, bia, caio, dani, withBia, withCaio, group };
}

test('widget de conversas: só grupos, só individuais ou tudo, na ordem da lista e com prévia pronta', async () => {
  const { w, ana, bia, caio, withBia, withCaio, group } = await chatsWorld();
  await w.core.conversations.send(bia, withBia, { body: 'bora   hoje?' });
  w.clock.tick(60_000);
  await w.core.conversations.send(caio, group, { audio: WEBM_VOICE, audioMs: 12_400 });
  w.clock.tick(60_000);
  await w.core.conversations.send(ana, withCaio, { profileUsername: 'bia' });

  const all = await w.core.widgets.chats(ana);
  assert.equal(all.show, 'all');
  assert.deepEqual(all.chats.map((c) => c.id), [withCaio, group, withBia], 'a mais recente primeiro');
  const [caioRow, groupRow, biaRow] = all.chats;
  assert.equal(caioRow?.preview, 'Você: Perfil compartilhado', 'não revela de quem é o perfil');
  assert.equal(groupRow?.title, 'Turma');
  assert.equal(groupRow?.type, 'GROUP');
  assert.equal(groupRow?.preview, 'caio: Mensagem de voz (0:12)', 'no grupo, quem escreveu');
  assert.equal(groupRow?.initials, 'T');
  assert.equal(biaRow?.preview, 'bora hoje?');
  assert.equal(biaRow?.unread, 1);
  assert.equal(biaRow?.url, `/conversas/${withBia}`);
  assert.ok(biaRow?.at);
  assert.equal(all.unreadChats, 2, 'a conversa com a Bia e o grupo');

  const groups = await w.core.widgets.chats(ana, 'group');
  assert.deepEqual(groups.chats.map((c) => c.id), [group]);
  assert.equal(groups.unreadChats, 1);
  const direct = await w.core.widgets.chats(ana, 'direct');
  assert.deepEqual(direct.chats.map((c) => c.id), [withCaio, withBia]);
  assert.equal(direct.unreadChats, 1);
  assert.equal((await w.core.widgets.chats(ana, 'qualquer')).show, 'all', 'valor estranho vira "tudo"');

  // Abrir a conversa zera o número.
  await w.core.conversations.messages(ana, withBia);
  assert.equal((await w.core.widgets.chats(ana, 'direct')).unreadChats, 0);
});

test('widget de conversas: bloqueio some, solicitação pendente fica de fora e silenciada não conta no total', async () => {
  const { w, ana, bia, dani, withBia, group } = await chatsWorld();
  w.clock.tick(60_000);
  await w.core.conversations.send(bia, withBia, { body: 'oi' });
  await w.core.conversations.send(bia, group, { body: 'segredo do grupo' });
  const fromDani = (await w.core.conversations.open(dani, ana)).id;
  await w.core.conversations.send(dani, fromDani, { body: 'me aceita?' });

  const before = await w.core.widgets.chats(ana);
  assert.equal(before.chats.some((c) => c.id === fromDani), false, 'solicitação não é conversa normal');
  assert.equal(JSON.stringify(before).includes('me aceita?'), false);

  await w.core.conversations.setPreferences(ana, group, { muted: true });
  const muted = await w.core.widgets.chats(ana, 'group');
  assert.equal(muted.chats[0]?.muted, true);
  assert.equal(muted.chats[0]?.unread, 1, 'a linha mostra o número (apagado)');
  assert.equal(muted.unreadChats, 0, 'silenciada não entra no total');

  await w.core.blocks.block(ana, bia);
  const after = await w.core.widgets.chats(ana);
  assert.equal(after.chats.some((c) => c.id === withBia), false, 'conversa com quem foi bloqueado some');
  const groupRow = after.chats.find((c) => c.id === group);
  assert.equal(JSON.stringify(after).includes('bia'), false, 'nem o nome de quem foi bloqueado');
  assert.notEqual(groupRow?.preview, 'bia: segredo do grupo');

  // E quem bloqueou também some para o outro lado.
  assert.equal((await w.core.widgets.chats(bia, 'direct')).chats.some((c) => c.id === withBia), false);
});
