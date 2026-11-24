import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextSort, sortParams, sortRows } from './sort.ts';

test('clicar no cabeçalho: primeira direção, a contrária e volta à ordem padrão', () => {
  assert.deepEqual(nextSort(undefined, 'name'), { key: 'name', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'name', dir: 'asc' }, 'name'), { key: 'name', dir: 'desc' });
  assert.equal(nextSort({ key: 'name', dir: 'desc' }, 'name'), undefined);
  // Datas começam da mais recente.
  assert.deepEqual(nextSort(undefined, 'at', 'desc'), { key: 'at', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'at', dir: 'desc' }, 'at', 'desc'), { key: 'at', dir: 'asc' });
  assert.equal(nextSort({ key: 'at', dir: 'asc' }, 'at', 'desc'), undefined);
  // Outra coluna recomeça.
  assert.deepEqual(nextSort({ key: 'name', dir: 'desc' }, 'at', 'desc'), { key: 'at', dir: 'desc' });
});

test('ordena no navegador: acentos e maiúsculas não atrapalham, números como números, vazios no fim, estável', () => {
  const rows = [
    { n: 'Zé', v: 10, c: 'b' },
    { n: 'ana', v: 2, c: null },
    { n: 'Álvaro', v: 2, c: 'a' },
    { n: 'bia', v: 30, c: null },
  ];
  const by = { n: (r: (typeof rows)[0]) => r.n, v: (r: (typeof rows)[0]) => r.v, c: (r: (typeof rows)[0]) => r.c };
  assert.deepEqual(sortRows(rows, { key: 'n', dir: 'asc' }, by).map((r) => r.n), ['Álvaro', 'ana', 'bia', 'Zé']);
  assert.deepEqual(sortRows(rows, { key: 'v', dir: 'desc' }, by).map((r) => r.n), ['bia', 'Zé', 'ana', 'Álvaro']);
  assert.deepEqual(sortRows(rows, { key: 'c', dir: 'desc' }, by).map((r) => r.n), ['Zé', 'Álvaro', 'ana', 'bia']);
  assert.deepEqual(sortRows(rows, undefined, by), rows);
  assert.deepEqual(sortParams(undefined), {});
  assert.deepEqual(sortParams({ key: 'email', dir: 'desc' }), { sort: 'email', dir: 'desc' });
});
