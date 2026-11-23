import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const HERE = { lat: -23.5505, lng: -46.6333 };
const JPEG = (n = 10) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]).toString('base64')}`;
const ARENA = { externalId: 'ChIJArena', source: 'GOOGLE' as const, name: 'Arena das Palmeiras', category: 'stadium', lat: -23.5275, lng: -46.6784, address: 'Av. Francisco Matarazzo, 1705 - Água Branca, São Paulo - SP' };

test('vincular um rolê acha pelo nome ou endereço no Google, mesmo longe e fora dos tipos de bar', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  await w.places.createVenue({ id: 'v-ze', name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: HERE.lat, lng: HERE.lng, isSample: false });
  w.placeSource.searchable = [ARENA];
  const byName = await w.core.explore.searchPlaces(ana!, { q: 'arena', lat: HERE.lat, lng: HERE.lng });
  assert.equal(byName.placesAvailable, true);
  assert.deepEqual(byName.places.map((p) => [p.key, p.address]), [['google:ChIJArena', ARENA.address]]);
  assert.ok((byName.places[0]!.distanceM ?? 0) > 1000);
  const byAddress = await w.core.explore.searchPlaces(ana!, { q: 'Matarazzo' });
  assert.equal(byAddress.places[0]?.name, 'Arena das Palmeiras');
  assert.equal(byAddress.places[0]?.distanceM, null);
  // Os locais do AskouT vêm primeiro e não se repetem com o Google.
  w.placeSource.searchable = [{ ...ARENA, externalId: 'ChIJZe', name: 'Bar do Zé' }];
  const ze = await w.core.explore.searchPlaces(ana!, { q: 'bar do z' });
  assert.deepEqual(ze.places.map((p) => p.key), ['askout:v-ze']);
  await rejectsWith(w.core.explore.searchPlaces(ana!, { q: 'a' }), 'VALIDATION');
});

test('o lugar do Google vira local do AskouT e fica vinculado ao evento', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  w.placeSource.searchable = [ARENA];
  // A busca de perto não traz o lugar (não é bar): a confirmação vem pelo id.
  const { venueId } = await w.core.venues.openExternal({ key: 'google:ChIJArena', lat: HERE.lat, lng: HERE.lng });
  const venue = await w.places.findVenue(venueId);
  assert.equal(venue?.name, 'Arena das Palmeiras');
  assert.equal(venue?.address, ARENA.address);
  // Abrir de novo não cria outro.
  assert.equal((await w.core.venues.openExternal({ key: 'google:ChIJArena', lat: 0, lng: 0 })).venueId, venueId);

  const startsAt = new Date(w.clock.now().getTime() + 86_400_000).toISOString();
  const post = await w.core.posts.create(ana!, { images: [JPEG()], placeVenueId: venueId, event: { title: 'Show', startsAt } });
  assert.equal(post.placeName, 'Arena das Palmeiras');
  assert.equal(post.placeAddress, ARENA.address);
  assert.equal(post.placeVenueId, venueId);
  const page = await w.core.eventPages.get(ana!, post.id);
  assert.equal(page.venue.id, venueId);
  assert.equal(page.venue.lat, ARENA.lat);

  // Trocar só o nome desvincula; id desconhecido não vincula nem quebra.
  const renamed = await w.core.posts.update(ana!, post.id, { placeName: 'Outro lugar' });
  assert.equal(renamed.placeVenueId, null);
  const other = await w.core.posts.create(ana!, { images: [JPEG()], placeName: 'Casa da Ana', placeVenueId: '00000000-0000-0000-0000-000000000000' });
  assert.equal(other.placeName, 'Casa da Ana');
  assert.equal(other.placeVenueId, null);
});

test('a busca por nome só gasta o Google quando a pessoa pede, com 3 letras ou mais', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  w.placeSource.searchable = [ARENA];
  w.placeSource.premiumSearch = true;
  const free = await w.core.explore.searchPlaces(ana!, { q: 'arena' });
  assert.equal(w.placeSource.premiumCalls, 0);
  assert.equal(free.canSearchGoogle, true);
  const paid = await w.core.explore.searchPlaces(ana!, { q: 'arena', google: 'true' });
  assert.equal(w.placeSource.premiumCalls, 1);
  assert.equal(paid.canSearchGoogle, false);
  const short = await w.core.explore.searchPlaces(ana!, { q: 'ar', google: 'true' });
  assert.equal(w.placeSource.premiumCalls, 1);
  assert.equal(short.canSearchGoogle, false);
});
