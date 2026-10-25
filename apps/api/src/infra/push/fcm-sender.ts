import type { PushMessage, PushResult, PushSender } from '../../core/ports.ts';
import type { PushSubscriptionRecord } from '../../core/types.ts';
import type { FetchLike, GoogleAccessTokens } from '../google/service-account.ts';

/**
 * Envio de aviso (push) para o app no Android, pelo FCM (API HTTP v1) com conta de serviço do Google.
 * O que NÃO foi testado: a entrega real a um aparelho (precisa do projeto Firebase, do google-services.json no app e da conta de serviço).
 */

export const FCM_PREFIX = 'fcm:';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export class FcmSender implements PushSender {
  readonly publicKey = null;
  readonly nativeEnabled = true;
  private readonly tokens: Pick<GoogleAccessTokens, 'get' | 'projectId'>;
  private readonly fetcher: FetchLike;

  constructor(options: { tokens: Pick<GoogleAccessTokens, 'get' | 'projectId'>; fetch?: FetchLike }) {
    this.tokens = options.tokens;
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  }

  async send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<PushResult> {
    if (!subscription.endpoint.startsWith(FCM_PREFIX)) return 'FAILED';
    const deviceToken = subscription.endpoint.slice(FCM_PREFIX.length);
    const body = JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: message.title, body: message.body },
        data: { url: message.url },
        android: { priority: 'HIGH', notification: { tag: message.tag.slice(0, 64) } },
      },
    });
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.tokens.projectId)}/messages:send`;
    const attempt = async (forceNew: boolean) =>
      this.fetcher(url, { method: 'POST', headers: { authorization: `Bearer ${await this.tokens.get(FCM_SCOPE, forceNew)}`, 'content-type': 'application/json' }, body });
    try {
      let response = await attempt(false);
      if (response.status === 401) response = await attempt(true);
      if (response.status === 200) return 'SENT';
      // 404/UNREGISTERED: o app foi desinstalado ou o token mudou. 400/INVALID_ARGUMENT no token: token inválido.
      let status = '';
      let detail = '';
      try {
        const err = (JSON.parse(await response.text()) as { error?: { status?: string; details?: Array<{ errorCode?: string }> } }).error;
        status = err?.status ?? '';
        detail = err?.details?.map((d) => d.errorCode ?? '').join(',') ?? '';
      } catch {
        status = '';
      }
      if (response.status === 404 || /UNREGISTERED/.test(detail) || status === 'NOT_FOUND') return 'GONE';
      if (response.status === 400 && /INVALID_ARGUMENT/.test(status) && /UNREGISTERED|INVALID_ARGUMENT/.test(detail || 'INVALID_ARGUMENT')) return 'GONE';
      return 'FAILED';
    } catch {
      return 'FAILED';
    }
  }
}

/** Escolhe o envio pelo prefixo do aparelho: `apns:` (iPhone) ou `fcm:` (Android). */
export class NativePushRouter implements PushSender {
  readonly publicKey = null;
  readonly nativeEnabled = true;
  private readonly apns: PushSender | undefined;
  private readonly fcm: PushSender | undefined;

  constructor(senders: { apns?: PushSender | undefined; fcm?: PushSender | undefined }) {
    this.apns = senders.apns;
    this.fcm = senders.fcm;
  }

  send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<PushResult> {
    const sender = subscription.endpoint.startsWith(FCM_PREFIX) ? this.fcm : this.apns;
    return sender ? sender.send(subscription, message) : Promise.resolve('FAILED');
  }
}
