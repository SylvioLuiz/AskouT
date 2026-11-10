import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) — o código de 6 números que muda a cada 30 s nos apps autenticadores
 * (Google Authenticator, Microsoft Authenticator, Authy, 1Password, Bitwarden...).
 * Tudo com `node:crypto`: não depende de serviço pago nem de biblioteca externa.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Aceita o código do passo anterior e do próximo: cobre relógio do celular um pouco adiantado ou atrasado. */
export const TOTP_WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Base32 inválido');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Segredo novo de 160 bits (o tamanho recomendado pela RFC 4226), em Base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/** Código do passo `step` (HOTP com o contador = passo). */
export function totpCode(secretBase32: string, step: number): string {
  const key = base32Decode(secretBase32);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/**
 * Confere o código e devolve o passo que ele representa (para barrar o reuso do mesmo código),
 * ou undefined se não bate. Só aceita passos depois de `afterStep`.
 */
export function matchTotp(secretBase32: string, code: string, now: Date, afterStep = -1): number | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const current = totpStep(now);
  const given = Buffer.from(code);
  let matched: number | undefined;
  // Confere todos os passos da janela, sem sair antes, para o tempo não revelar qual bateu.
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta += 1) {
    const step = current + delta;
    const expected = Buffer.from(totpCode(secretBase32, step));
    if (timingSafeEqual(expected, given) && step > afterStep && matched === undefined) matched = step;
  }
  return matched;
}

/** Endereço `otpauth://` que o app autenticador lê pelo QR code. */
export function otpauthUrl(input: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
