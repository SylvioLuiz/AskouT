import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FallbackPlaceSource } from '../places/fallback-place-source.ts';
import { GooglePlaceSource, PHOTO_REF_RE, nextPacificMidnight } from './google-place-source.ts';

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
  // Nota e avaliações jogam a chamada para a faixa cara (Enterprise): ficam fora da máscara.
  assert.doesNotMatch(h['x-goog-fieldmask']!, /rating|userRatingCount/);
  assert.match(h['x-goog-fieldmask']!, /places\.photos/);
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
  await src.nearby({ lat: 1, lng: 1 }, 3000, 10);
  await src.nearby({ lat: 2, lng: 2 }, 3000, 10);
  assert.equal((await src.nearby({ lat: 3, lng: 3 }, 3000, 10)).available, false);
  assert.equal(f.calls.length, 2);
  t += 24 * 3600_000;
  assert.equal((await src.nearby({ lat: 4, lng: 4 }, 3000, 10)).available, true);
});

test('cada tipo de chamada tem o seu teto: esgotar fotos não bloqueia a busca', async () => {
  const f = fake((url) => (url.includes('/media') ? new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } }) : Response.json(body)));
  const src = new GooglePlaceSource({ apiKey: 'K', fetchImpl: f.fetchImpl, dailyLimits: { photo: 1, search: 1 } });
  assert.ok(await src.photo('places/a/photos/b'));
  assert.equal(await src.photo('places/a/photos/c'), undefined);
  assert.equal((await src.search('bar', undefined, 5)).available, true);
  assert.equal((await src.search('outro', undefined, 5)).available, false);
  assert.equal((await src.nearby(C, 3000, 10)).available, true);
});

test('busca igual em até 10 minutos reaproveita a resposta sem chamar o Google', async () => {
  let t = Date.parse('2026-10-13T12:00:00Z');
  const f = fake(() => Response.json(body));
  const src = new GooglePlaceSource({ apiKey: 'K', fetchImpl: f.fetchImpl, now: () => t });
  await src.search('Bar do Zé', C, 10);
  const again = await src.search('  bar  do zé ', { lat: C.lat + 0.001, lng: C.lng }, 10);
  assert.equal(again.places[0]!.name, 'Bar do Zé');
  await src.nearby(C, 3000, 10);
  await src.nearby({ lat: C.lat + 0.0001, lng: C.lng }, 3000, 10);
  assert.equal(f.calls.length, 2);
  t += 11 * 60_000;
  await src.search('Bar do Zé', C, 10);
  await src.nearby(C, 3000, 10);
  assert.equal(f.calls.length, 4);
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

test('fallback na busca por texto: sem pedir o Google, só a reserva gratuita; pedindo, Google e reserva se ele falhar', async () => {
  const place = (name: string) => [{ externalId: name, source: 'OSM' as const, name, category: null, lat: 0, lng: 0 }];
  const calls: string[] = [];
  const google = { premiumSearch: true, nearby: async () => ({ available: true, places: [] }), search: async () => (calls.push('google'), { available: true, places: place('G') }) };
  const googleDown = { ...google, search: async () => (calls.push('google'), { available: false, places: [] }) };
  const osm = { nearby: async () => ({ available: true, places: [] }), search: async () => (calls.push('osm'), { available: true, places: place('O') }) };
  const both = new FallbackPlaceSource(google, osm);
  assert.equal(both.premiumSearch, true);
  assert.equal((await both.search('x', undefined, 5)).places[0]!.name, 'O');
  assert.deepEqual(calls, ['osm']);
  assert.equal((await both.search('x', undefined, 5, { premium: true })).places[0]!.name, 'G');
  assert.equal((await new FallbackPlaceSource(googleDown, osm).search('x', undefined, 5, { premium: true })).places[0]!.name, 'O');
  assert.equal(new FallbackPlaceSource(osm, osm).premiumSearch, false);
});

test('a mesma foto é buscada no Google uma vez só e não gasta a franquia de novo', async () => {
  const f = fake(() => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } }));
  const src = new GooglePlaceSource({ apiKey: 'K', fetchImpl: f.fetchImpl, dailyLimits: { photo: 1 } });
  const [a, b] = await Promise.all([src.photo('places/a/photos/b'), src.photo('places/a/photos/b')]);
  assert.ok(a && b);
  assert.ok(await src.photo('places/a/photos/b'), 'depois de gastar a franquia, a foto guardada continua saindo');
  assert.equal(await src.photo('places/a/photos/outra'), undefined, 'outra foto sem franquia');
  assert.equal(f.calls.length, 1);
});

