import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api.ts';

export interface Async<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
}

/** Carrega dados e recarrega quando `deps` mudam. Ignora respostas de pedidos antigos. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): Async<T> {
  const [state, setState] = useState<{ data: T | undefined; error: string | undefined; loading: boolean }>({ data: undefined, error: undefined, loading: true });
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const mine = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    loadRef.current().then(
      (data) => {
        if (mine === latest.current) setState({ data, error: undefined, loading: false });
      },
      (e: unknown) => {
        if (mine === latest.current) setState((s) => ({ data: s.data, error: e instanceof ApiError ? e.message : 'Algo deu errado. Tente de novo.', loading: false }));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** Texto que só vira busca depois de uma pausa na digitação. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useDesktop(min: number): boolean {
  const [ok, setOk] = useState(() => window.innerWidth >= min);
  useEffect(() => {
    const on = () => setOk(window.innerWidth >= min);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [min]);
  return ok;
}
