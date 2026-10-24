import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buyInStore, packageSummary, packageTotalCents, paymentReturn, pricePerDayCents, purchaseChannel, safePaymentUrl, StoreUnavailableError } from './purchase.ts';

const pricing = { pricePerDayCents: 1500, packagePricesCents: { '1': 1500, '3': 3500 }, store: { available: true, pricePerDayCents: 2000, packagePricesCents: { '1': 2000, '3': 5000 }, products: {} } };

describe('pagamento do impulsionamento (web)', () => {
  it('no site paga por Pix/cartão; nas lojas, pela compra do aplicativo', () => {
    assert.equal(purchaseChannel({}), 'WEB');
    assert.equal(purchaseChannel({ Capacitor: { getPlatform: () => 'web' } }), 'WEB');
    assert.equal(purchaseChannel({ Capacitor: { getPlatform: () => 'ios' } }), 'APPLE');
    assert.equal(purchaseChannel({ Capacitor: { getPlatform: () => 'android' } }), 'GOOGLE');
    assert.equal(purchaseChannel({ Capacitor: { getPlatform: () => { throw new Error('x'); } } }), 'WEB', 'falha ao perguntar a plataforma cai no site');
  });

  it('usa o preço do canal', () => {
    assert.equal(pricePerDayCents(pricing, 'WEB'), 1500);
    assert.equal(pricePerDayCents(pricing, 'APPLE'), 2000);
    assert.equal(pricePerDayCents(pricing, 'GOOGLE'), 2000);
  });

  it('sem a casca nativa a compra pela loja avisa em vez de fingir', async () => {
    await assert.rejects(buyInStore('askout.boost.1d', {}), StoreUnavailableError);
  });

  it('com a casca nativa devolve o recibo da loja', async () => {
    const asked: string[] = [];
    const env = { AskouTStore: { purchase: async (id: string) => { asked.push(id); return 'recibo-123'; } } };
    assert.equal(await buyInStore('askout.boost.3d', env), 'recibo-123');
    assert.deepEqual(asked, ['askout.boost.3d']);
    await assert.rejects(buyInStore('askout.boost.3d', { AskouTStore: { purchase: async () => '' } }), /não devolveu o recibo/);
  });

  it('só abre link de pagamento https', () => {
    assert.equal(safePaymentUrl('https://checkout.stripe.com/c/pay/x'), 'https://checkout.stripe.com/c/pay/x');
    assert.equal(safePaymentUrl('http://exemplo.com'), undefined);
    assert.equal(safePaymentUrl('javascript:alert(1)'), undefined);
    assert.equal(safePaymentUrl('não é url'), undefined);
    assert.equal(safePaymentUrl(null), undefined);
  });

  it('entende a volta do provedor', () => {
    assert.equal(paymentReturn('?pagamento=ok'), 'ok');
    assert.equal(paymentReturn('?pagamento=cancelado'), 'cancelado');
    assert.equal(paymentReturn('?pagamento=outro'), undefined);
    assert.equal(paymentReturn(''), undefined);
  });
});

describe('pacotes com desconto', () => {
  it('usa o preço do pacote por canal e calcula o desconto', () => {
    assert.equal(packageTotalCents(pricing, 'WEB', 3), 3500);
    assert.equal(packageTotalCents(pricing, 'APPLE', 3), 5000);
    assert.deepEqual(packageSummary(pricing, 'WEB', 3), { total: 3500, perDay: 1167, discountPct: 22 });
    assert.equal(packageSummary(pricing, 'WEB', 1).discountPct, 0);
  });
  it('sem tabela de pacotes (resposta antiga) cobra dias × valor por dia', () => {
    const old = { pricePerDayCents: 1500, store: { available: false, pricePerDayCents: 1500, products: {} } } as unknown as Parameters<typeof packageTotalCents>[0];
    assert.equal(packageTotalCents(old, 'WEB', 7), 10500);
  });
});
