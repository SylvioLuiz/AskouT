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
  const { w, ev } = await setup();
  const page = await w.core.publicReads.event('e1');
  assert.deepEqual([page.title, page.confirmedCount, page.attendees, page.owner, page.going, page.storyUserIds, page.canStory, page.postedByMe], ['Roda de Samba', 1, [], null, false, [], false, false]);
  await rejectsWith(w.core.publicReads.event(ev.id), 'NOT_FOUND');
  await rejectsWith(w.core.publicReads.event('nao-existe'), 'NOT_FOUND');
});

test('visitante: página do local sem frequentadores, amigos nem papel', async () => {
  const { w } = await setup();
  w.clock.tick(3 * H);
  const page = await w.core.publicReads.venue('v1');
  assert.deepEqual([page.name, page.followerCount, page.following, page.canManage, page.role, page.regulars, page.friendsWent], ['Bar do Samba', 1, false, false, null, [], { count: 0, sample: [] }]);
  assert.equal(page.rating.mine, null);
});
