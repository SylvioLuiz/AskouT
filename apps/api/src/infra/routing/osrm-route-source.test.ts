import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OsrmRouteSource, simplifyLine } from './osrm-route-source.ts';

const A = { lat: -23.55, lng: -46.63 };
const B = { lat: -23.56, lng: -46.64 };
const ok = (coordinates: unknown) => new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 1200.4, duration: 900.2, geometry: { coordinates } }] }), { status: 200 });

test('osrm: monta a URL (lng,lat), devolve distância, tempo e trajeto', async () => {
  const urls: string[] = [];
  const src = new OsrmRouteSource({ fetchFn: async (u) => (urls.push(String(u)), ok([[-46.63, -23.55], [-46.64, -23.56]])) });
  const r = await src.route(A, B, 'foot');
  assert.deepEqual(r, { distanceM: 1200.4, durationS: 900.2, line: [[-46.63, -23.55], [-46.64, -23.56]] });
  assert.match(urls[0]!, /\/route\/v1\/foot\/-46\.63,-23\.55;-46\.64,-23\.56\?overview=full&geometries=geojson/);
});

test('osrm: falha, resposta ruim e demora viram undefined, sem lançar', async () => {
  const bad = [
    async () => new Response('x', { status: 500 }),
    async () => new Response(JSON.stringify({ code: 'NoRoute' }), { status: 200 }),
    async () => ok([[1, 2]]),
    async () => {
      throw new Error('rede');
    },
  ];
  for (const fetchFn of bad) assert.equal(await new OsrmRouteSource({ fetchFn: fetchFn as never }).route(A, B, 'driving'), undefined);
});

test('osrm: reaproveita a resposta por um minuto para o mesmo trajeto', async () => {
  let calls = 0;
  let now = 0;
  const src = new OsrmRouteSource({ now: () => now, fetchFn: async () => (calls++, ok([[1, 2], [3, 4]])) });
  await src.route(A, B, 'foot');
  await src.route({ lat: A.lat + 0.00001, lng: A.lng }, B, 'foot');
  assert.equal(calls, 1);
  now = 61_000;
  await src.route(A, B, 'foot');
  assert.equal(calls, 2);
});

test('simplifyLine: limita os pontos e mantém o primeiro e o último', () => {
  const line: [number, number][] = Array.from({ length: 1000 }, (_, i) => [i, i]);
  const out = simplifyLine(line, 100);
  assert.equal(out.length, 100);
  assert.deepEqual(out[0], [0, 0]);
  assert.deepEqual(out[99], [999, 999]);
  assert.equal(simplifyLine([[1, 1], [2, 2]], 100).length, 2);
});
