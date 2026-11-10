import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OFFER_MAX_PER_DAY, OFFER_TEXT_MAX } from './offer-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const MIN = 60_000;
const H = 3_600_000;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('dono', 'ana', 'bia', 'outro', 'longe');
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: -23.58, lng: -46.65, isSample: false, ownerId: u['dono']! });
  await w.places.createVenue({ id: 'v2', name: 'Balada Nova', address: null, category: 'night_club', lat: -23.59, lng: -46.65, isSample: false, ownerId: u['outro']! });
  return { w, dono: u['dono']!, ana: u['ana']!, bia: u['bia']!, outro: u['outro']!, longe: u['longe']! };
}
const nearHome = { lat: -23.58, lng: -46.65 };
const farAway = { lat: -22.9, lng: -43.17 };

test('publicar: só o responsável, texto curto e sem termos proibidos, duração limitada', async () => {
  const { w, dono, ana } = await setup();
  await rejectsWith(w.core.offers.create(ana, 'v1', { text: 'Chopp em dobro até 22h', minutes: 60 }), 'NOT_FOUND');
  await rejectsWith(w.core.offers.create(dono, 'v2', { text: 'Chopp em dobro até 22h', minutes: 60 }), 'NOT_FOUND');
  await rejectsWith(w.core.offers.create(dono, 'v1', { text: 'oi', minutes: 60 }), 'VALIDATION');
  await rejectsWith(w.core.offers.create(dono, 'v1', { text: 'x'.repeat(OFFER_TEXT_MAX + 1), minutes: 60 }), 'VALIDATION');
  await rejectsWith(w.core.offers.create(dono, 'v1', { text: 'Chopp com a puta que pariu', minutes: 60 }), 'VALIDATION');
  await rejectsWith(w.core.offers.create(dono, 'v1', { text: 'Chopp em dobro', minutes: 5 }), 'VALIDATION');
  await rejectsWith(w.core.offers.create(dono, 'v1', { text: 'Chopp em dobro', minutes: 241 }), 'VALIDATION');
  await rejectsWith(w.core.offers.create(dono, 'v1', { text: 'Chopp em dobro', minutes: '60' }), 'VALIDATION');
  const o = await w.core.offers.create(dono, 'v1', { text: '  Chopp em dobro   até 22h ', minutes: 120 });
  assert.equal(o.text, 'Chopp em dobro até 22h');
  assert.equal(o.phase, 'ACTIVE');
  assert.equal(Date.parse(o.endsAt) - w.clock.now().getTime(), 2 * H);
});

test('uma oferta no ar por local; encerrar libera; limite por dia', async () => {
  const { w, dono, ana } = await setup();
  const first = await w.core.offers.create(dono, 'v1', { text: 'Chopp em dobro', minutes: 60 });
  await rejectsWith(w.core.offers.create(dono, 'v1', { text: 'Outra oferta', minutes: 60 }), 'CONFLICT');
  await rejectsWith(w.core.offers.end(ana, first.id), 'NOT_FOUND');
  assert.equal((await w.core.offers.end(dono, first.id)).phase, 'ENDED');
  for (let i = 1; i < OFFER_MAX_PER_DAY; i += 1) {
    const o = await w.core.offers.create(dono, 'v1', { text: `Oferta número ${i}`, minutes: 15 });
    await w.core.offers.end(dono, o.id);
  }
  await rejectsWith(w.core.offers.create(dono, 'v1', { text: 'Passou do limite', minutes: 15 }), 'CONFLICT');
  assert.equal((await w.core.offers.list(dono, 'v1')).remainingToday, 0);
  w.clock.tick(24 * H + MIN);
  await w.core.offers.create(dono, 'v1', { text: 'No dia seguinte pode', minutes: 15 });
});

