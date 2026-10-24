import { verify as verifySignature, X509Certificate } from 'node:crypto';
import type { StoreName, StorePurchaseVerifier, VerifiedStorePurchase } from '../../core/ports.ts';

/** Impressão digital (SHA-256) do certificado raiz "Apple Root CA - G3", que assina as transações do StoreKit 2. */
export const APPLE_ROOT_CA_G3_SHA256 = '63:34:3A:BF:B8:9E:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79';

export interface AppleVerifierOptions {
  /** Bundle id do app na Apple (ex.: br.com.askout). A transação precisa ser desse app. */
  bundleId: string;
  /** Aceita compras do ambiente de teste (Sandbox/TestFlight). A revisão da Apple compra em Sandbox. */
  acceptSandbox?: boolean;
  /** Só para teste: troca a raiz de confiança. */
  rootFingerprint?: string;
  now?: () => Date;
}

const b64urlJson = (part: string): Record<string, unknown> | undefined => {
  try {
    const v: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Confere a transação assinada (JWS) do StoreKit 2 que o app envia como recibo, sem falar com a Apple:
 * 1) a assinatura ES256 bate com o certificado da folha; 2) a cadeia de certificados (x5c) termina na raiz da Apple
 * (impressão digital fixa) e está dentro da validade; 3) a transação é deste app, é produto consumível e não foi devolvida.
 * O Google Play não é conferido aqui: devolve `undefined` (a compra pelo Android continua desligada).
 */
export class AppleJwsPurchaseVerifier implements StorePurchaseVerifier {
  private readonly now: () => Date;
  private readonly options: AppleVerifierOptions;
  constructor(options: AppleVerifierOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
  }

  async verify(input: { store: StoreName; receipt: string }): Promise<VerifiedStorePurchase | undefined> {
    if (input.store !== 'APPLE' || input.receipt.length > 20_000) return undefined;
    const parts = input.receipt.split('.');
    if (parts.length !== 3) return undefined;
    const [h, p, s] = parts as [string, string, string];
    const header = b64urlJson(h);
    const payload = b64urlJson(p);
    if (!header || !payload || header['alg'] !== 'ES256' || !Array.isArray(header['x5c']) || header['x5c'].length < 2 || header['x5c'].length > 5) return undefined;

    let certs: X509Certificate[];
    try {
      certs = (header['x5c'] as unknown[]).map((c) => {
        if (typeof c !== 'string') throw new Error('x5c');
        return new X509Certificate(Buffer.from(c, 'base64'));
      });
    } catch {
      return undefined;
    }
    if (!this.chainIsTrusted(certs)) return undefined;

    let ok = false;
    try {
      const leaf = certs[0] as X509Certificate;
      ok = verifySignature('SHA256', Buffer.from(`${h}.${p}`), { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
    } catch {
      return undefined;
    }
    if (!ok) return undefined;

    if (payload['bundleId'] !== this.options.bundleId) return undefined;
    const env = payload['environment'];
    if (env !== 'Production' && !(env === 'Sandbox' && (this.options.acceptSandbox ?? true))) return undefined;
    const productId = payload['productId'];
    const transactionId = payload['transactionId'];
    if (typeof productId !== 'string' || productId === '') return undefined;
    if ((typeof transactionId !== 'string' && typeof transactionId !== 'number') || String(transactionId) === '') return undefined;
    // Devolvida pela Apple (reembolso): `revocationDate` preenchido.
    const active = payload['revocationDate'] === undefined || payload['revocationDate'] === null;
    return { productId, transactionId: String(transactionId), active };
  }

  private chainIsTrusted(certs: X509Certificate[]): boolean {
    const nowMs = this.now().getTime();
    for (const c of certs) {
      if (Date.parse(c.validFrom) > nowMs || Date.parse(c.validTo) < nowMs) return false;
    }
    for (let i = 0; i < certs.length - 1; i += 1) {
      const child = certs[i] as X509Certificate;
      const parent = certs[i + 1] as X509Certificate;
      if (!child.verify(parent.publicKey)) return false;
    }
    const root = certs[certs.length - 1] as X509Certificate;
    return root.fingerprint256.toUpperCase() === (this.options.rootFingerprint ?? APPLE_ROOT_CA_G3_SHA256).toUpperCase();
  }
}