test('cadastro pela gestão: Autocomplete com sessão e detalhe só com campos Essentials, dentro do teto do dia', async () => {
  const f = fake((url) =>
    url.endsWith('places:autocomplete')
      ? Response.json({ suggestions: [{ placePrediction: { placeId: 'ChIJa', structuredFormat: { mainText: { text: 'Bar Augusta' }, secondaryText: { text: 'Rua Augusta, 1500' } } } }, { placePrediction: { placeId: '../x', structuredFormat: { mainText: { text: 'X' } } } }] })
      : Response.json({ id: 'ChIJa', formattedAddress: 'Rua Augusta, 1500 - SP', location: { latitude: -23.5, longitude: -46.6 }, types: ['bar'] }),
  );
  const g = new GooglePlaceSource({ apiKey: 'K', fetchImpl: f.fetchImpl, dailyLimits: { autocomplete: 1, essentials: 1 } });
  const s = await g.suggest('bar augusta', 'sess-1234');
  assert.deepEqual(s.items, [{ placeId: 'ChIJa', name: 'Bar Augusta', address: 'Rua Augusta, 1500' }]);
  assert.equal(JSON.parse(String(f.calls[0]!.init.body)).sessionToken, 'sess-1234');
  assert.deepEqual(await g.suggest('bar augusta', 'sess-1234'), s, 'mesma busca vem da memória');
  assert.equal((await g.suggest('outro bar', 'sess-1234')).available, false, 'teto do dia');
  const d = await g.essentials('ChIJa', 'sess-1234');
  assert.deepEqual(d, { placeId: 'ChIJa', address: 'Rua Augusta, 1500 - SP', lat: -23.5, lng: -46.6, types: ['bar'] });
  const call = f.calls.at(-1)!;
  assert.match(call.url, /places\/ChIJa\?.*sessionToken=sess-1234/);
  const mask = String((call.init.headers as Record<string, string>)['x-goog-fieldmask']);
  assert.equal(mask, 'id,formattedAddress,location,types');
  for (const paid of ['displayName', 'photos', 'rating', 'phone', 'website', 'Hours', 'googleMapsUri', 'primaryType']) assert.ok(!mask.includes(paid), `${paid} é pago`);
  assert.equal(await g.essentials('ChIJa'), undefined, 'teto do dia');
});

const QUOTA_DAY = '{"error":{"code":429,"message":"Quota exceeded for quota metric \'SearchTextRequest\' and limit \'SearchTextRequest per day\' of service \'places.googleapis.com\'","status":"RESOURCE_EXHAUSTED"}}';

test('429 da cota diária: para de chamar o Google até a meia-noite do Pacífico e a busca paga some', async () => {
  // 12:00 UTC = 05:00 em Los Angeles (horário de verão, UTC-7): a cota renova 19 horas depois.
  let t = Date.parse('2026-10-13T12:00:00Z');
  let quota = true;
  const f = fake(() => (quota ? new Response(QUOTA_DAY, { status: 429 }) : Response.json(body)));
  const src = new GooglePlaceSource({ apiKey: 'K', fetchImpl: f.fetchImpl, now: () => t });
  assert.equal(src.premiumSearch, true);
  assert.deepEqual(await src.search('bar', C, 10), { available: false, places: [] });
  assert.deepEqual([src.premiumSearch, src.premiumPaused], [false, true]);
  await src.search('outro bar', C, 10);
  await src.search('mais um', undefined, 10);
  assert.equal(f.calls.length, 1, 'depois do 429 nem tenta');
  // Outros tipos de chamada têm cota própria no Google e seguem.
  assert.equal((await src.nearby(C, 3000, 10)).available, false);
  assert.equal(f.calls.length, 2);
  quota = false;
  t = Date.parse('2026-10-14T06:59:00Z');
  assert.equal((await src.search('bar', C, 10)).available, false, 'ainda antes da meia-noite do Pacífico');
  t = Date.parse('2026-10-14T07:06:00Z');
  assert.deepEqual([src.premiumSearch, src.premiumPaused], [true, false]);
  assert.equal((await src.search('bar', C, 10)).available, true);
});

test('429 que não é da cota diária (por minuto) pausa só 1 minuto', async () => {
  let t = Date.parse('2026-10-13T12:00:00Z');
  let quota = true;
  const f = fake(() => (quota ? new Response('{"error":{"message":"SearchTextRequest per minute"}}', { status: 429 }) : Response.json(body)));
  const src = new GooglePlaceSource({ apiKey: 'K', fetchImpl: f.fetchImpl, now: () => t });
  await src.search('bar', C, 10);
  assert.equal(src.premiumPaused, true);
  quota = false;
  t += 61_000;
  assert.equal((await src.search('bar', C, 10)).available, true);
  assert.equal(f.calls.length, 2);
});

test('buscas iguais ao mesmo tempo dividem uma chamada só ao Google', async () => {
  const f = fake(() => Response.json(body));
  const src = new GooglePlaceSource({ apiKey: 'K', fetchImpl: f.fetchImpl });
  const [a, b] = await Promise.all([src.search('Bar do Zé', C, 10), src.search('bar do zé', C, 10)]);
  assert.equal(f.calls.length, 1);
  assert.equal(a.places[0]!.name, 'Bar do Zé');
  assert.notEqual(a.places[0], b.places[0], 'cada um recebe a sua cópia');
});

test('a pausa do Google chega ao fallback: busca paga desligada e marcada como pausada', async () => {
  const f = fake(() => new Response(QUOTA_DAY, { status: 429 }));
  const google = new GooglePlaceSource({ apiKey: 'K', fetchImpl: f.fetchImpl });
  const osm = { nearby: async () => ({ available: true, places: [] }), search: async () => ({ available: true, places: [{ externalId: 'o', source: 'OSM' as const, name: 'O', category: null, lat: 0, lng: 0 }] }) };
  const both = new FallbackPlaceSource(google, osm);
  assert.equal((await both.search('x', undefined, 5, { premium: true })).places[0]!.name, 'O', 'o 429 cai no OpenStreetMap');
  assert.deepEqual([both.premiumSearch, both.premiumPaused], [false, true]);
});

test('meia-noite do Pacífico, com e sem horário de verão', () => {
  assert.equal(new Date(nextPacificMidnight(Date.parse('2026-10-13T12:00:00Z'))).toISOString(), '2026-10-14T07:05:00.000Z');
  assert.equal(new Date(nextPacificMidnight(Date.parse('2026-12-01T23:30:00Z'))).toISOString(), '2026-12-02T08:05:00.000Z');
  assert.equal(new Date(nextPacificMidnight(Date.parse('2026-12-02T07:30:00Z'))).toISOString(), '2026-12-02T08:05:00.000Z');
});
