import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEETUP_MAX_GUESTS, MEETUPS_PER_HOUR } from './meetup-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;

async function setup(names: string[] = ['ana', 'bia', 'caio', 'dani']) {
  const w = makeWorld();
  const users = await w.signUpMany(...names);
  const ana = users['ana']!;
  for (const n of names.slice(1)) {
    const id = users[n]!;
    await w.core.follows.follow(ana, id);
    await w.core.follows.follow(id, ana);
  }
  await w.places.createVenue({ id: 'v1', name: 'Parque Ibirapuera', address: 'Av. Pedro Álvares Cabral', category: 'park', lat: -23.58, lng: -46.65, isSample: true });
  const event = (id: string, inH: number, lenH = 3) =>
    w.places.createEvent({ id, venueId: 'v1', title: `Evento ${id}`, description: null, kind: 'OTHER', isFree: true, imageUrl: null, tags: [], startsAt: new Date(w.clock.now().getTime() + inH * H), endsAt: new Date(w.clock.now().getTime() + (inH + lenH) * H), isSample: true });
  await event('e1', 2);
  return { w, users, ana, event };
}

test('um convidado: o encontro vive na conversa 1 a 1 e não cria grupo', async () => {
  const { w, users, ana } = await setup();
  const bia = users['bia']!;
  const view = await w.core.meetups.create(ana, { eventId: 'e1', guestIds: [bia] });
  assert.equal(view.isGroup, false);
  assert.equal(view.groupName, null);
  assert.equal(view.title, 'Evento e1');
  assert.equal(view.event?.venueName, 'Parque Ibirapuera');
  assert.equal(view.myStatus, 'ORGANIZER');
  assert.equal(view.confirmedCount, 1);
  assert.equal(view.invitedCount, 1);

  assert.equal((await w.core.conversations.list(bia))[0]!.unread, 1);
  const chat = await w.core.conversations.messages(bia, view.conversationId);
  assert.equal(chat.type, 'DIRECT');
  const card = chat.messages.find((m) => m.kind === 'MEETUP');
  assert.equal(card?.meetup?.id, view.id);
  assert.equal(card?.meetup?.myStatus, 'INVITED');

  const accepted = await w.core.meetups.respond(bia, view.id, 'accept');
  assert.equal(accepted.myStatus, 'CONFIRMED');
  assert.equal(accepted.confirmedCount, 2);
  await rejectsWith(w.core.meetups.respond(bia, view.id, 'decline'), 'CONFLICT');
  await rejectsWith(w.core.meetups.respond(ana, view.id, 'accept'), 'FORBIDDEN');
});

test('vários convidados: cria o grupo e cada um só entra ao aceitar', async () => {
  const { w, users, ana } = await setup();
  const [bia, caio, dani] = [users['bia']!, users['caio']!, users['dani']!];
  const view = await w.core.meetups.create(ana, { eventId: 'e1', guestIds: [bia, caio, dani, bia], name: 'Grupo da fofoca' });
  assert.equal(view.isGroup, true);
  assert.equal(view.groupName, 'Grupo da fofoca');
  assert.equal(view.invitedCount, 3, 'convidado repetido conta uma vez');

  // Quem organiza vê o grupo com o cartão e só ele como membro.
  const group = await w.core.conversations.group(ana, view.conversationId);
  assert.equal(group.name, 'Grupo da fofoca');
  assert.deepEqual(group.members.map((m) => [m.profile.username, m.role]), [['ana', 'OWNER']]);
  assert.equal(group.meetups.length, 1);
  assert.equal(group.mediaAvailable, false);

  // Os convidados ainda não estão no grupo: não o veem nem leem.
  await rejectsWith(w.core.conversations.messages(bia, view.conversationId), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.group(bia, view.conversationId), 'NOT_FOUND');
  assert.equal((await w.core.conversations.list(bia)).some((c) => c.type === 'GROUP'), false);
  // O convite chega na conversa 1 a 1 com quem organizou.
  const direct = (await w.core.conversations.list(bia))[0]!;
  assert.equal(direct.type, 'DIRECT');
  assert.equal(direct.lastMessage?.kind, 'MEETUP');
  assert.equal(direct.lastMessage?.body, 'Encontro: Evento e1');

  await w.core.meetups.respond(bia, view.id, 'accept');
  await w.core.meetups.respond(caio, view.id, 'decline');
  const afterAna = await w.core.conversations.group(ana, view.conversationId);
  assert.deepEqual(afterAna.members.map((m) => m.profile.username), ['ana', 'bia']);
  assert.equal(afterAna.meetups[0]!.confirmedCount, 2);
  assert.equal(afterAna.meetups[0]!.declinedCount, 1);
  assert.equal(afterAna.meetups[0]!.invitedCount, 1);
  await rejectsWith(w.core.conversations.group(caio, view.conversationId), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.group(dani, view.conversationId), 'NOT_FOUND');

  // Bia agora vê o grupo, o cartão do encontro e conversa lá.
  const list = await w.core.conversations.list(bia);
  const groupItem = list.find((c) => c.type === 'GROUP')!;
  assert.equal(groupItem.name, 'Grupo da fofoca');
  assert.equal(groupItem.other, null);
  assert.equal(groupItem.memberCount, 2);
  const sent = await w.core.conversations.send(bia, view.conversationId, { body: 'oi gente' });
  assert.equal(sent.senderName, 'bia');
  const chat = await w.core.conversations.messages(ana, view.conversationId);
  assert.equal(chat.type, 'GROUP');
  assert.equal(chat.other, null);
  assert.equal(chat.canSend, true);
  assert.deepEqual(chat.messages.map((m) => [m.kind, m.senderName]), [['MEETUP', 'ana'], ['TEXT', 'bia']]);
  assert.equal(chat.messages[0]!.meetup?.myStatus, 'ORGANIZER');
  await rejectsWith(w.core.conversations.send(bia, view.conversationId, { suggestion: {} }), 'VALIDATION');
  // Quem recusou não entra mesmo tentando de novo.
  await rejectsWith(w.core.meetups.respond(caio, view.id, 'accept'), 'CONFLICT');
  await rejectsWith(w.core.conversations.send(caio, view.conversationId, { body: 'x' }), 'NOT_FOUND');
});

