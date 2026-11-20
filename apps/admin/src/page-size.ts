import { useSyncExternalStore } from 'react';

/** Quantos registros cada tabela da gestão mostra por página. Vale para todas e fica guardado neste navegador. */
export const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_SIZE = 25;
const KEY = 'askout.admin.pageSize';

let current = read();
const listeners = new Set<() => void>();

function read(): number {
  try {
    const n = Number(window.localStorage.getItem(KEY));
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
  }
}

export function getPageSize(): number {
  return current;
}

export function setPageSize(size: number): void {
  if (!(PAGE_SIZES as readonly number[]).includes(size) || size === current) return;
  current = size;
  try {
    window.localStorage.setItem(KEY, String(size));
  } catch {
    // sem armazenamento: vale só até recarregar
  }
  listeners.forEach((l) => l());
}

export function usePageSize(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getPageSize,
    () => DEFAULT_SIZE,
  );
}
