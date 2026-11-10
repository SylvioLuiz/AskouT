import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeWorld } from './testing/world.ts';
import type { HomeFeedItem, PlaceEventFeedItem } from './post-service.ts';

const H = 3_600_000;

const isPlace = (i: HomeFeedItem): i is PlaceEventFeedItem => 'type' in i && i.type === 'PLACE_EVENT';

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio');
  const [ana, bia, caio] = [u['ana']!, u['bia']!, u['caio']!];
  // bia segue ana; caio não segue ninguém.
  await w.core.follows.follow(bia, ana);
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: null, category: 'bar', lat: -23.5, lng: -46.6, isSample: false });
  const now = w.clock.now().getTime();
  await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Samba', description: null, kind: 'SHOW', isFree: true, imageUrl: null, tags: [], startsAt: new Date(now + 24 * H), endsAt: new Date(now + 28 * H), isSample: false });
  return { w, ana, bia, caio };
}

test('Início: evento de bar postado por quem você segue aparece com "repostou" (só com mixed)', async () => {
  const { w, ana, bia, caio } = await setup();
  await w.core.profileEvents.post(ana, 'e1');

  assert.equal((await w.core.posts.feed(bia)).items.length, 0, 'sem a opção, só posts (apps antigos)');
  const page = await w.core.posts.feed(bia, {}, { placeEvents: true });
  assert.equal(page.items.length, 1);
  const item = page.items[0]!;
  assert.ok(isPlace(item));
  assert.equal(item.id, 'e1');
  assert.equal(item.event.title, 'Samba');
  assert.equal(item.event.venueName, 'Bar do Zé');
  assert.equal(item.repostedBy.username, 'ana');

  assert.equal((await w.core.posts.feed(caio, {}, { placeEvents: true })).items.length, 0, 'quem não segue não vê');
  const own = await w.core.posts.feed(ana, {}, { placeEvents: true });
  assert.ok(isPlace(own.items[0]!), 'quem postou também vê no próprio Início');

  await w.core.profileEvents.unpost(ana, 'e1');
  assert.equal((await w.core.posts.feed(bia, {}, { placeEvents: true })).items.length, 0, 'tirar do perfil tira do Início');
});

test('Início: o mesmo evento de bar postado por duas pessoas aparece uma vez, com o repost mais recente', async () => {
  const { w, ana, bia, caio } = await setup();
  await w.core.follows.follow(bia, caio);
  await w.core.profileEvents.post(ana, 'e1');
  w.clock.tick(H);
  await w.core.profileEvents.post(caio, 'e1');
  w.clock.tick(H);
  await w.core.posts.create(ana, { images: [`data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`], caption: 'oi' });

  const page = await w.core.posts.feed(bia, {}, { placeEvents: true });
  assert.equal(page.items.length, 2);
  assert.equal(isPlace(page.items[0]!), false, 'o post mais novo vem primeiro');
  const ev = page.items[1]!;
  assert.ok(isPlace(ev));
  assert.equal(ev.repostedBy.username, 'caio');

  // Paginação de um em um não repete nem perde.
  const ids: string[] = [];
  let offset = 0;
  for (;;) {
    const p = await w.core.posts.feed(bia, { limit: 1, offset }, { placeEvents: true });
    ids.push(...p.items.map((i) => i.id));
    offset += p.items.length;
    if (!p.hasMore) break;
  }
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
});
