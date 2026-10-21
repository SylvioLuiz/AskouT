import type { BoostChannel, BoostPricing } from './types.ts';

/**
 * Por onde esta cópia do AskouT paga. No site é Pix/cartão (WEB). Dentro do aplicativo das lojas
 * (casca Capacitor), a Apple e o Google exigem a compra da própria loja para bens digitais como o impulsionamento.
 */
export function purchaseChannel(env: { Capacitor?: { getPlatform?: () => string } } = globalThis as never): BoostChannel {
  let platform: string | undefined;
  try {
    platform = env.Capacitor?.getPlatform?.();
  } catch {
    platform = undefined;
  }
  return platform === 'ios' ? 'APPLE' : platform === 'android' ? 'GOOGLE' : 'WEB';
}

export const STORE_LABEL: Record<Exclude<BoostChannel, 'WEB'>, string> = { APPLE: 'App Store', GOOGLE: 'Google Play' };

/**
 * Contrato com a casca nativa: `window.AskouTStore.purchase(produto)` abre a compra da loja e devolve o recibo
 * (iOS: transação assinada; Android: token de compra). Quem escreve a casca nativa implementa este objeto.
 */
export interface StoreBridge {
  purchase(productId: string): Promise<string>;
}

export function storeBridge(env: { AskouTStore?: StoreBridge } = globalThis as never): StoreBridge | undefined {
  const bridge = env.AskouTStore;
  return bridge && typeof bridge.purchase === 'function' ? bridge : undefined;
}

export class StoreUnavailableError extends Error {
  constructor() {
    super('A compra pelo aplicativo ainda não está disponível nesta versão.');
    this.name = 'StoreUnavailableError';
  }
}

/** Abre a compra da loja e devolve o recibo para o servidor conferir. */
export async function buyInStore(productId: string, env?: { AskouTStore?: StoreBridge }): Promise<string> {
  const bridge = storeBridge(env);
  if (!bridge) throw new StoreUnavailableError();
  const receipt = await bridge.purchase(productId);
  if (typeof receipt !== 'string' || receipt === '') throw new Error('A loja não devolveu o recibo da compra. Se o valor foi cobrado, toque em “Concluir compra”.');
  return receipt;
}

/** Valor por dia neste canal: na loja costuma ser maior por causa da comissão. */
export function pricePerDayCents(pricing: Pick<BoostPricing, 'pricePerDayCents' | 'store'>, channel: BoostChannel): number {
  return channel === 'WEB' ? pricing.pricePerDayCents : pricing.store.pricePerDayCents;
}

/** Só o endereço https é aberto: o link de pagamento vem do servidor, mas não confiamos em outro esquema. */
export function safePaymentUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Resultado da volta do provedor de pagamento (`?pagamento=ok` ou `cancelado`). */
export function paymentReturn(search: string): 'ok' | 'cancelado' | undefined {
  const value = new URLSearchParams(search).get('pagamento');
  return value === 'ok' || value === 'cancelado' ? value : undefined;
}
