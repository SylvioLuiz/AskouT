import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statDay } from './boost-stats-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';
import type { BoostRecord } from './types.ts';

const H = 3_600_000;
const DAY = 24 * H;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('dono', 'ana', 'bia', 'cris', 'outro');
  const dono = u['dono']!, ana = u['ana']!, bia = u['bia']!, cris = u['cris']!, outro = u['outro']!;
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: null, category: 'bar', lat: -23.58, lng: -46.65, isSample: false, ownerId: dono });
  await w.places.createVenue({ id: 'v2', name: 'Balada Nova', address: null, category: 'night_club', lat: -23.59, lng: -46.65, isSample: false, ownerId: outro });
  const now = w.clock.now().getTime();
  const ev = (id: string, venueId: string) => ({ id, venueId, title: id, description: null, startsAt: new Date(now + 5 * H), endsAt: new Date(now + 8 * H), kind: 'OTHER' as const, isFree: false, imageUrl: null, tags: [], isSample: false });
  await w.places.createEvent(ev('e1', 'v1'));
  await w.places.createEvent(ev('e2', 'v1'));
  await w.places.createEvent(ev('e3', 'v2'));
  const boost = async (id: string, over: Partial<BoostRecord> = {}): Promise<BoostRecord> => {
    const b: BoostRecord = { id, venueId: 'v1', channel: 'WEB', ownerId: dono, target: 'VENUE', eventId: null, days: 3, amountCents: 3490, status: 'PAID', chargeId: `ch_${id}`, payCode: null, payUrl: null, createdAt: new Date(now - H), paidAt: new Date(now - H), startsAt: new Date(now - H), endsAt: new Date(now - H + 3 * DAY), audience: 'ALL', radiusM: null, matchTags: [], ...over };
    await w.boosts.create(b);
    return b;
  };
  return { w, dono, ana, bia, cris, outro, now, boost };
}

test('cada pessoa conta uma vez por dia em cada tipo, mesmo vendo em vários lugares', async () => {
  const { w, dono, ana, bia, boost } = await setup();
  await boost('b1');
  const seen = [{ kind: 'IMPRESSION', placement: 'EXPLORE', venueId: 'v1' }];
  assert.deepEqual(await w.core.boostStats.track(ana, seen), { counted: 1 });
  assert.deepEqual(await w.core.boostStats.track(ana, [...seen, { kind: 'IMPRESSION', placement: 'HOME', eventId: 'e1' }]), { counted: 0 }, 'a mesma pessoa no mesmo dia não infla');
  assert.deepEqual(await w.core.boostStats.track(bia, [{ kind: 'IMPRESSION', placement: 'HOME', eventId: 'e1' }, { kind: 'OPEN', placement: 'HOME', eventId: 'e1' }]), { counted: 2 }, 'evento do local impulsionado conta no anúncio do local');
  w.clock.tick(DAY);
  assert.deepEqual(await w.core.boostStats.track(ana, seen), { counted: 1 }, 'no dia seguinte conta de novo');
  const r = await w.core.boostStats.report(dono, 'b1');
  assert.deepEqual(r.totals, { impressions: 3, opens: 1, ticketClicks: 0 });
  assert.equal(r.openRatePct, 33);
  assert.equal(r.rounded, false);
  assert.deepEqual(r.placements, [{ placement: 'EXPLORE', impressions: 2 }, { placement: 'HOME', impressions: 1 }]);
});

