import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOOST_DEFAULT_PRICE_PER_DAY_CENTS } from './boost-service.ts';
import { FakePaymentGateway } from './testing/in-memory.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const DAY = 24 * H;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('dono', 'ana', 'bia', 'outro');
  const dono = u['dono']!, ana = u['ana']!, bia = u['bia']!, outro = u['outro']!;
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: -23.58, lng: -46.65, isSample: false, ownerId: dono });
  await w.places.createVenue({ id: 'v2', name: 'Balada Nova', address: null, category: 'night_club', lat: -23.59, lng: -46.65, isSample: false, ownerId: outro });
  const now = w.clock.now().getTime();
  const ev = (id: string, venueId: string, startsAt: number, title = id) => ({ id, venueId, title, description: null, startsAt: new Date(startsAt), endsAt: new Date(startsAt + 3 * H), kind: 'OTHER' as const, isFree: false, imageUrl: null, tags: [], isSample: false });
  await w.places.createEvent(ev('e1', 'v1', now + 2 * H, 'Samba'));
  await w.places.createEvent(ev('e2', 'v1', now + 5 * H, 'Rock'));
  await w.places.createEvent(ev('e3', 'v2', now + 3 * H, 'Eletrônica'));
  await w.places.createEvent(ev('velho', 'v1', now - 10 * H, 'Já passou'));
  return { w, dono, ana, bia, outro, now };
}

const pay = (w: Awaited<ReturnType<typeof setup>>['w'], chargeId: string) =>
  w.core.boosts.handleWebhook({ 'x-signature': FakePaymentGateway.SECRET }, JSON.stringify({ chargeId, status: 'paid' }));

test('preço e opções vêm da configuração', async () => {
  const { w } = await setup();
  assert.deepEqual(w.core.boosts.pricing(), { currency: 'BRL', pricePerDayCents: BOOST_DEFAULT_PRICE_PER_DAY_CENTS, dayOptions: [1, 3, 7, 14], match: { radiusKmOptions: [2, 5, 10, 25], maxTags: 5 }, sandbox: true });
});

test('criar: só o responsável, com duração válida, e cobra dias × valor', async () => {
  const { w, dono, ana } = await setup();
  await rejectsWith(w.core.boosts.create(ana, 'v1', { target: 'VENUE', days: 3 }), 'NOT_FOUND');
  await rejectsWith(w.core.boosts.create(dono, 'v2', { target: 'VENUE', days: 3 }), 'NOT_FOUND');
  await rejectsWith(w.core.boosts.create(dono, 'nao-existe', { target: 'VENUE', days: 3 }), 'NOT_FOUND');
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 2 }), 'VALIDATION');
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: '3' }), 'VALIDATION');
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'OUTRO', days: 3 }), 'VALIDATION');
  assert.equal(w.payments.charges.length, 0, 'pedido inválido não gera cobrança');
  const b = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 3 });
  assert.equal(b.amountCents, 3 * BOOST_DEFAULT_PRICE_PER_DAY_CENTS);
  assert.equal(b.phase, 'PENDING_PAYMENT');
  assert.equal(b.payment?.pixCode, 'PIX-ch_1');
  assert.deepEqual([w.payments.charges[0]?.amountCents, w.payments.charges[0]?.reference], [b.amountCents, b.id]);
});

test('evento: precisa ser do local e ainda não ter terminado', async () => {
  const { w, dono } = await setup();
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'EVENT', days: 1 }), 'VALIDATION');
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'EVENT', eventId: 'e3', days: 1 }), 'NOT_FOUND', 'evento de outro local');
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'EVENT', eventId: 'velho', days: 1 }), 'CONFLICT');
  const b = await w.core.boosts.create(dono, 'v1', { target: 'EVENT', eventId: 'e1', days: 1 });
  assert.equal(b.eventTitle, 'Samba');
});

test('um pedido por vez para o mesmo alvo; cancelar libera de novo, mas só antes de pagar', async () => {
  const { w, dono } = await setup();
  const first = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1 });
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 7 }), 'CONFLICT');
  const other = await w.core.boosts.create(dono, 'v1', { target: 'EVENT', eventId: 'e1', days: 1 });
  assert.notEqual(other.id, first.id, 'outro alvo é outro pedido');
  assert.equal((await w.core.boosts.cancel(dono, first.id)).phase, 'CANCELLED');
  const again = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1 });
  await pay(w, 'ch_3');
  await rejectsWith(w.core.boosts.cancel(dono, again.id), 'CONFLICT');
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1 }), 'CONFLICT', 'ainda impulsionado');
});

test('falha do provedor: nada fica gravado', async () => {
  const { w, dono } = await setup();
  w.payments.failNext = true;
  await assert.rejects(w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1 }));
  assert.deepEqual(await w.core.boosts.list(dono, 'v1'), []);
});

