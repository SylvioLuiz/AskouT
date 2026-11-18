import type { PushMessage, PushResult, PushSender } from '../../core/ports.ts';
import type { PushSubscriptionRecord } from '../../core/types.ts';
import type { FetchLike, GoogleAccessTokens } from '../google/service-account.ts';

/**
 * Envio de aviso (push) para o app no Android, pelo FCM (API HTTP v1) com conta de serviço do Google.
 * O que NÃO foi testado: a entrega real a um aparelho (precisa do projeto Firebase, do google-services.json no app e da conta de serviço).
 */

export const FCM_PREFIX = 'fcm:';
/** Canal de avisos do app Android (o app cria com esse id, ver apps/mobile/src/main.ts). */
export const FCM_CHANNEL_ID = 'avisos';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** O que costuma resolver cada recusa do FCM, para quem lê o log do servidor. */
const FCM_HINTS: Readonly<Record<string, string>> = {
  SENDER_ID_MISMATCH: 'o token é de outro projeto do Firebase: FCM_PROJECT_ID tem que ser o mesmo do google-services.json do app',
  THIRD_PARTY_AUTH_ERROR: 'a conta de serviço não pode enviar por esse projeto',
  PERMISSION_DENIED: 'a conta de serviço (GOOGLE_SERVICE_ACCOUNT_JSON) precisa do papel "Firebase Cloud Messaging API Admin" no projeto do Firebase, e a API "Firebase Cloud Messaging" precisa estar ativada',
  UNAUTHENTICATED: 'a conta de serviço não autenticou: confira GOOGLE_SERVICE_ACCOUNT_JSON',
  UNREGISTERED: 'o app foi desinstalado ou o token do aparelho mudou (a inscrição é apagada)',
  INVALID_ARGUMENT: 'token do aparelho inválido ou campo do aviso recusado',
  QUOTA_EXCEEDED: 'muitos avisos seguidos',
  UNAVAILABLE: 'o FCM está fora do ar no momento',
  INTERNAL: 'problema do lado do Google',
};

/** Linha de log de um envio recusado pelo FCM. Só mostra o fim do token do aparelho. */
export function fcmFailureLine(input: { status: number; errorStatus: string; detail: string; project: string; deviceToken: string }): string {
  const codes = [input.detail, input.errorStatus].join(',').split(',').filter((c) => c !== '');
  const hint = codes.map((c) => FCM_HINTS[c]).find((h) => h !== undefined);
  return `[push Android] FCM recusou (projeto ${input.project}, aparelho …${input.deviceToken.slice(-6)}): HTTP ${input.status}${codes.length > 0 ? ` ${[...new Set(codes)].join('/')}` : ''}${hint ? ` — ${hint}` : ''}`;
}

export class FcmSender implements PushSender {
  readonly publicKey = null;
  readonly nativeEnabled = true;
  private readonly tokens: Pick<GoogleAccessTokens, 'get' | 'projectId'>;
  private readonly fetcher: FetchLike;
  /** Projeto do Firebase do app; sem ele, o da conta de serviço. */
  private readonly projectId: string | undefined;
  private readonly log: (line: string) => void;

  constructor(options: { tokens: Pick<GoogleAccessTokens, 'get' | 'projectId'>; fetch?: FetchLike; projectId?: string | undefined; log?: (line: string) => void }) {
    this.tokens = options.tokens;
    this.log = options.log ?? ((line) => console.warn(line));
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.projectId = options.projectId;
  }

  async send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<PushResult> {
    if (!subscription.endpoint.startsWith(FCM_PREFIX)) return 'FAILED';
    const deviceToken = subscription.endpoint.slice(FCM_PREFIX.length);
    const body = JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: message.title, body: message.body },
        data: { url: message.url },
        // Canal "avisos" (criado pelo app com importância alta): é o que faz o Android mostrar o aviso no topo da tela,
        // com o título e o texto, em vez de só um ícone na barra. `visibility: PUBLIC` mostra o texto também na tela bloqueada
        // (a pessoa ainda pode esconder em Ajustes do Android).
        android: {
          priority: 'HIGH',
          notification: { tag: message.tag.slice(0, 64), channel_id: FCM_CHANNEL_ID, notification_priority: 'PRIORITY_HIGH', visibility: 'PUBLIC', default_sound: true },
        },
      },
    });
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.projectId ?? this.tokens.projectId)}/messages:send`;
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
      const project = this.projectId ?? this.tokens.projectId;
      this.log(fcmFailureLine({ status: response.status, errorStatus: status, detail, project, deviceToken }));
      if (response.status === 404 || /UNREGISTERED/.test(detail) || status === 'NOT_FOUND') return 'GONE';
      if (response.status === 400 && /INVALID_ARGUMENT/.test(status) && /UNREGISTERED|INVALID_ARGUMENT/.test(detail || 'INVALID_ARGUMENT')) return 'GONE';
      return 'FAILED';
    } catch (failure) {
      this.log(`[push Android] falha ao falar com o FCM (aparelho …${deviceToken.slice(-6)}): ${failure instanceof Error ? failure.message : String(failure)}`);
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
