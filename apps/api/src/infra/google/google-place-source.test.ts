import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FallbackPlaceSource } from '../places/fallback-place-source.ts';
import { GooglePlaceSource, PHOTO_REF_RE } from './google-place-source.ts';

const C = { lat: -23.55, lng: -46.63 };
const body = {
  places: [
    { id: 'ChIJ1', displayName: { text: 'Bar do Zé' }, location: { latitude: -23.55, longitude: -46.63 }, rating: 4.6, userRatingCount: 321, primaryType: 'bar', googleMapsUri: 'https://maps.google.com/?cid=1', photos: [{ name: 'places/ChIJ1/photos/AbC_d-1', authorAttributions: [{ displayName: 'Maria' }] }] },
    { id: 'ChIJ2', displayName: { text: 'Café' }, location: { latitude: -23.551, longitude: -46.631 }, rating: 9, photos: [{ name: '../../etc/passwd' }], googleMapsUri: 'javascript:alert(1)' },
    { id: 'ChIJ3', location: { latitude: 1, longitude: 1 } },
  ],
};
function fake(fn: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return fn(url, init);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test('lê nota, avaliações e foto; descarta nota inválida, foto fora do padrão, link que não é https e lugar sem nome', async () => {
  const f = fake(() => Response.json(body));
  const res = await new GooglePlaceSource({ apiKey: 'K', fetchImpl: f.fetchImpl }).nearby(C, 3000, 10);
  assert.equal(res.available, true);
  assert.equal(res.places.length, 2);
  const [a, b] = res.places;
  assert.deepEqual([a!.source, a!.rating, a!.ratingCount, a!.photoRef, a!.photoAuthor, a!.mapsUri], ['GOOGLE', 4.6, 321, 'places/ChIJ1/photos/AbC_d-1', 'Maria', 'https://maps.google.com/?cid=1']);
  assert.deepEqual([b!.rating, b!.photoRef, b!.mapsUri], [null, null, null]);
});

test('a chave vai em cabeçalho (nunca na URL), com máscara de campos e círculo em volta do ponto', async () => {
  const f = fake(() => Response.json(body));
  await new GooglePlaceSource({ apiKey: 'SEGREDO', fetchImpl: f.fetchImpl }).nearby(C, 3000, 50);
  const call = f.calls[0]!;
  assert.equal(call.url.includes('SEGREDO'), false);
  const h = call.init.headers as Record<string, string>;
  assert.equal(h['x-goog-api-key'], 'SEGREDO');
  assert.match(h['x-goog-fieldmask']!, /places\.rating/);
  const sent = JSON.parse(String(call.init.body));
  assert.equal(sent.maxResultCount, 20);
  assert.deepEqual(sent.locationRestriction.circle, { center: { latitude: C.lat, longitude: C.lng }, radius: 3000 });
});

test('falhas viram indisponível, sem lançar', async () => {
  for (const make of [() => new Response('x', { status: 403 }), () => new Response('nao json'), () => { throw new Error('rede'); }]) {
    const f = fake(make);
    assert.deepEqual(await new GooglePlaceSource({ apiKey: 'K', fetchImpl: f.fetchImpl }).nearby(C, 3000, 10), { available: false, places: [] });
  }
});

test('teto diário de buscas: passou, nem chama o Google; no dia seguinte volta', async () => {
  let t = Date.parse('2026-10-13T12:00:00Z');
  const f = fake(() => Response.json(body));
  const src = new GooglePlaceSource({ apiKey: 'K', fetchImpl: f.fetchImpl, dailyLimit: 2, now: () => t });
  await src.nearby(C, 3000, 10);
  await src.nearby(C, 3000, 10);
  assert.equal((await src.nearby(C, 3000, 10)).available, false);
  assert.equal(f.calls.length, 2);
  t += 24 * 3600_000;
  assert.equal((await src.nearby(C, 3000, 10)).available, true);
});

test('foto: só referência no formato do Google, só imagem; chave só na chamada ao Google', async () => {
  const f = fake(() => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }));
  const src = new GooglePlaceSource({ apiKey: 'K', fetchImpl: f.fetchImpl });
  assert.equal(await src.photo('../../x'), undefined);
  assert.equal(await src.photo('https://evil.com/places/a/photos/b'), undefined);
  assert.equal(f.calls.length, 0, 'referência inválida nem sai do servidor');
  const ok = await src.photo('places/ChIJ1/photos/AbC_d-1');
  assert.deepEqual([ok!.type, [...ok!.bytes]], ['image/jpeg', [1, 2, 3]]);
  const html = new GooglePlaceSource({ apiKey: 'K', fetchImpl: fake(() => new Response('<html>', { headers: { 'content-type': 'text/html' } })).fetchImpl });
  assert.equal(await html.photo('places/a/photos/b'), undefined);
  assert.ok(PHOTO_REF_RE.test('places/a/photos/b'));
});

test('fallback: Google vazio ou fora do ar cai para a reserva; indisponível só se as duas falharem', async () => {
  const ok = (names: string[]) => ({ nearby: async () => ({ available: true, places: names.map((n, i) => ({ externalId: String(i), source: 'OSM' as const, name: n, category: null, lat: 0, lng: 0 })) }) });
  const down = { nearby: async () => ({ available: false, places: [] }) };
  assert.equal((await new FallbackPlaceSource(ok(['G']), ok(['O'])).nearby(C, 1, 1)).places[0]!.name, 'G');
  assert.equal((await new FallbackPlaceSource(down, ok(['O'])).nearby(C, 1, 1)).places[0]!.name, 'O');
  assert.equal((await new FallbackPlaceSource(ok([]), ok([])).nearby(C, 1, 1)).available, true);
  assert.equal((await new FallbackPlaceSource(down, down).nearby(C, 1, 1)).available, false);
});