test('o servidor decide o anúncio: outro local, anúncio vencido, dono e público errado não contam', async () => {
  const { w, dono, ana, now, boost } = await setup();
  await boost('ativo', { target: 'EVENT', eventId: 'e1' });
  await boost('vencido', { target: 'EVENT', eventId: 'e2', startsAt: new Date(now - 5 * DAY), endsAt: new Date(now - DAY) });
  await boost('match', { target: 'EVENT', eventId: 'e3', venueId: 'v2', audience: 'MATCH', radiusM: 5000, matchTags: ['rock'] });
  assert.deepEqual(
    await w.core.boostStats.track(ana, [
      { kind: 'IMPRESSION', placement: 'EXPLORE', eventId: 'e3' }, // Match não aparece no Explorar
      { kind: 'IMPRESSION', placement: 'EXPLORE', eventId: 'e2' }, // anúncio vencido
      { kind: 'IMPRESSION', placement: 'EXPLORE', eventId: 'nao-existe' },
      { kind: 'IMPRESSION', placement: 'EXPLORE', venueId: 'v2' }, // local sem anúncio do local
      { kind: 'IMPRESSION', placement: 'MATCH', eventId: 'e1' }, // anúncio para todos não é Match
    ]),
    { counted: 0 },
  );
  assert.deepEqual(await w.core.boostStats.track(dono, [{ kind: 'IMPRESSION', placement: 'EXPLORE', eventId: 'e1' }]), { counted: 0 }, 'o próprio dono não conta');
  assert.deepEqual(await w.core.boostStats.track(ana, [{ kind: 'IMPRESSION', placement: 'MATCH', eventId: 'e3' }, { kind: 'IMPRESSION', placement: 'EXPLORE', eventId: 'e1', venueId: 'v2' }]), { counted: 2 }, 'o local vem do evento, não do app');
  assert.deepEqual((await w.core.boostStats.report(dono, 'ativo')).totals.impressions, 1);
});

test('o anúncio do evento tem preferência sobre o do local', async () => {
  const { w, dono, ana, boost } = await setup();
  await boost('local');
  await boost('evento', { target: 'EVENT', eventId: 'e1' });
  await w.core.boostStats.track(ana, [{ kind: 'IMPRESSION', placement: 'EXPLORE', eventId: 'e1' }]);
  assert.equal((await w.core.boostStats.report(dono, 'evento')).totals.impressions, 1);
  assert.equal((await w.core.boostStats.report(dono, 'local')).totals.impressions, 0);
});

test('clique no ingresso só conta para quem viu ou abriu o anúncio hoje ou ontem', async () => {
  const { w, dono, ana, bia, cris, boost } = await setup();
  await boost('b1', { target: 'EVENT', eventId: 'e1' });
  const ticket = [{ kind: 'TICKET', placement: 'EVENT_PAGE', eventId: 'e1' }];
  assert.deepEqual(await w.core.boostStats.track(ana, ticket), { counted: 0 }, 'chegou ao evento sem ver o anúncio');
  await w.core.boostStats.track(bia, [{ kind: 'IMPRESSION', placement: 'HOME', eventId: 'e1' }]);
  await w.core.boostStats.track(cris, [{ kind: 'OPEN', placement: 'EXPLORE', eventId: 'e1' }]);
  w.clock.tick(DAY);
  assert.deepEqual(await w.core.boostStats.track(bia, ticket), { counted: 1 }, 'viu ontem');
  assert.deepEqual(await w.core.boostStats.track(bia, ticket), { counted: 0 }, 'uma vez por dia');
  w.clock.tick(DAY);
  assert.deepEqual(await w.core.boostStats.track(cris, ticket), { counted: 0 }, 'abriu há dois dias: não conta');
  assert.equal((await w.core.boostStats.report(dono, 'b1')).totals.ticketClicks, 1);
});

test('relatório: só para quem pagou, com todos os dias da campanha até hoje', async () => {
  const { w, dono, ana, outro, now, boost } = await setup();
  await boost('b1');
  await w.core.boostStats.track(ana, [{ kind: 'IMPRESSION', placement: 'EXPLORE', venueId: 'v1' }]);
  w.clock.tick(DAY);
  const r = await w.core.boostStats.report(dono, 'b1');
  assert.deepEqual(r.days.map((d) => [d.day, d.impressions]), [[statDay(new Date(now - H)), 1], [statDay(new Date(now - H + DAY)), 0]]);
  assert.equal(r.phase, 'ACTIVE');
  await rejectsWith(w.core.boostStats.report(outro, 'b1'), 'NOT_FOUND');
  await rejectsWith(w.core.boostStats.report(dono, 'nao-existe'), 'NOT_FOUND');
  await rejectsWith(w.core.boostStats.report(dono, 42), 'NOT_FOUND');
  // Pedido ainda não pago: relatório vazio, sem dias.
  await boost('pendente', { status: 'PENDING_PAYMENT', startsAt: null, endsAt: null, paidAt: null });
  const p = await w.core.boostStats.report(dono, 'pendente');
  assert.deepEqual([p.days, p.totals, p.openRatePct], [[], { impressions: 0, opens: 0, ticketClicks: 0 }, null]);
});

