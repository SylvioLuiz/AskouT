import { useSyncExternalStore } from 'react';

/** Largura a partir da qual a tela ganha colunas laterais (abaixo disso, tudo continua empilhado como no celular). */
export const DESKTOP_WIDE_QUERY = '(min-width: 1100px)';

function subscribe(query: string, onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const list = window.matchMedia(query);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Verdadeiro quando a janela é de computador larga o bastante para as colunas laterais. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => subscribe(query, onChange),
    () => matches(query),
    () => false,
  );
}

export function useWideDesktop(): boolean {
  return useMediaQuery(DESKTOP_WIDE_QUERY);
}
