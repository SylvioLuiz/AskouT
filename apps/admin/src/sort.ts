import { useState } from 'react';

/** Coluna e direção de uma tabela da gestão. `undefined` = ordem de sempre da lista. */
export interface Sort<K extends string = string> {
  key: K;
  dir: 'asc' | 'desc';
}

/**
 * Próximo estado ao clicar no cabeçalho: a primeira direção da coluna, depois a contrária, depois volta à ordem de
 * sempre. Datas e números começam do maior (`first: 'desc'`), textos do A.
 */
export function nextSort<K extends string>(current: Sort<K> | undefined, key: K, first: 'asc' | 'desc' = 'asc'): Sort<K> | undefined {
  if (current?.key !== key) return { key, dir: first };
  if (current.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' };
  return undefined;
}

export function useSort<K extends string>(initial?: Sort<K>) {
  const [sort, setSort] = useState<Sort<K> | undefined>(initial);
  return { sort, toggle: (key: K, first?: 'asc' | 'desc') => setSort((s) => nextSort(s, key, first)) };
}

/** Parâmetros `sort`/`dir` para as listas que a API ordena (as paginadas). */
export function sortParams(sort: Sort | undefined): { sort?: string; dir?: 'asc' | 'desc' } {
  return sort ? { sort: sort.key, dir: sort.dir } : {};
}

type SortValue = string | number | null | undefined;

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

/**
 * Ordena no navegador as tabelas que vêm inteiras (sem páginas). Estável; vazios sempre no fim. Sem `sort`, devolve a
 * lista como veio.
 */
export function sortRows<T, K extends string>(rows: readonly T[], sort: Sort<K> | undefined, by: Record<K, (row: T) => SortValue>): T[] {
  if (!sort) return [...rows];
  const get = by[sort.key];
  const sign = sort.dir === 'desc' ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((a, b) => {
      const x = a.v ?? null;
      const y = b.v ?? null;
      if (x === null || y === null) return x === y ? a.i - b.i : x === null ? 1 : -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((x) => x.row);
}
