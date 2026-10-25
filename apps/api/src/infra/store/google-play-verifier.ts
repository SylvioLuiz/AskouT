import type { StoreName, StorePurchaseVerifier, VerifiedStorePurchase } from '../../core/ports.ts';
import type { FetchLike, GoogleAccessTokens } from '../google/service-account.ts';

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

export interface GoogleVerifierOptions {
  /** Nome do pacote do app no Google Play (ex.: br.com.askout). */
  packageName: string;
  tokens: Pick<GoogleAccessTokens, 'get'>;
  fetch?: FetchLike;
}

/**
 * Confere a compra do Google Play perguntando à API do Google (Android Publisher, `purchases.products.get`).
 * O recibo que o app manda é um JSON `{"productId": "...", "purchaseToken": "..."}`. Só vale compra feita (purchaseState 0)
 * e sem cancelamento/devolução. O que NÃO foi testado: a chamada real ao Google (precisa do app publicado em teste, da conta de
 * serviço convidada no Play Console e de uma compra de teste).
 */
export class GooglePlayPurchaseVerifier implements StorePurchaseVerifier {
  private readonly options: GoogleVerifierOptions;
  private readonly fetcher: FetchLike;

  constructor(options: GoogleVerifierOptions) {
    this.options = options;
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  }

  async verify(input: { store: StoreName; receipt: string }): Promise<VerifiedStorePurchase | undefined> {
    if (input.store !== 'GOOGLE' || input.receipt.length > 4_000) return undefined;
    let productId: unknown;
    let purchaseToken: unknown;
    try {
      const parsed: unknown = JSON.parse(input.receipt);
      if (!parsed || typeof parsed !== 'object') return undefined;
      ({ productId, purchaseToken } = parsed as Record<string, unknown>);
    } catch {
      return undefined;
    }
    if (typeof productId !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(productId)) return undefined;
    if (typeof purchaseToken !== 'string' || !/^[A-Za-z0-9._-]{10,1000}$/.test(purchaseToken)) return undefined;

    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(this.options.packageName)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
    try {
      let response = await this.fetcher(url, { method: 'GET', headers: { authorization: `Bearer ${await this.options.tokens.get(SCOPE)}` } });
      if (response.status === 401) response = await this.fetcher(url, { method: 'GET', headers: { authorization: `Bearer ${await this.options.tokens.get(SCOPE, true)}` } });
      if (response.status !== 200) return undefined;
      const body = JSON.parse(await response.text()) as { purchaseState?: unknown; orderId?: unknown; purchaseType?: unknown; refundableQuantity?: unknown };
      // purchaseState: 0 comprada, 1 cancelada, 2 pendente. Só 0 libera. Compra de teste (purchaseType 0) é aceita: a revisão do Google usa testadores.
      const active = body.purchaseState === 0;
      const transactionId = typeof body.orderId === 'string' && body.orderId !== '' ? body.orderId : purchaseToken;
      return { productId, transactionId, active };
    } catch {
      return undefined;
    }
  }
}

/** Escolhe quem confere pela loja do pedido (APPLE ou GOOGLE). Loja sem conferente configurado: recusa. */
export class StorePurchaseRouter implements StorePurchaseVerifier {
  private readonly verifiers: Partial<Record<StoreName, StorePurchaseVerifier>>;
  constructor(verifiers: Partial<Record<StoreName, StorePurchaseVerifier>>) {
    this.verifiers = verifiers;
  }
  supports(store: StoreName): boolean {
    return this.verifiers[store] !== undefined;
  }
  async verify(input: { store: StoreName; receipt: string }): Promise<VerifiedStorePurchase | undefined> {
    return this.verifiers[input.store]?.verify(input);
  }
}
