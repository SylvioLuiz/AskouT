import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { StripePaymentGateway, type StoreFetch } from './stripe-payment-gateway.ts';

const WEBHOOK = 'whsec_teste123';
const NOW = 1_800_000_000;

function sign(body: string, t = NOW, secret = WEBHOOK): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

function make(fetch?: StoreFetch) {
  return new StripePaymentGateway({ secretKey: 'sk_test_abc', webhookSecret: WEBHOOK, webBaseUrl: 'https://askout.com.br/', ...(fetch ? { fetch } : {}), nowSeconds: () => NOW });
}

const event = (type: string, object: Record<string, unknown>) => JSON.stringify({ type, data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 4500, currency: 'brl', ...object } } });

describe('StripePaymentGateway', () => {
  it('cria a sessão de pagamento com Pix e cartão, em reais, e devolve o link', async () => {
    const calls: { url: string; headers: Record<string, string>; body: URLSearchParams }[] = [];
    const gateway = make(async (url, init) => {
      calls.push({ url, headers: init.headers, body: new URLSearchParams(init.body) });
      return { ok: true, status: 200, json: async () => ({ id: 'cs_9', url: 'https://checkout.stripe.com/c/pay/cs_9' }) };
    });
    const charge = await gateway.createCharge({ reference: 'ped-1', amountCents: 4500, description: 'Impulsionamento de Bar', returnPath: '/bares/v1/impulsionar' });
    assert.deepEqual(charge, { chargeId: 'cs_9', pixCode: null, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_9' });
    const call = calls[0]!;
    assert.equal(call.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(call.headers['Authorization'], 'Bearer sk_test_abc');
    assert.equal(call.headers['Idempotency-Key'], 'askout-boost-ped-1');
    assert.deepEqual(call.body.getAll('payment_method_types[]'), ['card', 'pix']);
    assert.equal(call.body.get('line_items[0][price_data][currency]'), 'brl');
    assert.equal(call.body.get('line_items[0][price_data][unit_amount]'), '4500');
    assert.equal(call.body.get('client_reference_id'), 'ped-1');
    assert.equal(call.body.get('success_url'), 'https://askout.com.br/bares/v1/impulsionar?pagamento=ok');
    assert.equal(call.body.get('cancel_url'), 'https://askout.com.br/bares/v1/impulsionar?pagamento=cancelado');
  });

  it('só aceita caminho de retorno do próprio site', async () => {
    let body = new URLSearchParams();
    const gateway = make(async (_url, init) => {
      body = new URLSearchParams(init.body);
      return { ok: true, status: 200, json: async () => ({ id: 'cs_9', url: 'https://checkout.stripe.com/x' }) };
    });
    await gateway.createCharge({ reference: 'r', amountCents: 1500, description: 'd', returnPath: 'https://malicioso.com/x' });
    assert.equal(body.get('success_url'), 'https://askout.com.br/?pagamento=ok');
  });

  it('erro da Stripe ou rede fora do ar vira mensagem amigável, sem vazar detalhes', async () => {
    const down = make(async () => ({ ok: false, status: 402, json: async () => ({ error: { message: 'segredo interno' } }) }));
    await assert.rejects(down.createCharge({ reference: 'r', amountCents: 1500, description: 'd' }), (e: Error) => e.message.includes('Não foi possível iniciar o pagamento') && !e.message.includes('segredo'));
    const offline = make(async () => { throw new Error('ECONNRESET'); });
    await assert.rejects(offline.createCharge({ reference: 'r', amountCents: 1500, description: 'd' }), /Não foi possível iniciar o pagamento/);
    const weird = make(async () => ({ ok: true, status: 200, json: async () => ({ ok: 1 }) }));
    await assert.rejects(weird.createCharge({ reference: 'r', amountCents: 1500, description: 'd' }), /Não foi possível iniciar o pagamento/);
  });

  it('aviso com assinatura certa e sessão paga em reais: pago, com o valor recebido', async () => {
    const body = event('checkout.session.completed', {});
    assert.deepEqual(await make().parseWebhook({ 'stripe-signature': sign(body) }, body), { chargeId: 'cs_1', paid: true, amountCents: 4500 });
    const pix = event('checkout.session.async_payment_succeeded', {});
    assert.equal((await make().parseWebhook({ 'stripe-signature': sign(pix) }, pix))?.paid, true, 'Pix confirma depois');
  });

  it('Pix ainda não pago, falha ou outra moeda: não libera', async () => {
    const pending = event('checkout.session.completed', { payment_status: 'unpaid' });
    assert.equal((await make().parseWebhook({ 'stripe-signature': sign(pending) }, pending))?.paid, false);
    const failed = event('checkout.session.async_payment_failed', {});
    assert.equal((await make().parseWebhook({ 'stripe-signature': sign(failed) }, failed))?.paid, false);
    const usd = event('checkout.session.completed', { currency: 'usd' });
    assert.equal((await make().parseWebhook({ 'stripe-signature': sign(usd) }, usd))?.paid, false);
  });

  it('assinatura inválida, ausente, adulterada, vencida ou de outro segredo: recusa', async () => {
    const body = event('checkout.session.completed', {});
    const g = make();
    assert.equal(await g.parseWebhook({}, body), undefined);
    assert.equal(await g.parseWebhook({ 'stripe-signature': 'lixo' }, body), undefined);
    assert.equal(await g.parseWebhook({ 'stripe-signature': sign(body, NOW, 'whsec_outro') }, body), undefined);
    assert.equal(await g.parseWebhook({ 'stripe-signature': sign(body) }, body.replace('4500', '1')), undefined, 'corpo alterado');
    assert.equal(await g.parseWebhook({ 'stripe-signature': sign(body, NOW - 301) }, body), undefined, 'aviso antigo reenviado');
    assert.equal(await g.parseWebhook({ 'stripe-signature': sign(body, NOW + 301) }, body), undefined, 'data do futuro');
    assert.equal(await g.parseWebhook({ 'stripe-signature': `t=${NOW},v1=${'a'.repeat(10)}` }, body), undefined, 'assinatura curta');
    assert.ok(await g.parseWebhook({ 'stripe-signature': `${sign(body)},v1=${'0'.repeat(64)}` }, body), 'basta uma das assinaturas bater (troca de segredo)');
  });

  it('evento que não é de sessão de pagamento, ou sem id, é ignorado', async () => {
    const other = JSON.stringify({ type: 'customer.created', data: { object: { id: 'cus_1' } } });
    assert.equal(await make().parseWebhook({ 'stripe-signature': sign(other) }, other), undefined);
    const noId = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
    assert.equal(await make().parseWebhook({ 'stripe-signature': sign(noId) }, noId), undefined);
    assert.equal(await make().parseWebhook({ 'stripe-signature': sign('não é json') }, 'não é json'), undefined);
  });
});
