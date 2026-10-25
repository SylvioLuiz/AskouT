import { createPrivateKey, sign } from 'node:crypto';
import { connect } from 'node:http2';
import type { ClientHttp2Session } from 'node:http2';
import type { PushMessage, PushResult, PushSender } from '../../core/ports.ts';
import type { PushSubscriptionRecord } from '../../core/types.ts';

/**
 * Envio de aviso (push) para o app no iPhone, direto na Apple (APNs, HTTP/2 com chave `.p8`), sem bibliotecas.
 * O que NÃO foi testado: a entrega real a um aparelho (precisa da chave da Apple e do app instalado pela loja/TestFlight).
 */

export const NATIVE_PREFIX = 'apns:';

export interface ApnsConfig {
  /** Identificador da chave (10 caracteres), mostrado ao criar a chave no portal da Apple. */
  keyId: string;
  teamId: string;
  /** Conteúdo do arquivo `.p8` (PEM PKCS#8). */
  privateKey: string;
  /** Bundle id do app (`apns-topic`). */
  bundleId: string;
  /** Falso só para builds instalados direto pelo Xcode (servidor de testes da Apple). */
  production: boolean;
}

export interface ApnsRequest {
  host: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface ApnsResponse {
  status: number;
  body: string;
}

export type ApnsTransport = (request: ApnsRequest) => Promise<ApnsResponse>;

const b64url = (buf: Buffer | string): string => Buffer.from(buf).toString('base64url');

/** Aceita a chave colada com `\n` literais (como costuma ficar numa variável de ambiente de uma linha só). */
export function normalizePem(raw: string): string {
  return raw.replace(/\\n/g, '\n').trim();
}

/** Confere se o texto é uma chave privada EC P-256 legível (evita subir o servidor com a chave errada). */
export function apnsKeyIsValid(privateKey: string): boolean {
  try {
    const key = createPrivateKey(normalizePem(privateKey));
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch {
    return false;
  }
}

/** Token de autenticação do servidor na Apple (JWT ES256). Vale até 1 hora; renovamos antes. */
export function apnsProviderToken(config: Pick<ApnsConfig, 'keyId' | 'teamId' | 'privateKey'>, nowSeconds: number): string {
  const unsigned = `${b64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }))}.${b64url(JSON.stringify({ iss: config.teamId, iat: nowSeconds }))}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key: createPrivateKey(normalizePem(config.privateKey)), dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${b64url(signature)}`;
}

/** Transporte real: uma conexão HTTP/2 reaproveitada por servidor da Apple. */
export function http2Transport(timeoutMs = 8000): ApnsTransport {
  const sessions = new Map<string, ClientHttp2Session>();
  const sessionFor = (host: string): ClientHttp2Session => {
    const current = sessions.get(host);
    if (current && !current.closed && !current.destroyed) return current;
    const session = connect(`https://${host}`);
    session.on('error', () => sessions.delete(host));
    session.on('close', () => sessions.delete(host));
    session.setTimeout(60_000, () => session.close());
    sessions.set(host, session);
    return session;
  };
  return (request) =>
    new Promise<ApnsResponse>((resolve, reject) => {
      const stream = sessionFor(request.host).request({ ':method': 'POST', ':path': request.path, ...request.headers });
      let status = 0;
      let body = '';
      const timer = setTimeout(() => {
        stream.close();
        reject(new Error('Tempo esgotado na Apple'));
      }, timeoutMs);
      stream.setEncoding('utf8');
      stream.on('response', (h) => {
        status = Number(h[':status'] ?? 0);
      });
      stream.on('data', (chunk: string) => {
        body += chunk;
      });
      stream.on('end', () => {
        clearTimeout(timer);
        resolve({ status, body });
      });
      stream.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      stream.end(request.body);
    });
}

export interface ApnsSenderOptions {
  config: ApnsConfig;
  transport?: ApnsTransport;
  nowMs?: () => number;
}

const TOKEN_LIFETIME_SECONDS = 50 * 60;
/** Motivos da Apple em que o token do aparelho não vale mais (apagar a inscrição). */
const GONE_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);

export class ApnsSender implements PushSender {
  /** O app do iPhone não usa chave pública do navegador. */
  readonly publicKey = null;
  readonly nativeEnabled = true;
  private readonly config: ApnsConfig;
  private readonly transport: ApnsTransport;
  private readonly nowMs: () => number;
  private cached: { token: string; issuedAt: number } | undefined;

  constructor(options: ApnsSenderOptions) {
    this.config = options.config;
    this.transport = options.transport ?? http2Transport();
    this.nowMs = options.nowMs ?? Date.now;
  }

  private token(forceNew = false): string {
    const now = Math.floor(this.nowMs() / 1000);
    if (forceNew || !this.cached || now - this.cached.issuedAt > TOKEN_LIFETIME_SECONDS) {
      this.cached = { token: apnsProviderToken(this.config, now), issuedAt: now };
    }
    return this.cached.token;
  }

  async send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<PushResult> {
    if (!subscription.endpoint.startsWith(NATIVE_PREFIX)) return 'FAILED';
    const deviceToken = subscription.endpoint.slice(NATIVE_PREFIX.length);
    const body = JSON.stringify({ aps: { alert: { title: message.title, body: message.body }, sound: 'default' }, url: message.url });
    const host = this.config.production ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
    const attempt = async (forceNew: boolean): Promise<ApnsResponse> =>
      this.transport({
        host,
        path: `/3/device/${deviceToken}`,
        headers: {
          authorization: `bearer ${this.token(forceNew)}`,
          'apns-topic': this.config.bundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-collapse-id': message.tag.slice(0, 64),
          'content-type': 'application/json',
        },
        body,
      });
    try {
      let response = await attempt(false);
      if (response.status === 403 && /ExpiredProviderToken/.test(response.body)) response = await attempt(true);
      if (response.status === 200) return 'SENT';
      let reason = '';
      try {
        reason = (JSON.parse(response.body) as { reason?: string }).reason ?? '';
      } catch {
        reason = '';
      }
      if (response.status === 410 || GONE_REASONS.has(reason)) return 'GONE';
      return 'FAILED';
    } catch {
      return 'FAILED';
    }
  }
}

/** Junta os dois caminhos: navegadores (Web Push) e o app do iPhone (APNs). Cada inscrição vai pelo caminho certo. */
export class CompositePushSender implements PushSender {
  readonly publicKey: string | null;
  readonly nativeEnabled: boolean;
  private readonly web: PushSender;
  private readonly native: PushSender | undefined;

  constructor(web: PushSender, native: PushSender | undefined) {
    this.web = web;
    this.native = native;
    this.publicKey = web.publicKey;
    this.nativeEnabled = native !== undefined;
  }

  send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<PushResult> {
    if (subscription.endpoint.startsWith(NATIVE_PREFIX)) return this.native ? this.native.send(subscription, message) : Promise.resolve('FAILED');
    return this.web.send(subscription, message);
  }
}
