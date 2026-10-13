import { createCipheriv, createECDH, createPrivateKey, createPublicKey, hkdfSync, randomBytes, sign } from 'node:crypto';
import type { PushMessage, PushResult, PushSender } from '../../core/ports.ts';
import type { PushSubscriptionRecord } from '../../core/types.ts';

/**
 * Web Push sem bibliotecas: criptografia de conteúdo `aes128gcm` (RFC 8291) e identificação do servidor com VAPID (RFC 8292).
 * Confira o que NÃO foi testado: a entrega real depende dos serviços de push de cada navegador (FCM, Mozilla, Apple).
 */

const b64url = (buf: Buffer | Uint8Array): string => Buffer.from(buf).toString('base64url');
const fromB64url = (s: string): Buffer => Buffer.from(s, 'base64url');

export interface VapidKeys {
  /** Ponto público P-256 não comprimido (65 bytes), em base64url. É o que o navegador recebe. */
  publicKey: string;
  /** Chave privada (32 bytes), em base64url. Nunca sai do servidor. */
  privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

const RECORD_SIZE = 4096;
const MAX_PLAINTEXT = RECORD_SIZE - 17; // 1 byte de delimitador + 16 de tag

export interface EncryptOptions {
  /** Só para teste (vetor do RFC 8291): sal e chave efêmera fixos. */
  salt?: Buffer;
  ephemeralPrivateKey?: Buffer;
}

/** Cifra o conteúdo para a inscrição (`p256dh` e `auth` em base64url) no formato `aes128gcm`. */
export function encryptPayload(plaintext: Buffer, p256dh: string, auth: string, options: EncryptOptions = {}): Buffer {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error('Conteúdo grande demais para um push');
  const uaPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('Chave p256dh inválida');
  if (authSecret.length !== 16) throw new Error('Segredo auth inválido');

  const salt = options.salt ?? randomBytes(16);
  const ephemeral = createECDH('prime256v1');
  if (options.ephemeralPrivateKey) ephemeral.setPrivateKey(options.ephemeralPrivateKey);
  else ephemeral.generateKeys();
  const asPublic = ephemeral.getPublicKey();
  const shared = ephemeral.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, encrypted]);
}

/** Cabeçalho `Authorization` VAPID para o serviço de push dono do endpoint. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, nowSeconds: number): string {
  const audience = new URL(endpoint).origin;
  const encode = (o: object) => b64url(Buffer.from(JSON.stringify(o)));
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({ aud: audience, exp: nowSeconds + 12 * 3600, sub: subject })}`;
  const pub = fromB64url(keys.publicKey);
  const privateKey = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) }, format: 'jwk' });
  const signature = sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64url(signature)}, k=${keys.publicKey}`;
}

/** Confere que a chave pública corresponde à privada (evita subir o servidor com chaves trocadas). */
export function vapidKeysMatch(keys: VapidKeys): boolean {
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(fromB64url(keys.privateKey));
    return ecdh.getPublicKey().equals(fromB64url(keys.publicKey));
  } catch {
    return false;
  }
}

export interface WebPushOptions {
  keys: VapidKeys;
  /** `mailto:` ou `https:` de contato, exigido pelo VAPID. */
  subject: string;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  timeoutMs?: number;
}

export class WebPushSender implements PushSender {
  readonly publicKey: string;
  private readonly options: WebPushOptions;

  constructor(options: WebPushOptions) {
    this.options = options;
    this.publicKey = options.keys.publicKey;
  }

  async send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<PushResult> {
    const { keys, subject, fetchImpl = fetch, nowMs = Date.now, timeoutMs = 8000 } = this.options;
    try {
      // Só o texto curto do aviso vai no push; o app busca o resto ao abrir.
      const body = encryptPayload(Buffer.from(JSON.stringify({ title: message.title, body: message.body, url: message.url, tag: message.tag })), subscription.p256dh, subscription.auth);
      const response = await fetchImpl(subscription.endpoint, {
        method: 'POST',
        headers: {
          Authorization: vapidAuthorization(subscription.endpoint, keys, subject, Math.floor(nowMs() / 1000)),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: '86400',
          Urgency: 'normal',
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status >= 200 && response.status < 300) return 'SENT';
      if (response.status === 404 || response.status === 410) return 'GONE';
      return 'FAILED';
    } catch {
      return 'FAILED';
    }
  }
}

/** Usado quando não há chaves VAPID: o aviso dentro do app continua, o push fica desligado. */
export class DisabledPushSender implements PushSender {
  readonly publicKey = null;

  async send(): Promise<PushResult> {
    return 'FAILED';
  }
}
