import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOOST_DEFAULT_PRICE_PER_DAY_CENTS } from './boost-service.ts';
import { FakePaymentGateway, FakeStoreVerifier } from './testing/in-memory.ts';
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
  assert.deepEqual(w.core.boosts.pricing(), {
    currency: 'BRL',
    enabled: true,
    pricePerDayCents: BOOST_DEFAULT_PRICE_PER_DAY_CENTS,
    dayOptions: [1, 3, 7, 14],
    store: { available: false, pricePerDayCents: BOOST_DEFAULT_PRICE_PER_DAY_CENTS, products: { '1': 'askout.boost.1d', '3': 'askout.boost.3d', '7': 'askout.boost.7d', '14': 'askout.boost.14d' } },
    match: { radiusKmOptions: [2, 5, 10, 25], maxTags: 5 },
    sandbox: true,
  });
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

// ---------- Chave geral (pagamentos desligados) ----------

async function setupWith(options: Parameters<typeof makeWorld>[0]) {
  const w = makeWorld(options);
  const u = await w.signUpMany('dono');
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: -23.58, lng: -46.65, isSample: false, ownerId: u['dono']! });
  return { w, dono: u['dono']! };
}

test('desligado: nenhum pedido novo, nenhuma cobrança, e o preço avisa a tela', async () => {
  const { w, dono } = await setupWith({ boostsEnabled: false });
  assert.equal(w.core.boosts.pricing().enabled, false);
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1 }), 'CONFLICT');
  assert.equal(w.payments.charges.length, 0, 'desligado não chega ao provedor');
  assert.deepEqual(await w.core.boosts.list(dono, 'v1'), []);
});

test('desligado: o que já estava pago continua no ar e o aviso de pagamento em andamento ainda é confirmado', async () => {
  // Pedido gravado antes de desligar: o aviso de um pagamento que a pessoa já fez não pode se perder.
  const off = makeWorld({ boostsEnabled: false });
  const u = await off.signUpMany('dono');
  await off.places.createVenue({ id: 'v1', name: 'Bar', address: null, category: 'bar', lat: 0, lng: 0, isSample: false, ownerId: u['dono']! });
  await off.boosts.create({ id: 'pedido-1', venueId: 'v1', channel: 'WEB', ownerId: u['dono']!, target: 'VENUE', eventId: null, days: 1, amountCents: 1500, status: 'PENDING_PAYMENT', chargeId: 'ch_9', payCode: null, payUrl: null, createdAt: off.clock.now(), paidAt: null, startsAt: null, endsAt: null, audience: 'ALL', radiusM: null, matchTags: [] });
  await off.core.boosts.handleWebhook({ 'x-signature': FakePaymentGateway.SECRET }, JSON.stringify({ chargeId: 'ch_9', status: 'paid' }));
  assert.equal((await off.core.boosts.list(u['dono']!, 'v1'))[0]?.phase, 'ACTIVE');
  assert.equal((await off.core.boosts.activeTargets(off.clock.now())).venueIds.has('v1'), true, 'anúncio pago segue valendo');
});

test('desligado: “simular pagamento” também fica bloqueado', async () => {
  const on = await setupWith({});
  const pedido = await on.w.core.boosts.create(on.dono, 'v1', { target: 'VENUE', days: 1 });
  assert.equal(pedido.phase, 'PENDING_PAYMENT');
  const off = await setupWith({ boostsEnabled: false });
  await rejectsWith(off.w.core.boosts.simulatePayment(off.dono, 'qualquer'), 'CONFLICT');
});

// ---------- Valor recebido ----------

test('aviso com valor diferente do pedido não libera o anúncio', async () => {
  const { w, dono } = await setup();
  const b = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 3 });
  const send = (amountCents: number) => w.core.boosts.handleWebhook({ 'x-signature': FakePaymentGateway.SECRET }, JSON.stringify({ chargeId: 'ch_1', status: 'paid', amountCents }));
  await send(100);
  assert.equal((await w.core.boosts.list(dono, 'v1'))[0]?.phase, 'PENDING_PAYMENT', 'valor menor não paga');
  await send(b.amountCents);
  assert.equal((await w.core.boosts.list(dono, 'v1'))[0]?.phase, 'ACTIVE');
});

test('o retorno do provedor volta para a tela de impulsionar do próprio local', async () => {
  const { w, dono } = await setup();
  await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1 });
  assert.equal(w.payments.charges[0]?.returnPath, '/bares/v1/impulsionar');
});

// ---------- Compra dentro do app (App Store / Google Play) ----------

async function setupStore() {
  const store = new FakeStoreVerifier();
  const { w, dono } = await setupWith({ store, storePricePerDayCents: 2000 });
  return { w, dono, store };
}

test('loja: o pedido usa o preço da loja, não cria cobrança e diz qual produto o app deve comprar', async () => {
  const { w, dono } = await setupStore();
  assert.equal(w.core.boosts.pricing().store.available, true);
  const b = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 3, channel: 'APPLE' });
  assert.deepEqual([b.channel, b.amountCents, b.storeProductId, b.payment], ['APPLE', 6000, 'askout.boost.3d', { pixCode: null, checkoutUrl: null }]);
  assert.equal(w.payments.charges.length, 0, 'a loja cobra; o provedor da web não é chamado');
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 3, channel: 'OUTRA' }), 'VALIDATION');
});

