import { randomBytes } from 'node:crypto';
import { conflict } from '../../core/errors.ts';
import type { PaymentCharge, PaymentGateway } from '../../core/ports.ts';

/**
 * Pagamento de TESTE (desenvolvimento): não cobra nada nem fala com nenhum banco.
 * O “Pix” gerado é só um texto de mentira e o pedido é pago pelo botão “simular pagamento”.
 */
export class SandboxPaymentGateway implements PaymentGateway {
  readonly provider = 'sandbox' as const;
  readonly sandbox = true;

  async createCharge(input: { reference: string; amountCents: number; description: string }): Promise<PaymentCharge> {
    const chargeId = `sandbox_${randomBytes(8).toString('hex')}`;
    return { chargeId, pixCode: `PIX-DE-TESTE-${input.reference.slice(0, 8)}-${input.amountCents}`, checkoutUrl: null };
  }

  async parseWebhook(): Promise<undefined> {
    return undefined;
  }
}

/** Sem provedor configurado: recusa criar cobrança em vez de fingir que cobrou. */
export class UnconfiguredPaymentGateway implements PaymentGateway {
  readonly provider = 'none' as const;
  readonly sandbox = false;

  async createCharge(): Promise<PaymentCharge> {
    throw conflict('O pagamento ainda não está disponível. Tente novamente mais tarde.');
  }

  async parseWebhook(): Promise<undefined> {
    return undefined;
  }
}
