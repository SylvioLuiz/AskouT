/**
 * Ponte `window.AskouTPush`: avisos (push) no app. No iPhone, pede permissão, registra o aparelho na Apple e devolve o token,
 * que o app web manda para o servidor (`apns:<token>`). Também avisa quando a pessoa toca num aviso, com o caminho a abrir.
 */

export type PushPermission = 'granted' | 'denied' | 'prompt';

export interface PushPluginLike {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(event: 'registration', cb: (t: { value: string }) => void): Promise<{ remove(): Promise<void> }>;
  addListener(event: 'registrationError', cb: (e: { error: string }) => void): Promise<{ remove(): Promise<void> }>;
  addListener(event: 'pushNotificationActionPerformed', cb: (a: { notification: { data?: Record<string, unknown> } }) => void): Promise<{ remove(): Promise<void> }>;
}

const toPermission = (receive: string): PushPermission => (receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'prompt');

export function createPushBridge(deps: { push: PushPluginLike; open: (path: string) => void; timeoutMs?: number }) {
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
        const timer = setTimeout(() => done(() => reject(new Error('O iPhone não respondeu ao registrar os avisos. Tente de novo.'))), timeoutMs);
        handles.push(deps.push.addListener('registration', (t) => done(() => resolve(t.value))));
        handles.push(deps.push.addListener('registrationError', (e) => done(() => reject(new Error(e.error || 'Não foi possível registrar os avisos.')))));
        deps.push.register().catch((e: unknown) => done(() => reject(e instanceof Error ? e : new Error(String(e)))));
      });
    },
  };
}
