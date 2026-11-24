/**
 * Ponte `window.AskouTPush`: avisos (push) no app. Pede permissão, registra o aparelho (na Apple no iPhone, no FCM no Android)
 * e devolve o token, que o app web manda para o servidor (`apns:<token>` ou `fcm:<token>`). Também avisa quando a pessoa toca num aviso, com o caminho a abrir.
 */

export type PushPermission = 'granted' | 'denied' | 'prompt';

export interface PushPluginLike {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(event: 'registration', cb: (t: { value: string }) => void): Promise<{ remove(): Promise<void> }>;
  addListener(event: 'registrationError', cb: (e: { error: string }) => void): Promise<{ remove(): Promise<void> }>;
  addListener(event: 'pushNotificationActionPerformed', cb: (a: { notification: { data?: Record<string, unknown> } }) => void): Promise<{ remove(): Promise<void> }>;
  getDeliveredNotifications?(): Promise<{ notifications: DeliveredLike[] }>;
  removeDeliveredNotifications?(o: { notifications: DeliveredLike[] }): Promise<void>;
}

/** Aviso que está na bandeja do celular, como o plugin devolve. */
export interface DeliveredLike {
  id: string | number;
  tag?: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}

/**
 * Este aviso leva para a tela `url`? No iPhone o caminho vem em `data.url`; no Android, nos avisos de mensagem
 * montados pelo app, em `data["askout.url"]`. Os montados pelo Firebase não guardam o caminho: aí vale título e texto.
 */
export function deliveredMatches(n: DeliveredLike, match: { url: string; texts: { title: string; body: string }[] }): boolean {
  const screen = (v: unknown) => (typeof v === 'string' ? v.split(/[?#]/)[0] : undefined);
  if (screen(n.data?.['url']) === match.url || screen(n.data?.['askout.url']) === match.url) return true;
  return match.texts.some((t) => n.title === t.title && (n.body ?? '') === t.body);
}

const toPermission = (receive: string): PushPermission => (receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'prompt');

export interface InAppWindow {
  location: { pathname: string; search: string };
  history: { pushState(data: unknown, unused: string, url: string): void };
  dispatchEvent(event: Event): boolean;
}

/**
 * Abre um caminho do app sem recarregar a página: troca o endereço e avisa o roteador (ele escuta `popstate`).
 * Recarregar (`location.assign`) quebrava no iPhone quando o caminho parece arquivo, como `/u/ana.souza`:
 * a casca procura um arquivo `ana.souza` em vez de abrir o app, e o perfil não aparecia.
 * Se o app web ainda não montou (app aberto pelo toque), ele já nasce no caminho trocado.
 */
export function openInApp(path: string, win: InAppWindow): void {
  if (win.location.pathname + win.location.search !== path) win.history.pushState(null, '', path);
  win.dispatchEvent(new Event('popstate'));
}

/** Plugin do app no iPhone (ArrivalActivities.swift): token "push-to-start" da Live Activity da chegada ao vivo. */
export interface LiveActivityPluginLike {
  startToken(): Promise<{ token?: string }>;
  /** A chegada `tag` está na tela bloqueada agora? Sem `showing` onde não há Live Activity. */
  isShowing?(options: { tag: string }): Promise<{ showing?: boolean }>;
}

export function createPushBridge(deps: { push: PushPluginLike; open: (path: string) => void; timeoutMs?: number; liveActivity?: LiveActivityPluginLike | undefined }) {
  const timeoutMs = deps.timeoutMs ?? 15_000;
  let listening = false;
  /** Só abre caminhos DENTRO do app (começam com uma barra, sem `//`): o conteúdo do aviso não é de confiança. */
  const listen = () => {
    if (listening) return;
    listening = true;
    void deps.push
      .addListener('pushNotificationActionPerformed', (a) => {
        const url = a.notification.data?.['url'];
        if (typeof url === 'string' && /^\/(?!\/)/.test(url)) deps.open(url);
      })
      .catch(() => {
        listening = false;
      });
  };
  listen();
  return {
    /** Tira da bandeja os avisos que levam para `match.url` (a pessoa abriu essa tela no app). Devolve quantos. */
    async clearDelivered(match: { url: string; texts: { title: string; body: string }[] }): Promise<number> {
      if (!deps.push.getDeliveredNotifications || !deps.push.removeDeliveredNotifications) return 0;
      const { notifications } = await deps.push.getDeliveredNotifications();
      const gone = notifications.filter((n) => deliveredMatches(n, match));
      if (gone.length > 0) await deps.push.removeDeliveredNotifications({ notifications: gone });
      return gone.length;
    },
    /** Esta casca mostra "Responder" na notificação de mensagem (AppDelegate no iPhone, ReplyMessagingService no Android). */
    replies: true as const,
    /**
     * Token "push-to-start" da Live Activity da chegada (iPhone com iOS 17.2+ e Atividades ao Vivo ligadas). Com ele
     * o servidor abre a chegada do amigo na tela bloqueada, com a barra. `undefined` onde não há.
     */
    async liveActivityToken(): Promise<string | undefined> {
      if (!deps.liveActivity) return undefined;
      try {
        const token = (await deps.liveActivity.startToken()).token;
        return typeof token === 'string' && /^[0-9a-f]{32,200}$/i.test(token) ? token : undefined;
      } catch {
        return undefined;
      }
    },
    /** A Live Activity da chegada `tag` está na tela? `undefined` onde não há (Android, iPhone antigo, build antigo). */
    async liveActivityShowing(tag: string): Promise<boolean | undefined> {
      if (!deps.liveActivity?.isShowing) return undefined;
      try {
        const { showing } = await deps.liveActivity.isShowing({ tag });
        return typeof showing === 'boolean' ? showing : undefined;
      } catch {
        return undefined;
      }
    },
    async permission(): Promise<PushPermission> {
      return toPermission((await deps.push.checkPermissions()).receive);
    },
    /** Pede permissão (se ainda não pediu) e devolve o token do aparelho; `undefined` se a pessoa recusou. */
    async register(): Promise<string | undefined> {
      let state = toPermission((await deps.push.checkPermissions()).receive);
      if (state === 'prompt') state = toPermission((await deps.push.requestPermissions()).receive);
      if (state !== 'granted') return undefined;
      return new Promise<string>((resolve, reject) => {
        const handles: Promise<{ remove(): Promise<void> }>[] = [];
        const done = (fn: () => void) => {
          clearTimeout(timer);
          for (const h of handles) void h.then((x) => x.remove()).catch(() => undefined);
          fn();
        };
        const timer = setTimeout(() => done(() => reject(new Error('O aparelho não respondeu ao registrar os avisos. Tente de novo.'))), timeoutMs);
        handles.push(deps.push.addListener('registration', (t) => done(() => resolve(t.value))));
        handles.push(deps.push.addListener('registrationError', (e) => done(() => reject(new Error(e.error || 'Não foi possível registrar os avisos.')))));
        deps.push.register().catch((e: unknown) => done(() => reject(e instanceof Error ? e : new Error(String(e)))));
      });
    },
  };
}
