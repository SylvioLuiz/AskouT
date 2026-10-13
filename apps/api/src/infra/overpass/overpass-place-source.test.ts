import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OverpassPlaceSource } from './overpass-place-source.ts';

const C = { lat: -23.55052, lng: -46.63331 };
const body = {
  elements: [
    { type: 'node', id: 1, lat: -23.55, lon: -46.63, tags: { name: 'Bar do Zé', amenity: 'bar' } },
    { type: 'way', id: 2, center: { lat: -23.551, lon: -46.634 }, tags: { name: 'Café Central', amenity: 'cafe' } },
    { type: 'node', id: 3, lat: -23.5, lon: -46.6, tags: { amenity: 'pub' } },
    { type: 'node', id: 1, lat: -23.55, lon: -46.63, tags: { name: 'Bar do Zé', amenity: 'bar' } },
    { type: 'node', id: 4, tags: { name: 'Sem coordenada' } },
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

test('lê nós e vias, ignora sem nome, sem coordenada e repetidos', async () => {
  const f = fake(() => Response.json(body));
  const src = new OverpassPlaceSource({ fetchImpl: f.fetchImpl, contact: 'a@b.com' });
  const res = await src.nearby(C, 3000, 10);
  assert.equal(res.available, true);
  assert.deepEqual(res.places.map((p) => [p.externalId, p.name, p.category]), [['node/1', 'Bar do Zé', 'bar'], ['way/2', 'Café Central', 'cafe']]);
  assert.equal(res.places[1]!.lat, -23.551);
});

test('manda a consulta com coordenada arredondada e identifica o app', async () => {
  const f = fake(() => Response.json(body));
  await new OverpassPlaceSource({ fetchImpl: f.fetchImpl, contact: 'a@b.com' }).nearby(C, 3000, 10);
  const call = f.calls[0]!;
  assert.equal(call.init.method, 'POST');
  const data = new URLSearchParams(String(call.init.body)).get('data')!;
  assert.match(data, /around:3000,-23\.551,-46\.633/);
  assert.ok(!data.includes('23.55052'), 'ponto exato não sai do servidor');
  assert.match((call.init.headers as Record<string, string>)['user-agent']!, /^AskouT\/.*a@b\.com/);
});

test('cache de 10 minutos por região', async () => {
  let t = 0;
  const f = fake(() => Response.json(body));
  const src = new OverpassPlaceSource({ fetchImpl: f.fetchImpl, now: () => t });
  await src.nearby(C, 3000, 10);
  await src.nearby({ lat: C.lat + 0.00001, lng: C.lng }, 3000, 1);
  assert.equal(f.calls.length, 1);
  t = 11 * 60_000;
  await src.nearby(C, 3000, 10);
  assert.equal(f.calls.length, 2);
});

test('falhas viram indisponível, sem lançar e sem guardar no cache', async () => {
  for (const make of [
    () => new Response('erro', { status: 429 }),
    () => new Response('não é json', { status: 200 }),
    () => {
      throw new Error('rede');
    },
  ]) {
    const f = fake(make);
    const src = new OverpassPlaceSource({ fetchImpl: f.fetchImpl });
    assert.deepEqual(await src.nearby(C, 3000, 10), { available: false, places: [] });
    await src.nearby(C, 3000, 10);
    assert.equal(f.calls.length, 2, 'falha não é cacheada');
  }
});

test('respeita o limite pedido', async () => {
  const f = fake(() => Response.json(body));
  const res = await new OverpassPlaceSource({ fetchImpl: f.fetchImpl }).nearby(C, 3000, 1);
  assert.equal(res.places.length, 1);
});