test('no Match os números pequenos viram "menos de 10" e o resto arredonda de 10 em 10', async () => {
  const { w, dono, boost } = await setup();
  await boost('m1', { target: 'EVENT', eventId: 'e1', audience: 'MATCH', radiusM: 5000, matchTags: ['rock'] });
  const ids = Array.from({ length: 13 }, (_, i) => `pessoa-${i}`);
  for (const id of ids) await w.core.boostStats.track(id, [{ kind: 'IMPRESSION', placement: 'MATCH', eventId: 'e1' }]);
  for (const id of ids.slice(0, 3)) await w.core.boostStats.track(id, [{ kind: 'OPEN', placement: 'MATCH', eventId: 'e1' }]);
  const r = await w.core.boostStats.report(dono, 'm1');
  assert.equal(r.rounded, true);
  assert.deepEqual(r.totals, { impressions: 10, opens: null, ticketClicks: null });
  assert.equal(r.openRatePct, 23, 'a taxa usa o número real quando há exibições suficientes');
});

test('envio inválido é recusado; registro sem anúncio é ignorado', async () => {
  const { w, ana } = await setup();
  await rejectsWith(w.core.boostStats.track(ana, []), 'VALIDATION');
  await rejectsWith(w.core.boostStats.track(ana, 'x'), 'VALIDATION');
  await rejectsWith(w.core.boostStats.track(ana, Array.from({ length: 21 }, () => ({ kind: 'IMPRESSION', placement: 'HOME', venueId: 'v1' }))), 'VALIDATION');
  await rejectsWith(w.core.boostStats.track(ana, [{ kind: 'LIKE', placement: 'HOME', venueId: 'v1' }]), 'VALIDATION');
  await rejectsWith(w.core.boostStats.track(ana, [{ kind: 'IMPRESSION', placement: 'FEED', venueId: 'v1' }]), 'VALIDATION');
  await rejectsWith(w.core.boostStats.track(ana, [{ kind: 'IMPRESSION', placement: 'HOME' }]), 'VALIDATION');
  await rejectsWith(w.core.boostStats.track(ana, [{ kind: 'TICKET', placement: 'HOME', eventId: 'e1' }]), 'VALIDATION');
  await rejectsWith(w.core.boostStats.track(ana, [{ kind: 'IMPRESSION', placement: 'EVENT_PAGE', eventId: 'e1' }]), 'VALIDATION');
  assert.deepEqual(await w.core.boostStats.track(ana, [{ kind: 'IMPRESSION', placement: 'HOME', venueId: 'v1' }]), { counted: 0 }, 'sem anúncio ativo');
});

test('as marcações de "já contei" são apagadas depois de 2 dias, os contadores ficam', async () => {
  const { w, dono, ana, boost } = await setup();
  await boost('b1', { endsAt: new Date(w.clock.now().getTime() + 10 * DAY), days: 14 });
  await w.core.boostStats.track(ana, [{ kind: 'IMPRESSION', placement: 'HOME', venueId: 'v1' }]);
  w.clock.tick(3 * DAY);
  await w.core.boostStats.track(ana, [{ kind: 'IMPRESSION', placement: 'HOME', venueId: 'v1' }]);
  assert.equal([...w.boostStats.seen].length, 1, 'só a marcação de hoje ficou');
  assert.equal((await w.core.boostStats.report(dono, 'b1')).totals.impressions, 2);
});
