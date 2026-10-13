import { createHmac, timingSafeEqual } from 'node:crypto';

const TTL_MS = 30 * 60_000;

/**
 * Endereço assinado e com validade para a foto de um lugar. O <img> do app não manda o token de login,
 * então a assinatura (HMAC) prova que o endereço foi emitido por esta API para quem já estava logado.
 */
export class PhotoSigner {
  private readonly secret: string;
  private readonly now: () => number;

  constructor(secret: string, now: () => number = Date.now) {
    this.secret = secret;
    this.now = now;
  }

  private mac(ref: string, exp: number): Buffer {
    return createHmac('sha256', this.secret).update(`photo\n${ref}\n${exp}`).digest();
  }

  /** Caminho relativo à API (o app acrescenta o endereço base). */
  path(ref: string): string {
    const exp = this.now() + TTL_MS;
    return `/places/photo?ref=${encodeURIComponent(ref)}&exp=${exp}&sig=${this.mac(ref, exp).toString('base64url')}`;
  }

  verify(ref: string, exp: string, sig: string): boolean {
    const expNum = Number(exp);
    if (!Number.isInteger(expNum) || expNum < this.now() || expNum > this.now() + TTL_MS + 1000) return false;
    const given = Buffer.from(sig, 'base64url');
    const wanted = this.mac(ref, expNum);
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  }
}