test('o nome do grupo padrão é o título do evento; quem não é do encontro não o vê', async () => {
  const { w, users, ana } = await setup();
  const view = await w.core.meetups.create(ana, { eventId: 'e1', guestIds: [users['bia']!, users['caio']!] });
  assert.equal(view.groupName, 'Evento e1');
  await rejectsWith(w.core.meetups.get(users['dani']!, view.id), 'NOT_FOUND');
  assert.equal((await w.core.meetups.get(users['caio']!, view.id)).myStatus, 'INVITED');
  await rejectsWith(w.core.meetups.get(ana, 'nao-existe'), 'NOT_FOUND');
});

test('validações da criação', async () => {
  const { w, users, ana, event } = await setup();
  const bia = users['bia']!;
  await rejectsWith(w.core.meetups.create(ana, {}), 'VALIDATION');
  await rejectsWith(w.core.meetups.create(ana, { eventId: 'e1' }), 'VALIDATION');
  await rejectsWith(w.core.meetups.create(ana, { eventId: 'e1', guestIds: [] }), 'VALIDATION');
  await rejectsWith(w.core.meetups.create(ana, { eventId: 'e1', guestIds: [ana] }), 'VALIDATION');
  await rejectsWith(w.core.meetups.create(ana, { eventId: 'e1', guestIds: [42] }), 'VALIDATION');
  await rejectsWith(w.core.meetups.create(ana, { eventId: 'e1', guestIds: [bia], name: 'x'.repeat(61) }), 'VALIDATION');
  await rejectsWith(w.core.meetups.create(ana, { eventId: 'e1', guestIds: Array.from({ length: MEETUP_MAX_GUESTS + 1 }, (_, i) => `u${i}`) }), 'VALIDATION');
  await rejectsWith(w.core.meetups.create(ana, { eventId: 'nao-existe', guestIds: [bia] }), 'NOT_FOUND');
  await event('velho', -6);
  await rejectsWith(w.core.meetups.create(ana, { eventId: 'velho', guestIds: [bia] }), 'VALIDATION');
  // Não amigo e bloqueado.
  const stranger = (await w.signUpMany('eva'))['eva']!;
  await rejectsWith(w.core.meetups.create(ana, { eventId: 'e1', guestIds: [stranger] }), 'FORBIDDEN');
  await w.core.blocks.block(bia, ana);
  await rejectsWith(w.core.meetups.create(ana, { eventId: 'e1', guestIds: [bia] }), 'NOT_FOUND');
});

test('limite de encontros por hora', async () => {
  const { w, users, ana } = await setup();
  for (let i = 0; i < MEETUPS_PER_HOUR; i += 1) await w.core.meetups.create(ana, { eventId: 'e1', guestIds: [users['bia']!] });
  await rejectsWith(w.core.meetups.create(ana, { eventId: 'e1', guestIds: [users['bia']!] }), 'RATE_LIMITED');
});

test('não responde a encontro que já aconteceu nem de quem bloqueou', async () => {
  const { w, users, ana } = await setup();
  const [bia, caio] = [users['bia']!, users['caio']!];
  const one = await w.core.meetups.create(ana, { eventId: 'e1', guestIds: [bia] });
  const two = await w.core.meetups.create(ana, { eventId: 'e1', guestIds: [caio] });
  await w.core.blocks.block(caio, ana);
  await rejectsWith(w.core.meetups.respond(caio, two.id, 'accept'), 'NOT_FOUND');
  w.clock.tick(10 * H);
  await rejectsWith(w.core.meetups.respond(bia, one.id, 'accept'), 'CONFLICT');
  await rejectsWith(w.core.meetups.respond(bia, one.id, 'talvez'), 'VALIDATION');
});
