import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const HERE = { lat: -23.58, lng: -46.65 };
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'samba');
  const ana = u['ana']!, bia = u['bia']!;
  await w.places.createVenue({ id: 'v1', name: 'Bar do Samba', address: 'Rua A, 1', category: 'bar', lat: HERE.lat, lng: HERE.lng, isSample: false });
  await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Roda de Samba', description: null, kind: 'SHOW', isFree: true, imageUrl: null, tags: ['samba'], startsAt: new Date(w.clock.now().getTime() + 2 * H), endsAt: new Date(w.clock.now().getTime() + 4 * H), isSample: false });
  const start = new Date(w.clock.now().getTime() + 3 * H).toISOString();
  const ev = await w.core.posts.create(ana, { images: [JPEG], caption: 'Samba em casa', placeName: 'Bar do Samba', placeVenueId: 'v1', event: { title: 'Samba na casa da Ana', startsAt: start, kind: 'SHOW' } });
  await w.core.venues.follow(bia, 'v1');
  await w.core.eventPages.go(bia, 'e1');
  return { w, ana, bia, ev };
}

test('visitante: Explorar traz só eventos de local, sem pessoas nem eventos criados por pessoas', async () => {
  const { w, bia, ev } = await setup();
  assert.ok((await w.core.explore.search(bia, { lat: HERE.lat, lng: HERE.lng })).events.some((e) => e.id === ev.id), 'com conta, o evento da pessoa aparece');
  const near = await w.core.publicReads.search({ lat: HERE.lat, lng: HERE.lng });
  assert.deepEqual(near.events.map((e) => e.id), ['e1']);
  assert.ok(near.events.every((e) => !e.author));
  const text = await w.core.publicReads.search({ q: 'samba' });
  assert.deepEqual(text.people, [], 'a busca por texto não mostra perfis');
  assert.deepEqual(text.events.map((e) => e.id), ['e1']);
  assert.deepEqual(text.places.map((p) => [p.name, p.venue?.following, p.venue?.followerCount]), [['Bar do Samba', false, 1]]);
});

test('visitante: página do evento de local sem ninguém, só o número de confirmados', async () => {
  const { w } = await setup();
  const page = await w.core.publicReads.event('e1');
  assert.deepEqual([page.title, page.confirmedCount, page.attendees, page.owner, page.going, page.storyUserIds, page.canStory, page.postedByMe], ['Roda de Samba', 1, [], null, false, [], false, false]);
  await rejectsWith(w.core.publicReads.event('nao-existe'), 'NOT_FOUND');
});

test('visitante: evento público de pessoa abre na visão reduzida, com o dono (perfil público) e sem quem vai', async () => {
  const { w, ana, bia, ev } = await setup();
  await w.core.eventPages.go(bia, ev.id);
  const page = await w.core.publicReads.event(ev.id);
  assert.deepEqual(
    [page.source, page.title, page.isPrivate, page.confirmedCount, page.attendees, page.owner?.username, page.isOwner, page.going, page.storyUserIds, page.canStory, page.postedByMe, page.datePollId, page.group, page.canCreateGroup],
    ['USER', 'Samba na casa da Ana', false, 2, [], 'ana', false, false, [], false, false, null, null, false],
  );
  assert.equal(page.venue.id, 'v1', 'o rolê ligado a um local leva para a página do local');
  // O dono com presença gravada (escolheu a aba do perfil) não conta duas vezes.
  await w.core.eventPages.setGoingOnProfile(ana, ev.id, false);
  assert.equal((await w.core.publicReads.event(ev.id)).confirmedCount, 2);
});

test('visitante: evento de pessoa não abre se privado, arquivado, de perfil privado ou de conta suspensa', async () => {
  const { w, ana } = await setup();
  const start = new Date(w.clock.now().getTime() + 3 * H).toISOString();
  const secreto = await w.core.posts.create(ana, { images: [JPEG], placeName: 'Casa', event: { title: 'Festa secreta', startsAt: start, private: true } });
  await rejectsWith(w.core.publicReads.event(secreto.id), 'NOT_FOUND');

  const arquivado = await w.core.posts.create(ana, { images: [JPEG], placeName: 'Casa', event: { title: 'Velho', startsAt: start } });
  await w.core.posts.archive(ana, arquivado.id);
  await rejectsWith(w.core.publicReads.event(arquivado.id), 'NOT_FOUND');

  // Post comum (sem evento) não vira página de evento.
  const comum = await w.core.posts.create(ana, { images: [JPEG], caption: 'oi', placeName: 'Casa' });
  await rejectsWith(w.core.publicReads.event(comum.id), 'NOT_FOUND');

  const aberto = await w.core.posts.create(ana, { images: [JPEG], placeName: 'Casa', event: { title: 'Aberto', startsAt: start } });
  await w.core.publicReads.event(aberto.id);
  await w.core.profiles.setPrivacy(ana, true);
  await rejectsWith(w.core.publicReads.event(aberto.id), 'NOT_FOUND');
  await w.core.profiles.setPrivacy(ana, false);
  w.users.users.set(ana, { ...w.users.users.get(ana)!, status: 'SUSPENDED' });
  await rejectsWith(w.core.publicReads.event(aberto.id), 'NOT_FOUND');

});

test('visitante: página do local sem frequentadores, amigos nem papel', async () => {
  const { w } = await setup();
  w.clock.tick(3 * H);
  const page = await w.core.publicReads.venue('v1');
  assert.deepEqual([page.name, page.followerCount, page.following, page.canManage, page.role, page.regulars, page.friendsWent], ['Bar do Samba', 1, false, false, null, [], { count: 0, sample: [] }]);
  assert.equal(page.rating.mine, null);
});