test('quem tem região salva perto vê "Patrocinado"; longe, sem região ou o próprio dono não vê', async () => {
  const { w, dono, ana, bia, longe } = await setup();
  await w.core.regions.set(ana, nearHome);
  await w.core.regions.set(longe, farAway);
  await w.core.offers.create(dono, 'v1', { text: 'Chopp em dobro até 22h', minutes: 120 });
  const seen = await w.core.offers.forViewer(ana, w.clock.now());
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0]?.label, seen[0]?.venueName, seen[0]?.text], ['Patrocinado', 'Bar do Zé', 'Chopp em dobro até 22h']);
  assert.deepEqual(Object.keys(seen[0]!).sort(), ['endsAt', 'id', 'label', 'text', 'venueId', 'venueName']);
  assert.deepEqual(await w.core.offers.forViewer(longe, w.clock.now()), []);
  assert.deepEqual(await w.core.offers.forViewer(bia, w.clock.now()), [], 'sem região nem NOW');
  assert.deepEqual(await w.core.offers.forViewer(dono, w.clock.now()), []);
});

test('quem está com o NOW ligado perto vê, mesmo sem região', async () => {
  const { w, dono, bia, longe } = await setup();
  await w.core.offers.create(dono, 'v1', { text: 'Chopp em dobro até 22h', minutes: 120 });
  await w.core.flash.turnOn(bia, { hours: 2, ...nearHome });
  await w.core.flash.turnOn(longe, { hours: 2, ...farAway });
  assert.equal((await w.core.offers.forViewer(bia, w.clock.now())).length, 1);
  assert.deepEqual(await w.core.offers.forViewer(longe, w.clock.now()), []);
});

test('some ao vencer e ao ser encerrada', async () => {
  const { w, dono, ana } = await setup();
  await w.core.regions.set(ana, nearHome);
  const o = await w.core.offers.create(dono, 'v1', { text: 'Chopp em dobro', minutes: 30 });
  w.clock.tick(29 * MIN);
  assert.equal((await w.core.offers.forViewer(ana, w.clock.now())).length, 1);
  w.clock.tick(2 * MIN);
  assert.deepEqual(await w.core.offers.forViewer(ana, w.clock.now()), []);
  assert.equal((await w.core.offers.list(dono, 'v1')).items[0]?.phase, 'ENDED');
  const o2 = await w.core.offers.create(dono, 'v1', { text: 'Outra rodada', minutes: 30 });
  assert.equal((await w.core.offers.forViewer(ana, w.clock.now())).length, 1);
  await w.core.offers.end(dono, o2.id);
  assert.deepEqual(await w.core.offers.forViewer(ana, w.clock.now()), []);
  assert.notEqual(o.id, o2.id);
});

test('bloqueio nos dois sentidos esconde a oferta', async () => {
  const { w, dono, ana, bia } = await setup();
  await w.core.regions.set(ana, nearHome);
  await w.core.regions.set(bia, nearHome);
  await w.core.offers.create(dono, 'v1', { text: 'Chopp em dobro', minutes: 60 });
  await w.core.blocks.block(ana, dono);
  await w.core.blocks.block(dono, bia);
  assert.deepEqual(await w.core.offers.forViewer(ana, w.clock.now()), []);
  assert.deepEqual(await w.core.offers.forViewer(bia, w.clock.now()), []);
});

test('o dono só vê faixa de alcance, nunca quem', async () => {
  const { w, dono, ana, bia, longe } = await setup();
  await w.core.regions.set(ana, nearHome);
  await w.core.regions.set(bia, nearHome);
  await w.core.regions.set(longe, farAway);
  const o = await w.core.offers.create(dono, 'v1', { text: 'Chopp em dobro', minutes: 60 });
  assert.deepEqual([o.reach?.low, o.reach?.people], [true, null]);
  assert.equal(o.reach?.label, 'menos de 10 pessoas');
  const listed = await w.core.offers.list(dono, 'v1');
  assert.ok(!JSON.stringify(listed).includes(ana), 'nenhum id de quem está no alcance');
  assert.equal(listed.limits.free, true);
});
