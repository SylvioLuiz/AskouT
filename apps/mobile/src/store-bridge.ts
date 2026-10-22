/**
 * Ponte `window.AskouTStore`: abre a compra da App Store / Google Play e devolve o recibo para o servidor conferir.
 * iOS: transação assinada (JWS do StoreKit 2; recibo antigo só se faltar). Android: token de compra do Google Play.
 * O impulsionamento é consumível: o Google consome o token logo após a compra (o servidor ainda consegue conferi-lo).
 */

export interface PurchasesLike {
  purchaseProduct(o: { productIdentifier: string; productType: 'inapp'; isConsumable: boolean; quantity: number }): Promise<{
    jwsRepresentation?: string;
    receipt?: string;
    purchaseToken?: string;
  }>;
}

export function createStoreBridge(deps: { purchases: PurchasesLike; platform: () => string }) {
  return {
    async purchase(productId: string): Promise<string> {
      const tx = await deps.purchases.purchaseProduct({ productIdentifier: productId, productType: 'inapp', isConsumable: true, quantity: 1 });
      const receipt = deps.platform() === 'ios' ? (tx.jwsRepresentation ?? tx.receipt) : tx.purchaseToken;
      if (!receipt) throw new Error('A loja não devolveu o recibo da compra.');
      return receipt;
    },
  };
}
