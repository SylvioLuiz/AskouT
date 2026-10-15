import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const JPEG = (n = 10) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio');
  const ana = u['ana']!, bia = u['bia']!, caio = u['caio']!;
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, ana);
  await w.places.createVenue({ id: 'v1', name: 'Parque Ibirapuera', address: null, category: 'park', lat: -23.58, lng: -46.65, isSample: true });
  const event = (id: string, inH: number) =>
    w.places.createEvent({ id, venueId: 'v1', title: `Evento ${id}`, description: null, kind: 'OTHER', isFree: true, imageUrl: null, tags: [], startsAt: new Date(w.clock.now().getTime() + inH * H), endsAt: new Date(w.clock.now().getTime() + (inH + 2) * H), isSample: true });
  await event('e1', 2);
  await event('e2', 4);
  return { w, ana, bia, caio };
}

test('postar evento no perfil: aparece na lista, entra na contagem e dá para tirar', async () => {
  const { w, ana, bia } = await setup();
  assert.equal((await w.core.profiles.getByUsername(bia, 'ana')).counts.events, 0);
  assert.deepEqual(await w.core.profileEvents.post(ana, 'e1'), { posted: true });
  w.clock.tick(1000);
  await w.core.profileEvents.post(ana, 'e2');
  await w.core.profileEvents.post(ana, 'e2');
  const page = await w.core.profileEvents.list(bia, 'ana');
  assert.deepEqual(page.items.map((i) => i.id), ['e2', 'e1'], 'o mais recente primeiro');
  assert.equal(page.total, 2);
  assert.equal(page.items[0]!.venueName, 'Parque Ibirapuera');
  assert.equal(page.items[0]!.sample, true);
  assert.equal((await w.core.profiles.getByUsername(bia, 'ana')).counts.events, 2);
  assert.equal((await w.core.explore.event(ana, 'e1')).postedByMe, true);
  assert.equal((await w.core.explore.event(bia, 'e1')).postedByMe, false);
  await w.core.profileEvents.unpost(ana, 'e1');
  assert.equal((await w.core.profileEvents.list(ana, 'ana')).total, 1);
  assert.equal((await w.core.explore.event(ana, 'e1')).postedByMe, false);
  await rejectsWith(w.core.profileEvents.post(ana, 'nao-existe'), 'NOT_FOUND');
  await rejectsWith(w.core.profileEvents.post(ana, 42), 'NOT_FOUND');
  await rejectsWith(w.core.profileEvents.list(ana, 'ana', { limit: 0 }), 'VALIDATION');
  assert.equal((await w.core.profileEvents.list(ana, 'ana', { limit: 1, offset: 0 })).items.length, 1);
});

test('perfil privado e bloqueio valem também para os eventos postados', async () => {
  const { w, ana, caio, bia } = await setup();
  await w.core.profileEvents.post(ana, 'e1');
  assert.equal((await w.core.profileEvents.list(caio, 'ana')).total, 1, 'perfil público: qualquer um vê');
  await w.core.profiles.setPrivacy(ana, true);
  await rejectsWith(w.core.profileEvents.list(caio, 'ana'), 'FORBIDDEN');
  assert.equal((await w.core.profileEvents.list(bia, 'ana')).total, 1, 'quem segue com aprovação vê');
  assert.equal((await w.core.profileEvents.list(ana, 'ana')).total, 1, 'o próprio vê');
  await w.core.blocks.block(ana, bia);
  await rejectsWith(w.core.profileEvents.list(bia, 'ana'), 'NOT_FOUND');
});

test('limite de eventos postados', async () => {
  const { w, ana } = await setup();
  for (let i = 0; i < 200; i++) await w.profileEvents.add(ana, `x${i}`, w.clock.now());
  await rejectsWith(w.core.profileEvents.post(ana, 'e1'), 'CONFLICT');
  await w.profileEvents.add(ana, 'e1', w.clock.now());
  assert.deepEqual(await w.core.profileEvents.post(ana, 'e1'), { posted: true }, 'quem já postou pode repetir');
});

