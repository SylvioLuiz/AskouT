/**
 * iPhone: a folha "Compartilhar com o AskouT" (Share Extension) envia fotos, PDFs e links direto para as conversas,
 * sem abrir o app. Para isso ela precisa da sessão: o app guarda o token e o endereço da API no Keychain
 * compartilhado pela ponte `window.AskouTShareSession` (ShareSessionPlugin.swift). Sem a ponte (navegador, Android,
 * build antigo), nada muda.
 */
import type { SessionStore } from './session.ts';

export interface ShareSessionBridge {
  set(o: { token: string; apiBase: string }): Promise<void>;
  clear(): Promise<void>;
}

export function shareSessionBridge(host: unknown = typeof window === 'undefined' ? undefined : window): ShareSessionBridge | undefined {
  const b = (host as { AskouTShareSession?: Partial<ShareSessionBridge> } | undefined)?.AskouTShareSession;
  return b && typeof b.set === 'function' && typeof b.clear === 'function' ? (b as ShareSessionBridge) : undefined;
}

/** A sessão do app, avisando a ponte a cada entrada, token novo e saída (e já na abertura, se a pessoa está logada). */
export function withShareSession(store: SessionStore, apiBase: () => string, host?: unknown): SessionStore {
  const push = (token: string | undefined) => {
    const bridge = shareSessionBridge(host);
    if (!bridge) return;
    const base = apiBase();
    // Só com endereço completo (a extensão não conhece o endereço relativo do site).
    if (token && /^https?:\/\//.test(base)) void bridge.set({ token, apiBase: base }).catch(() => undefined);
    else if (!token) void bridge.clear().catch(() => undefined);
  };
  // Depois de montar o módulo (o endereço da API pode ser definido logo abaixo de quem chama).
  queueMicrotask(() => push(store.get()));
  return {
    ...store,
    set(token: string) {
      store.set(token);
      push(token);
    },
    clear() {
      store.clear();
      push(undefined);
    },
  };
}
