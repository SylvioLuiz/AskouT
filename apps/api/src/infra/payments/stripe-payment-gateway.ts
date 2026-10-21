import { createHmac, timingSafeEqual } from 'node:crypto';
import { conflict } from '../../core/errors.ts';
import type { PaymentCharge, PaymentGateway } from '../../core/ports.ts';

/** Tempo máximo entre a assinatura do aviso e agora. Evita que um aviso antigo capturado seja reenviado. */
const TOLERANCE_SECONDS = 300;

const API = 'https://api.stripe.com/v1';

export interface StoreFetch {
  (url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}

export interface StripeOptions {
  /** Chave secreta (sk_live_… em produção, sk_test_… para teste). Nunca vai para o navegador. */
  secretKey: string;
  /** Segredo de assinatura do webhook (whsec_…). */
  webhookSecret: string;
  /** Endereço público do site (https://…), para a pessoa voltar depois de pagar. */
  webBaseUrl: string;
  fetch?: StoreFetch;
  /** Relógio em segundos, para testar a tolerância. */
  nowSeconds?: () => number;
}

/**
 * Pix e cartão pela página de pagamento hospedada da Stripe (Checkout).
 * O AskouT nunca vê nem guarda número de cartão: a pessoa paga na página da Stripe e só recebemos o aviso assinado.
 * Escrito conforme a documentação da Stripe, mas ainda NÃO exercitado contra a conta real (ver GOLIVE.md).
 */
export class StripePaymentGateway implements PaymentGateway {
  readonly sandbox = false;
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly webBaseUrl: string;
  private readonly fetchImpl: StoreFetch;
  private readonly nowSeconds: () => number;

  constructor(options: StripeOptions) {
    this.secretKey = options.secretKey;
    this.webhookSecret = options.webhookSecret;
    this.webBaseUrl = options.webBaseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  async createCharge(input: { reference: string; amountCents: number; description: string; returnPath?: string }): Promise<PaymentCharge> {
    const back = `${this.webBaseUrl}${input.returnPath && input.returnPath.startsWith('/') ? input.returnPath : '/'}`;
    const form = new URLSearchParams();
    form.set('mode', 'payment');
    form.set('client_reference_id', input.reference);
    form.set('success_url', `${back}?pagamento=ok`);
    form.set('cancel_url', `${back}?pagamento=cancelado`);
    form.append('payment_method_types[]', 'card');
    form.append('payment_method_types[]', 'pix');
    form.set('line_items[0][quantity]', '1');
    form.set('line_items[0][price_data][currency]', 'brl');
    form.set('line_items[0][price_data][unit_amount]', String(input.amountCents));
    form.set('line_items[0][price_data][product_data][name]', input.description.slice(0, 250));
    let res;
    try {
      res = await this.fetchImpl(`${API}/checkout/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // Repetir o mesmo pedido não cria uma segunda cobrança.
          'Idempotency-Key': `askout-boost-${input.reference}`,
        },
        body: form.toString(),
      });
    } catch {
      throw conflict('Não foi possível iniciar o pagamento agora. Tente novamente em instantes.');
    }
    const body = (await res.json().catch(() => undefined)) as { id?: unknown; url?: unknown } | undefined;
    if (!res.ok || typeof body?.id !== 'string' || typeof body.url !== 'string') {
      throw conflict('Não foi possível iniciar o pagamento agora. Tente novamente em instantes.');
    }
    return { chargeId: body.id, pixCode: null, checkoutUrl: body.url };
  }

  async parseWebhook(headers: Record<string, string | undefined>, rawBody: string): Promise<{ chargeId: string; paid: boolean; amountCents?: number } | undefined> {
    if (!this.signatureIsValid(headers['stripe-signature'], rawBody)) return undefined;
    let event: { type?: unknown; data?: { object?: { id?: unknown; payment_status?: unknown; amount_total?: unknown; currency?: unknown } } };
    try {
      event = JSON.parse(rawBody) as typeof event;
    } catch {
      return undefined;
    }
    const session = event.data?.object;
    if (typeof event.type !== 'string' || !event.type.startsWith('checkout.session.') || typeof session?.id !== 'string') return undefined;
    // Pix é pago depois (async_payment_succeeded); cartão já vem pago em completed. Só vale se estiver “paid” e em reais.
    const paidEvent = event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded';
    const paid = paidEvent && session.payment_status === 'paid' && session.currency === 'brl';
    return { chargeId: session.id, paid, ...(typeof session.amount_total === 'number' ? { amountCents: session.amount_total } : {}) };
  }

  /** Cabeçalho `Stripe-Signature: t=…,v1=…`: HMAC-SHA256 de `t.corpo`, comparado em tempo constante e dentro da tolerância. */
  private signatureIsValid(header: string | undefined, rawBody: string): boolean {
    if (!header) return false;
    let timestamp: string | undefined;
    const signatures: string[] = [];
    for (const part of header.split(',')) {
      const eq = part.indexOf('=');
      if (eq < 1) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key === 't') timestamp = value;
      else if (key === 'v1') signatures.push(value);
    }
    if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return false;
    if (Math.abs(this.nowSeconds() - Number(timestamp)) > TOLERANCE_SECONDS) return false;
    const expected = createHmac('sha256', this.webhookSecret).update(`${timestamp}.${rawBody}`).digest();
    return signatures.some((sig) => {
      if (!/^[0-9a-f]{64}$/i.test(sig)) return false;
      return timingSafeEqual(expected, Buffer.from(sig, 'hex'));
    });
  }
}