test('foto de perfil: valida a imagem, serve os bytes e remove', async () => {
  const { w, ana, bia } = await setup();
  const updated = await w.core.profiles.setPhoto(ana, JPEG());
  assert.match(updated.avatarUrl ?? '', new RegExp(`^/users/${ana}/avatar\\?v=\\d+$`));
  assert.equal((await w.core.profiles.getByUsername(bia, 'ana')).profile.avatarUrl, updated.avatarUrl);
  const photo = await w.core.profiles.photo(ana);
  assert.equal(photo?.mime, 'image/jpeg');
  assert.equal(photo?.data[0], 0xff);
  w.clock.tick(5000);
  const again = await w.core.profiles.setPhoto(ana, JPEG(20));
  assert.notEqual(again.avatarUrl, updated.avatarUrl, 'a versão muda para o navegador atualizar a foto');
  await rejectsWith(w.core.profiles.setPhoto(ana, 'data:image/gif;base64,AAAA'), 'VALIDATION');
  await rejectsWith(w.core.profiles.setPhoto(ana, `data:image/png;base64,${Buffer.from('não sou png').toString('base64')}`), 'VALIDATION');
  await rejectsWith(w.core.profiles.setPhoto(ana, JPEG(70_000)), 'VALIDATION');
  await rejectsWith(w.core.profiles.setPhoto(ana, 123), 'VALIDATION');
  assert.equal((await w.core.profiles.setPhoto(ana, JPEG(50_000))).avatarUrl !== null, true, '50 KB cabe');
  const removed = await w.core.profiles.setPhoto(ana, null);
  assert.equal(removed.avatarUrl, null);
  assert.equal(await w.core.profiles.photo(ana), undefined);
  assert.equal(await w.core.profiles.photo('naoexiste'), undefined);
  assert.equal(await w.core.profiles.photo(undefined), undefined);
});

test('compartilhar evento numa conversa 1 a 1 e em grupo', async () => {
  const { w, ana, bia, caio } = await setup();
  await w.core.follows.follow(ana, caio);
  await w.core.follows.follow(caio, ana);
  const { id } = await w.core.conversations.open(ana, bia);
  const sent = await w.core.conversations.send(ana, id, { eventId: 'e1' });
  assert.equal(sent.kind, 'EVENT');
  assert.equal(sent.event?.title, 'Evento e1');
  assert.equal(sent.body, 'Evento: Evento e1');
  const chat = await w.core.conversations.messages(bia, id);
  assert.equal(chat.messages[0]!.event?.venueName, 'Parque Ibirapuera');
  assert.equal(chat.messages[0]!.event?.id, 'e1');
  assert.ok((await w.core.notifications.list(bia)).items.some((n) => /compartilhou um evento/i.test(n.body)));
  assert.equal((await w.core.conversations.list(bia))[0]!.lastMessage?.kind, 'EVENT');
  await rejectsWith(w.core.conversations.send(ana, id, { eventId: 'nao-existe' }), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.send(ana, id, { eventId: 'e1', body: 'oi' }), 'VALIDATION');
  await rejectsWith(w.core.conversations.send(ana, id, {}), 'VALIDATION');
  const m = await w.core.meetups.create(ana, { eventId: 'e2', guestIds: [bia, caio] });
  await w.core.meetups.respond(bia, m.id, 'accept');
  const inGroup = await w.core.conversations.send(ana, m.conversationId, { eventId: 'e1' });
  assert.equal(inGroup.event?.id, 'e1');
});

test('lista dos meus encontros: organizados e convidados, mais recente primeiro', async () => {
  const { w, ana, bia } = await setup();
  const first = await w.core.meetups.create(ana, { eventId: 'e1', guestIds: [bia] });
  const second = await w.core.meetups.create(bia, { eventId: 'e2', guestIds: [ana] });
  const mine = await w.core.meetups.listMine(ana);
  assert.deepEqual(mine.map((x) => x.id), [second.id, first.id]);
  assert.equal(mine[0]!.myStatus, 'INVITED');
  assert.equal(mine[1]!.myStatus, 'ORGANIZER');
  assert.deepEqual(await w.core.meetups.listMine((await w.signUp('zeca')).user.id), []);
});
