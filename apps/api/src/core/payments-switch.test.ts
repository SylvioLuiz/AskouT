import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeStoreVerifier } from './testing/in-memory.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

async function setup(options: Parameters<typeof makeWorld>[0] = {}) {
  const w = makeWorld(options);
  const u = await w.signUpMany('adm', 'dono', 'ana');
  const adm = u['adm']!, dono = u['dono']!, ana = u['ana']!;
  w.users.users.set(adm, { ...w.users.users.get(adm)!, role: 'ADMIN' });
  const A = { userId: adm, role: 'ADMIN' as const };
  const U = (id: string) => ({ userId: id, role: 'USER' as const });
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: -23.58, lng: -46.65, isSample: false, ownerId: dono });
  return { w, A, U, adm, dono, ana };
}

test('começa pelo valor da configuração e só a gestão enxerga e muda a chave', async () => {
  const { w, A, U, ana } = await setup({ boostsEnabled: false });
  assert.deepEqual(
    await w.core.admin.payments(A),
    {
      enabled: false,
      chosen: null,
      initial: false,
      provider: 'stripe',
      canEnable: true,
      blocker: null,
      storeAvailable: false,
      stores: { apple: false, google: false },
      offeredDays: [1, 3, 7, 14],
      packages: [1, 3, 7, 14].map((days) => ({ days, productId: `askout.boost.${days}d` })),
      updatedAt: null,
      updatedBy: null,
    },
  );
  await rejectsWith(w.core.admin.payments(U(ana)), 'FORBIDDEN');
  await rejectsWith(w.core.admin.setPayments(U(ana), true, null), 'FORBIDDEN');
  await rejectsWith(w.core.admin.setPayments(A, 'sim', null), 'VALIDATION');
  await rejectsWith(w.core.admin.setPayments(A, true, 'x'.repeat(301)), 'VALIDATION');
});

test('ligar pelo painel vale na hora para pedidos novos, e desligar bloqueia sem derrubar o que já foi pago', async () => {
  const { w, A, dono } = await setup({ boostsEnabled: false });
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1 }), 'CONFLICT');

  const on = await w.core.admin.setPayments(A, true, 'Lançamento nas lojas');
  assert.deepEqual([on.enabled, on.chosen, on.updatedBy], [true, true, 'adm']);
  assert.equal((await w.core.boosts.pricing()).enabled, true);
  const pedido = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1 });
  await w.core.boosts.handleWebhook({ 'x-signature': 'segredo-de-teste' }, JSON.stringify({ chargeId: 'ch_1', status: 'paid' }));

  const off = await w.core.admin.setPayments(A, false, null);
  assert.deepEqual([off.enabled, off.chosen], [false, false]);
  assert.equal((await w.core.boosts.pricing()).enabled, false);
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'EVENT', eventId: 'x', days: 1 }), 'CONFLICT');
  const lista = await w.core.boosts.list(dono, 'v1');
  assert.deepEqual([lista[0]?.id, lista[0]?.phase], [pedido.id, 'ACTIVE'], 'o anúncio pago continua no ar');
});

test('o que a gestão escolhe vale mais que a configuração inicial', async () => {
  const { w, A } = await setup({ boostsEnabled: true });
  assert.equal((await w.core.admin.payments(A)).enabled, true, 'sem escolha, vale o inicial');
  const off = await w.core.admin.setPayments(A, false, null);
  assert.deepEqual([off.enabled, off.initial, off.chosen], [false, true, false]);
  assert.equal((await w.core.boosts.pricing()).enabled, false);
});

test('repetir o mesmo estado é recusado em vez de gravar à toa', async () => {
  const { w, A } = await setup({ boostsEnabled: false });
  await rejectsWith(w.core.admin.setPayments(A, false, null), 'CONFLICT');
  await w.core.admin.setPayments(A, true, null);
  await rejectsWith(w.core.admin.setPayments(A, true, null), 'CONFLICT');
});