test('pagamento: aviso com assinatura certa libera uma única vez; aviso falso ou de outro estado não', async () => {
  const { w, dono, now } = await setup();
  const b = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 3 });
  assert.deepEqual(await w.core.boosts.handleWebhook({ 'x-signature': 'errada' }, JSON.stringify({ chargeId: 'ch_1', status: 'paid' })), { accepted: false });
  assert.deepEqual(await w.core.boosts.handleWebhook({ 'x-signature': FakePaymentGateway.SECRET }, 'não é json'), { accepted: false });
  assert.equal((await w.core.boosts.list(dono, 'v1'))[0]?.phase, 'PENDING_PAYMENT', 'aviso inválido não paga');
  await w.core.boosts.handleWebhook({ 'x-signature': FakePaymentGateway.SECRET }, JSON.stringify({ chargeId: 'ch_1', status: 'pending' }));
  assert.equal((await w.core.boosts.list(dono, 'v1'))[0]?.phase, 'PENDING_PAYMENT', 'só “pago” libera');
  await pay(w, 'ch_1');
  const paid = (await w.core.boosts.list(dono, 'v1'))[0]!;
  assert.equal(paid.phase, 'ACTIVE');
  assert.equal(paid.payment, null);
  assert.equal(Date.parse(paid.endsAt!) - Date.parse(paid.startsAt!), 3 * DAY);
  assert.equal(Date.parse(paid.startsAt!), now);
  w.clock.tick(DAY);
  await pay(w, 'ch_1'); // aviso repetido
  assert.equal((await w.core.boosts.list(dono, 'v1'))[0]?.startsAt, paid.startsAt, 'repetir não reinicia a contagem');
  assert.deepEqual(await w.core.boosts.confirmCharge('desconhecida'), { confirmed: false });
  assert.equal(b.id, paid.id);
});

test('termina sozinho depois dos dias comprados', async () => {
  const { w, dono } = await setup();
  await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1 });
  await pay(w, 'ch_1');
  assert.equal((await w.core.boosts.list(dono, 'v1'))[0]?.phase, 'ACTIVE');
  w.clock.tick(DAY + 1000);
  assert.equal((await w.core.boosts.list(dono, 'v1'))[0]?.phase, 'ENDED');
  assert.equal((await w.core.boosts.activeTargets(w.clock.now())).boosts.length, 0);
});

test('simular pagamento: só no ambiente de teste e só o dono do pedido', async () => {
  const { w, dono, ana } = await setup();
  const b = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1 });
  await rejectsWith(w.core.boosts.simulatePayment(ana, b.id), 'NOT_FOUND');
  assert.equal((await w.core.boosts.simulatePayment(dono, b.id)).phase, 'ACTIVE');
  const real = makeWorld({ payments: new FakePaymentGateway(false) });
  const u = await real.signUpMany('dono');
  await real.places.createVenue({ id: 'v1', name: 'Bar', address: null, category: 'bar', lat: 0, lng: 0, isSample: false, ownerId: u['dono']! });
  const pedido = await real.core.boosts.create(u['dono']!, 'v1', { target: 'VENUE', days: 1 });
  await rejectsWith(real.core.boosts.simulatePayment(u['dono']!, pedido.id), 'FORBIDDEN');
});

test('Explorar: impulsionados sobem na lista com selo; sem pagamento não muda nada', async () => {
  const { w, dono, ana } = await setup();
  const titles = async () => (await w.core.explore.search(ana, {})).events.map((e) => [e.title, e.sponsored === true]);
  assert.deepEqual(await titles(), [['Samba', false], ['Eletrônica', false], ['Rock', false]]);
  await w.core.boosts.create(dono, 'v1', { target: 'EVENT', eventId: 'e2', days: 1 });
  assert.deepEqual(await titles(), [['Samba', false], ['Eletrônica', false], ['Rock', false]], 'pedido pendente não aparece');
  await pay(w, 'ch_1');
  assert.deepEqual(await titles(), [['Rock', true], ['Samba', false], ['Eletrônica', false]]);
  const view = await w.core.explore.search(ana, { q: 'Bar do Zé' });
  assert.equal(view.places.find((p) => p.name === 'Bar do Zé')?.sponsored, undefined, 'só o evento foi impulsionado');
});

test('Explorar: impulsionar o local marca o local e todos os eventos dele', async () => {
  const { w, dono, ana } = await setup();
  await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1 });
  await pay(w, 'ch_1');
  const events = (await w.core.explore.search(ana, {})).events;
  assert.deepEqual(events.map((e) => [e.title, e.sponsored === true]), [['Samba', true], ['Rock', true], ['Eletrônica', false]]);
  const places = (await w.core.explore.search(ana, { q: 'Bar' })).places;
  assert.equal(places.find((p) => p.name === 'Bar do Zé')?.sponsored, true);
});

test('Home: anúncios só de eventos que ainda não acabaram, sem repetir, e respeitando bloqueio', async () => {
  const { w, dono, outro, ana, bia } = await setup();
  assert.deepEqual((await w.core.explore.sponsored(ana)).events, [], 'sem anúncio, vazio');
  await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1 });
  await pay(w, 'ch_1');
  await w.core.boosts.create(outro, 'v2', { target: 'EVENT', eventId: 'e3', days: 1 });
  await pay(w, 'ch_2');
  const mine = (await w.core.explore.sponsored(ana)).events;
  assert.equal(mine.length, 2);
  assert.ok(mine.every((e) => e.sponsored === true));
  assert.deepEqual(mine.map((e) => e.title).sort(), ['Eletrônica', 'Samba'], 'o local mostra o próximo evento, que ainda não passou');
  await w.core.blocks.block(bia, dono);
  assert.deepEqual((await w.core.explore.sponsored(bia)).events.map((e) => e.title), ['Eletrônica'], 'quem bloqueou o anunciante não vê o anúncio dele');
});