test('loja: sem verificador configurado não dá para criar pedido pela loja', async () => {
  const { w, dono } = await setupWith({});
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1, channel: 'GOOGLE' }), 'CONFLICT');
});

test('loja: recibo válido libera uma vez; repetir a chamada devolve o pedido; recibo reaproveitado é recusado', async () => {
  const { w, dono, store } = await setupStore();
  const a = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1, channel: 'APPLE' });
  const receipt = FakeStoreVerifier.receipt('askout.boost.1d', 'T-1');
  const paid = await w.core.boosts.confirmStorePurchase(dono, a.id, { receipt });
  assert.deepEqual([paid.phase, paid.storeProductId], ['ACTIVE', null]);
  assert.equal(store.calls[0]?.store, 'APPLE');
  const again = await w.core.boosts.confirmStorePurchase(dono, a.id, { receipt });
  assert.equal(again.startsAt, paid.startsAt, 'repetir não reinicia a contagem');
  assert.equal(store.calls.length, 1, 'pedido já pago nem consulta a loja de novo');
  w.clock.tick(2 * DAY);
  const c = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1, channel: 'APPLE' });
  await rejectsWith(w.core.boosts.confirmStorePurchase(dono, c.id, { receipt }), 'CONFLICT', 'o mesmo recibo não paga outro pedido');
  assert.equal((await w.core.boosts.list(dono, 'v1')).find((x) => x.id === c.id)?.phase, 'PENDING_PAYMENT');
});

test('loja: recibo falso, de outro produto ou devolvido não libera nada', async () => {
  const { w, dono } = await setupStore();
  const a = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 3, channel: 'GOOGLE' });
  await rejectsWith(w.core.boosts.confirmStorePurchase(dono, a.id, { receipt: 'lixo' }), 'CONFLICT');
  await rejectsWith(w.core.boosts.confirmStorePurchase(dono, a.id, { receipt: FakeStoreVerifier.receipt('askout.boost.1d', 'T-2') }), 'CONFLICT', 'comprou 1 dia, o pedido é de 3');
  await rejectsWith(w.core.boosts.confirmStorePurchase(dono, a.id, { receipt: FakeStoreVerifier.receipt('askout.boost.3d', 'T-3', false) }), 'CONFLICT', 'a loja já devolveu');
  await rejectsWith(w.core.boosts.confirmStorePurchase(dono, a.id, {}), 'VALIDATION');
  await rejectsWith(w.core.boosts.confirmStorePurchase(dono, a.id, { receipt: 'x'.repeat(20_001) }), 'VALIDATION');
  assert.equal((await w.core.boosts.list(dono, 'v1'))[0]?.phase, 'PENDING_PAYMENT');
});

test('loja: só o dono do pedido confirma, e pedido da web não é pago pela loja (nem o contrário)', async () => {
  const { w, dono } = await setupStore();
  const outro = (await w.signUpMany('intruso'))['intruso']!;
  const a = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1, channel: 'APPLE' });
  await rejectsWith(w.core.boosts.confirmStorePurchase(outro, a.id, { receipt: FakeStoreVerifier.receipt('askout.boost.1d', 'T-9') }), 'NOT_FOUND');
  await rejectsWith(w.core.boosts.simulatePayment(dono, a.id), 'CONFLICT', 'pedido da loja não é simulado pela web');
  await w.core.boosts.cancel(dono, a.id);
  const web = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1 });
  await rejectsWith(w.core.boosts.confirmStorePurchase(dono, web.id, { receipt: FakeStoreVerifier.receipt('askout.boost.1d', 'T-10') }), 'CONFLICT');
});

test('loja: com a chave geral desligada, quem já pagou na loja ainda consegue confirmar', async () => {
  const store = new FakeStoreVerifier();
  const { w, dono } = await setupWith({ store });
  const a = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1, channel: 'APPLE' });
  // Desligamento depois do pedido: outro mundo, desligado, com o mesmo pedido já gravado.
  const off = makeWorld({ store, boostsEnabled: false });
  const u = await off.signUpMany('dono');
  await off.places.createVenue({ id: 'v1', name: 'Bar', address: null, category: 'bar', lat: 0, lng: 0, isSample: false, ownerId: u['dono']! });
  await off.boosts.create({ id: a.id, venueId: 'v1', channel: 'APPLE', ownerId: u['dono']!, target: 'VENUE', eventId: null, days: 1, amountCents: 1500, status: 'PENDING_PAYMENT', chargeId: null, payCode: null, payUrl: null, createdAt: off.clock.now(), paidAt: null, startsAt: null, endsAt: null, audience: 'ALL', radiusM: null, matchTags: [] });
  const paid = await off.core.boosts.confirmStorePurchase(u['dono']!, a.id, { receipt: FakeStoreVerifier.receipt('askout.boost.1d', 'T-11') });
  assert.equal(paid.phase, 'ACTIVE');
});
