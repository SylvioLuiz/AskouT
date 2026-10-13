import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError } from './lib/errors.ts';
import type { ApiError } from './lib/errors.ts';

export interface AsyncState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
  setData: (data: T) => void;
}

/** Carrega dados quando `deps` mudam; ignora respostas antigas se a tela já pediu outra coisa. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    loadRef.current().then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      },
      (failure: unknown) => {
        if (cancelled) return;
        setError(toApiError(failure));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, loading, reload, setData };
}

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title === '' ? 'AskouT' : `${title} · AskouT`;
  }, [title]);
}

/** Valor que só muda depois de `delayMs` sem novas alterações (para a busca não disparar a cada tecla). */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
