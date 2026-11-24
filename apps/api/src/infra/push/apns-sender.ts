import { createPrivateKey, sign } from 'node:crypto';
import { connect } from 'node:http2';
import type { ClientHttp2Session } from 'node:http2';
import type { LiveActivityPush, PushMessage, PushResult, PushSender } from '../../core/ports.ts';
import type { PushSubscriptionRecord } from '../../core/types.ts';
import { apnsSoundFor } from '../../core/notification-sounds.ts';

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
  /** Onde registrar os envios recusados pela Apple (padrão: console.warn, que vai para o log do servidor). */
  log?: (line: string) => void;
}

/** O que costuma resolver cada recusa da Apple, para quem lê o log do servidor. */
const REASON_HINTS: Readonly<Record<string, string>> = {
  BadDeviceToken: 'token de outro ambiente: app instalado pelo Xcode usa APNS_ENVIRONMENT=sandbox; TestFlight e loja usam production',
  Unregistered: 'o app foi desinstalado ou os avisos foram desligados no iPhone',
  DeviceTokenNotForTopic: 'o token é de outro app: confira APNS_BUNDLE_ID (bundle id do app)',
  TopicDisallowed: 'a chave não pode enviar para este app: confira APNS_BUNDLE_ID e a chave na conta da Apple',
  BadTopic: 'APNS_BUNDLE_ID inválido',
  InvalidProviderToken: 'APNS_KEY_ID, APNS_TEAM_ID e o conteúdo da .p8 não combinam (ou a chave foi revogada)',
  ExpiredProviderToken: 'o relógio do servidor está errado ou o token passou de 1 hora',
  MissingProviderToken: 'o pedido saiu sem a chave: confira APNS_KEY_ID e APNS_PRIVATE_KEY',
  TooManyProviderTokenUpdates: 'a chave está sendo renovada rápido demais (vários servidores com a mesma chave?)',
  TooManyRequests: 'muitos avisos seguidos para o mesmo aparelho',
  InternalServerError: 'problema do lado da Apple; tenta de novo no próximo aviso',
  ServiceUnavailable: 'a Apple está fora do ar no momento',
};

/** Linha de log de um envio recusado. Só mostra o fim do token do aparelho. */
export function apnsFailureLine(input: { status: number | null; reason: string; production: boolean; bundleId: string; deviceToken: string; error?: string }): string {
  const where = `${input.production ? 'production' : 'sandbox'}, app ${input.bundleId}, aparelho …${input.deviceToken.slice(-6)}`;
  if (input.status === null) return `[push iPhone] falha de conexão com a Apple (${where}): ${input.error ?? 'erro desconhecido'}`;
  const hint = REASON_HINTS[input.reason];
  return `[push iPhone] Apple recusou (${where}): HTTP ${input.status}${input.reason ? ` ${input.reason}` : ''}${hint ? ` — ${hint}` : ''}`;
}

const TOKEN_LIFETIME_SECONDS = 50 * 60;
/** Motivos da Apple em que o token do aparelho não vale mais (apagar a inscrição). */
const GONE_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);

/** Categoria de notificação com o campo "Responder" (mesmo nome no AppDelegate do app). */
export const APNS_REPLY_CATEGORY = 'MESSAGE';

export class ApnsSender implements PushSender {
  /** O app do iPhone não usa chave pública do navegador. */
  readonly publicKey = null;
  readonly nativeEnabled = true;
  private readonly config: ApnsConfig;
  private readonly transport: ApnsTransport;
  private readonly nowMs: () => number;
  private readonly log: (line: string) => void;
  private cached: { token: string; issuedAt: number } | undefined;

