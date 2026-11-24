import { createHmac, timingSafeEqual } from 'node:crypto';

/** O endereço só muda a cada 6 horas: o mesmo link dentro da janela deixa o navegador reaproveitar a foto sem pedir de novo. */
const WINDOW_MS = 6 * 3_600_000;
const MAX_AHEAD_MS = 2 * WINDOW_MS;

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
    const exp = (Math.floor(this.now() / WINDOW_MS) + 2) * WINDOW_MS;
    return `/places/photo?ref=${encodeURIComponent(ref)}&exp=${exp}&sig=${this.mac(ref, exp).toString('base64url')}`;
  }

  verify(ref: string, exp: string, sig: string): boolean {
    const expNum = Number(exp);
    if (!Number.isInteger(expNum) || expNum < this.now() || expNum > this.now() + MAX_AHEAD_MS + 1000) return false;
    const given = Buffer.from(sig, 'base64url');
    const wanted = this.mac(ref, expNum);
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  }
}
