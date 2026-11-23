/**
 * Bandeja de notificações do celular: quando você abre no app a tela de um aviso (pela lista de Atividades ou
 * por qualquer caminho), o aviso daquela tela some da bandeja, como acontece ao tocar nele por lá.
 * Ponte nativa: `window.AskouTPush.clearDelivered` (apps/mobile/src/push-bridge.ts). No navegador, não faz nada.
 */
export interface TrayMatch {
  /** Caminho que o aviso abre (`/conversas/123`). */
  url: string;
  /** Título e texto dos avisos com esse caminho, para o Android achar os montados pelo Firebase (sem o caminho). */
  texts: { title: string; body: string }[];
}

export interface TrayBridge {
  clearDelivered(match: TrayMatch): Promise<number>;
}

export function trayBridge(host: unknown = typeof window === 'undefined' ? undefined : window): TrayBridge | undefined {
  const b = (host as { AskouTPush?: Partial<TrayBridge> } | undefined)?.AskouTPush;
  return b && typeof b.clearDelivered === 'function' ? (b as TrayBridge) : undefined;
}

/** Últimos avisos vistos na lista do app (título e texto por caminho). */
let known: readonly { url: string; title: string; body: string }[] = [];

export function rememberNotifications(items: readonly { url: string; title: string; body: string }[]): void {
  known = items.slice(0, 100).map((i) => ({ url: i.url, title: i.title, body: i.body }));
}

/** Caminho sem a parte depois de `?` ou `#`, para comparar telas. */
const screenOf = (path: string): string => path.split(/[?#]/)[0] ?? path;

export function trayMatchFor(path: string, items: readonly { url: string; title: string; body: string }[] = known): TrayMatch {
  const screen = screenOf(path);
  return { url: screen, texts: items.filter((i) => screenOf(i.url) === screen).map((i) => ({ title: i.title, body: i.body })) };
}

export function clearTrayFor(path: string, host?: unknown): void {
  const bridge = trayBridge(host);
  if (!bridge || path === '/' || path === '') return;
  void bridge.clearDelivered(trayMatchFor(path)).catch(() => undefined);
}
