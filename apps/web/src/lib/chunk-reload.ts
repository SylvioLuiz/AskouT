// Depois de um deploy novo, os arquivos antigos de /assets (com o hash no nome) deixam de existir.
// Quem estava com a página aberta ainda tem o index antigo e, ao abrir uma tela carregada sob demanda
// (como o mapa), pede um arquivo que sumiu e o carregamento falha. A saída é recarregar a página uma vez,
// o que traz o index novo com os nomes certos. A marca na sessão impede um laço de recarregamentos se o
// erro persistir por outro motivo (sem rede, servidor fora do ar).

import { lazy, type ComponentType } from 'react';

const KEY = 'askout:chunk-reload-at';
/** Janela em que um segundo erro não provoca outro recarregamento. */
export const RELOAD_GUARD_MS = 30_000;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** Decide se pode recarregar agora e, se puder, registra o momento. Sem armazenamento, não recarrega. */
export function claimReload(store: Store | null, now: number): boolean {
  if (!store) return false;
  try {
    const last = Number(store.getItem(KEY));
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_GUARD_MS) return false;
    store.setItem(KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

function sessionStore(): Store | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Recarrega a página uma vez por janela de tempo. Devolve true se o recarregamento foi pedido. */
export function reloadOnce(): boolean {
  if (typeof window === 'undefined') return false;
  if (!claimReload(sessionStore(), Date.now())) return false;
  window.location.reload();
  return true;
}

/**
 * Igual ao `lazy` do React, mas, se o arquivo da tela não carregar, recarrega a página uma vez em vez de
 * quebrar. Enquanto a página recarrega, a promessa fica pendente (o Suspense continua mostrando o aviso).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mesma restrição do `lazy` do React
export function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy<T>(() =>
    factory().catch((error: unknown) => {
      if (reloadOnce()) return new Promise<{ default: T }>(() => undefined);
      throw error;
    }),
  );
}

/** Vite avisa com `vite:preloadError` quando um import dinâmico ou seu CSS falha: trata da mesma forma. */
export function installChunkReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnce()) event.preventDefault();
  });
}