  constructor(options: ApnsSenderOptions) {
    this.config = options.config;
    this.transport = options.transport ?? http2Transport();
    this.nowMs = options.nowMs ?? Date.now;
    this.log = options.log ?? ((line) => console.warn(line));
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
    // Com `reply`, a categoria MESSAGE faz o iPhone mostrar o campo "Responder" (registrado no AppDelegate do app).
    // Em versões do app sem a categoria, o iPhone só ignora e mostra o aviso normal.
    // Chegada do amigo (live): mesmo `apns-collapse-id` a cada envio, então o iPhone troca o aviso no lugar. Só o
    // primeiro toca; os seguintes chegam em silêncio ("passive": não acende a tela nem faz barulho).
    const live = message.live;
    // Som escolhido pela pessoa (arquivo dentro do app, `default` ou nenhum). Sem escolha, o som padrão de sempre.
    const sound = apnsSoundFor(message.sound ?? 'padrao');
    const soundField = sound ? { sound } : {};
    const body = JSON.stringify(
      live
        ? {
            aps: {
              alert: { title: message.title, body: message.body },
              ...(live.quiet ? {} : soundField),
              'interruption-level': live.quiet ? 'passive' : 'active',
              'thread-id': message.tag.slice(0, 64),
            },
            url: message.url,
            live: { state: live.state, progress: live.progress, until: live.untilMs },
          }
        : message.reply
        ? { aps: { alert: { title: message.title, body: message.body }, ...soundField, category: APNS_REPLY_CATEGORY, 'thread-id': message.tag.slice(0, 64) }, url: message.url, reply: message.reply }
        : { aps: { alert: { title: message.title, body: message.body }, ...soundField }, url: message.url },
    );
    const host = this.config.production ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
    const attempt = async (forceNew: boolean): Promise<ApnsResponse> =>
      this.transport({
        host,
        path: `/3/device/${deviceToken}`,
        headers: {
          authorization: `bearer ${this.token(forceNew)}`,
          'apns-topic': this.config.bundleId,
          'apns-push-type': 'alert',
          'apns-priority': live?.quiet ? '5' : '10',
          ...(live ? { 'apns-expiration': String(Math.floor(live.untilMs / 1000)) } : {}),
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
      this.log(apnsFailureLine({ status: response.status, reason, production: this.config.production, bundleId: this.config.bundleId, deviceToken }));
      if (response.status === 410 || GONE_REASONS.has(reason)) return 'GONE';
      return 'FAILED';
    } catch (failure) {
      this.log(apnsFailureLine({ status: null, reason: '', production: this.config.production, bundleId: this.config.bundleId, deviceToken, error: failure instanceof Error ? failure.message : String(failure) }));
      return 'FAILED';
    }
  }

  /**
   * Live Activity da chegada (iPhone, iOS 17.2+): `start` pelo token "push-to-start", `update`/`end` pelo token da
   * atividade. As chaves de `content-state` e `attributes` são as de ArrivalAttributes (apps/mobile/ios/App/ArrivalWidget).
   */
  async liveActivity(push: LiveActivityPush): Promise<PushResult> {
    const nowSeconds = Math.floor(this.nowMs() / 1000);
    const aps: Record<string, unknown> = {
      timestamp: nowSeconds,
      event: push.event,
      'content-state': push.state,
      'stale-date': Math.floor(push.staleAtMs / 1000),
    };
    if (push.event === 'start' && push.attributes) {
      aps['attributes-type'] = 'ArrivalAttributes';
      aps['attributes'] = push.attributes;
    }
    if (push.alert) {
      const sound = apnsSoundFor(push.sound ?? 'padrao');
      aps['alert'] = { title: push.alert.title, body: push.alert.body, ...(sound ? { sound } : {}) };
    }
    if (push.event === 'end') aps['dismissal-date'] = Math.floor((push.dismissAtMs ?? this.nowMs()) / 1000);
    const host = this.config.production ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
    const body = JSON.stringify({ aps });
    const attempt = async (forceNew: boolean): Promise<ApnsResponse> =>
      this.transport({
        host,
        path: `/3/device/${push.token}`,
        headers: {
          authorization: `bearer ${this.token(forceNew)}`,
          'apns-topic': `${this.config.bundleId}.push-type.liveactivity`,
          'apns-push-type': 'liveactivity',
          // Atualização silenciosa pode ir com prioridade baixa (a Apple limita as de prioridade alta).
          'apns-priority': push.alert || push.event !== 'update' ? '10' : '5',
          'apns-expiration': String(Math.floor(push.staleAtMs / 1000)),
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
      this.log(apnsFailureLine({ status: response.status, reason, production: this.config.production, bundleId: this.config.bundleId, deviceToken: push.token }));
      if (response.status === 410 || GONE_REASONS.has(reason)) return 'GONE';
      return 'FAILED';
    } catch (failure) {
      this.log(apnsFailureLine({ status: null, reason: '', production: this.config.production, bundleId: this.config.bundleId, deviceToken: push.token, error: failure instanceof Error ? failure.message : String(failure) }));
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
    if (subscription.endpoint.startsWith(NATIVE_PREFIX) || subscription.endpoint.startsWith('fcm:')) return this.native ? this.native.send(subscription, message) : Promise.resolve('FAILED');
    return this.web.send(subscription, message);
  }

  get liveActivity(): ((push: LiveActivityPush) => Promise<PushResult>) | undefined {
    const native = this.native;
    return native?.liveActivity ? (push) => native.liveActivity!(push) : undefined;
  }
}