test('sem provedor de pagamento não dá para ligar, e uma escolha antiga de ligar deixa de valer', async () => {
  const { w, A, dono } = await setup({ boostsEnabled: false });
  await w.core.admin.setPayments(A, true, null);
  w.payments.provider = 'none';
  const state = await w.core.admin.payments(A);
  assert.deepEqual([state.enabled, state.chosen, state.canEnable], [false, true, false]);
  assert.match(state.blocker ?? '', /APPLE_APP_ID/);
  assert.equal((await w.core.boosts.pricing()).enabled, false);
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1 }), 'CONFLICT');

  const other = await setup({ boostsEnabled: false });
  other.w.payments.provider = 'none';
  await rejectsWith(other.w.core.admin.setPayments(other.A, true, null), 'CONFLICT');
  assert.equal((await other.w.core.admin.payments(other.A)).chosen, null, 'recusado não grava nada');
});

test('cada mudança fica na auditoria, com quem fez e o motivo', async () => {
  const { w, A, adm } = await setup({ boostsEnabled: false });
  await w.core.admin.setPayments(A, true, 'Abrindo');
  await w.core.admin.setPayments(A, false, null);
  const rows = (await w.core.admin.audit(A, {})).items;
  assert.deepEqual(rows.map((r) => [r.action, r.targetType, r.targetId, r.note, r.adminId]), [
    ['PAYMENTS_DISABLED', 'SETTING', 'payments', null, adm],
    ['PAYMENTS_ENABLED', 'SETTING', 'payments', 'Abrindo', adm],
  ]);
});

test('sem provedor na web, a compra pelas lojas basta para ligar: o app vende e o site orienta a comprar pelo app', async () => {
  const { w, A, dono } = await setup({ boostsEnabled: false, store: new FakeStoreVerifier() });
  w.payments.provider = 'none';
  const before = await w.core.admin.payments(A);
  assert.deepEqual([before.canEnable, before.blocker, before.storeAvailable, before.stores], [true, null, true, { apple: true, google: true }]);
  const on = await w.core.admin.setPayments(A, true, 'Venda pelas lojas');
  assert.equal(on.enabled, true);
  const price = await w.core.boosts.pricing();
  assert.deepEqual([price.enabled, price.web.available, price.store.available], [true, false, true]);
  const pedido = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 3, channel: 'APPLE' });
  assert.deepEqual([pedido.channel, pedido.storeProductId, pedido.phase], ['APPLE', 'askout.boost.3d', 'PENDING_PAYMENT']);
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'EVENT', eventId: 'x', days: 3 }), 'CONFLICT');
});

test('só a loja que tem conferente aparece como disponível', async () => {
  const store = new FakeStoreVerifier() as FakeStoreVerifier & { supports(s: string): boolean };
  store.supports = (s: string) => s === 'APPLE';
  const { w, A, dono } = await setup({ boostsEnabled: true, store });
  w.payments.provider = 'none';
  assert.deepEqual((await w.core.admin.payments(A)).stores, { apple: true, google: false });
  const price = await w.core.boosts.pricing();
  assert.deepEqual([price.store.apple, price.store.google], [true, false]);
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1, channel: 'GOOGLE' }), 'CONFLICT');
});

test('a gestão escolhe quais pacotes ficam à venda, e isso vale na hora para pedidos novos', async () => {
  const { w, A, U, ana, dono, adm } = await setup({ boostsEnabled: true });
  await rejectsWith(w.core.admin.setBoostDays(U(ana), [1], null), 'FORBIDDEN');
  await rejectsWith(w.core.admin.setBoostDays(A, [], null), 'VALIDATION');
  await rejectsWith(w.core.admin.setBoostDays(A, [2], null), 'VALIDATION');
  await rejectsWith(w.core.admin.setBoostDays(A, 'todos', null), 'VALIDATION');
  const st = await w.core.admin.setBoostDays(A, [7, 1, 7], 'Teste de pacotes');
  assert.deepEqual(st.offeredDays, [1, 7]);
  assert.deepEqual((await w.core.boosts.pricing()).dayOptions, [1, 7]);
  await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 3 }), 'VALIDATION');
  const ok = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 7 });
  assert.equal(ok.days, 7);
  const rows = (await w.core.admin.audit(A, {})).items;
  assert.deepEqual([rows[0]?.action, rows[0]?.targetId, rows[0]?.note, rows[0]?.adminId], ['BOOST_PACKAGES_UPDATED', 'boost.days', '1, 7 dias. Teste de pacotes', adm]);
});
