import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EventKind } from './types.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const HERE = { lat: -23.5505, lng: -46.6333 };
const H = 3_600_000;

type World = ReturnType<typeof makeWorld>;

async function seed(w: World) {
  const near = { id: 'v-near', name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: HERE.lat + 0.005, lng: HERE.lng, isSample: true };
  const far = { id: 'v-far', name: 'Casa Distante', address: null, category: 'club', lat: HERE.lat - 0.2, lng: HERE.lng, isSample: false };
  await w.places.createVenue(near);
  await w.places.createVenue(far);
  const ev = (id: string, venueId: string, title: string, inH: number, kind: EventKind, isFree: boolean, tags: string[]) =>
    w.places.createEvent({ id, venueId, title, description: null, kind, isFree, imageUrl: null, tags, startsAt: new Date(w.clock.now().getTime() + inH * H), endsAt: new Date(w.clock.now().getTime() + (inH + 2) * H), isSample: true });
  await ev('e1', 'v-near', 'Samba de Raiz', 2, 'SHOW', true, ['samba']);
  await ev('e2', 'v-near', 'Cinema ao Ar Livre', 30, 'CINEMA', false, ['filme']);
  await ev('e3', 'v-far', 'Rock na Estrada', 3, 'SHOW', false, ['rock']);
}

test('sem texto devolve os eventos perto, mais cedo primeiro, com distância', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  await seed(w);
  const v = await w.core.explore.search(ana!, { lat: HERE.lat, lng: HERE.lng });
  assert.equal(v.mode, 'NEARBY');
  assert.equal(v.located, true);
  assert.deepEqual(v.events.map((e) => e.id), ['e1', 'e2']);
  assert.ok((v.events[0]!.distanceM ?? 0) > 400);
  assert.equal(v.events[0]!.sample, true);
  const wide = await w.core.explore.search(ana!, { lat: HERE.lat, lng: HERE.lng, radiusKm: 50 });
  assert.deepEqual(wide.events.map((e) => e.id), ['e1', 'e3', 'e2']);
  const noPos = await w.core.explore.search(ana!, {});
  assert.equal(noPos.located, false);
  assert.equal(noPos.events.length, 3);
  assert.equal(noPos.events[0]!.distanceM, null);
});

test('filtros de tipo, grátis e período', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  await seed(w);
  const pos = { lat: HERE.lat, lng: HERE.lng, radiusKm: 50 };
  assert.deepEqual((await w.core.explore.search(ana!, { ...pos, kind: 'SHOW' })).events.map((e) => e.id), ['e1', 'e3']);
  assert.deepEqual((await w.core.explore.search(ana!, { ...pos, free: 'true' })).events.map((e) => e.id), ['e1']);
  const to = new Date(w.clock.now().getTime() + 12 * H).toISOString();
  assert.deepEqual((await w.core.explore.search(ana!, { ...pos, to })).events.map((e) => e.id), ['e1', 'e3']);
});

test('busca por # acha eventos e sugere hashtags; por texto acha eventos, locais e pessoas', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana', 'samuel');
  await seed(w);
  const tag = await w.core.explore.search(ana!, { q: '#Sam', radiusKm: 50, lat: HERE.lat, lng: HERE.lng });
  assert.equal(tag.mode, 'TAG');
  assert.deepEqual(tag.events.map((e) => e.id), ['e1']);
  assert.deepEqual(tag.tags, [{ tag: 'samba', count: 1 }]);
  const text = await w.core.explore.search(ana!, { q: 'sam', lat: HERE.lat, lng: HERE.lng });
  assert.equal(text.mode, 'SEARCH');
  assert.deepEqual(text.events.map((e) => e.id), ['e1']);
  assert.ok(text.people.some((p) => p.username === 'samuel'));
  const bar = await w.core.explore.search(ana!, { q: 'ze', lat: HERE.lat, lng: HERE.lng });
  assert.deepEqual(bar.places.map((p) => [p.source, p.name]), [['ASKOUT', 'Bar do Zé']]);
});

test('lugares externos entram só com posição, sem repetir os do AskouT, e respeitam fonte indisponível', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  await seed(w);
  w.placeSource.places = [
    { externalId: 'g1', source: 'GOOGLE', name: 'Bar do Zé', category: 'bar', lat: HERE.lat + 0.005, lng: HERE.lng },
    { externalId: 'g2', source: 'GOOGLE', name: 'Bar Central', category: 'bar', lat: HERE.lat + 0.01, lng: HERE.lng, rating: 4.5, ratingCount: 120 },
    { externalId: 'o1', source: 'OSM', name: 'Padaria', category: 'bakery', lat: HERE.lat, lng: HERE.lng },
  ];
  const v = await w.core.explore.search(ana!, { q: 'bar', lat: HERE.lat, lng: HERE.lng });
  assert.deepEqual(v.places.map((p) => [p.source, p.name]), [['ASKOUT', 'Bar do Zé'], ['GOOGLE', 'Bar Central']]);
  assert.equal(v.places[1]!.rating, 4.5);
  const calls = w.placeSource.calls;
  await w.core.explore.search(ana!, { q: 'bar' });
  assert.equal(w.placeSource.calls, calls, 'sem posição não consulta a fonte externa');
  await w.core.explore.search(ana!, { q: 'bar', lat: HERE.lat, lng: HERE.lng, kind: 'SHOW' });
  assert.equal(w.placeSource.calls, calls, 'com filtro de tipo não mostra lugares');
  w.placeSource.available = false;
  const off = await w.core.explore.search(ana!, { q: 'bar', lat: HERE.lat, lng: HERE.lng });
  assert.equal(off.placesAvailable, false);
  assert.deepEqual(off.places.map((p) => p.source), ['ASKOUT']);
});

test('entradas inválidas são recusadas', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  for (const bad of [
    { q: 'x'.repeat(81) }, { q: 'a\u0000b' }, { lat: 1 }, { lat: 91, lng: 0 }, { lat: 'abc', lng: 1 },
    { radiusKm: 0 }, { radiusKm: 51 }, { kind: 'FESTA' }, { from: 'ontem' },
    { from: '2026-10-14T00:00:00Z', to: '2026-10-13T00:00:00Z' }, { from: '2026-10-01T00:00:00Z', to: '2027-01-01T00:00:00Z' },
  ]) {
    await rejectsWith(w.core.explore.search(ana!, bad), 'VALIDATION');
  }
});

test('pessoas bloqueadas não aparecem na busca; evento por id com distância', async () => {
  const w = makeWorld();
  const { ana, samuel } = await w.signUpMany('ana', 'samuel');
  await seed(w);
  await w.core.blocks.block(ana!, samuel!);
  assert.equal((await w.core.explore.search(ana!, { q: 'samuel' })).people.length, 0);
  const e = await w.core.explore.event(ana!, 'e1', { lat: HERE.lat, lng: HERE.lng });
  assert.equal(e.venue.name, 'Bar do Zé');
  assert.ok((e.distanceM ?? 0) > 400);
  assert.equal((await w.core.explore.event(ana!, 'e1')).distanceM, null);
  await rejectsWith(w.core.explore.event(ana!, 'nao-existe'), 'NOT_FOUND');
  await rejectsWith(w.core.explore.event(ana!, 'e1', { lat: 1 }), 'VALIDATION');
});
