import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nowRadiusKm, setNowRadiusKm } from './now-radius.ts';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

test('distância do NOW: automático por padrão, guarda só as opções válidas', () => {
  const s = memory();
  assert.equal(nowRadiusKm(s), null);
  setNowRadiusKm(10, s);
  assert.equal(nowRadiusKm(s), 10);
  setNowRadiusKm(7, s);
  assert.equal(nowRadiusKm(s), null, 'fora das opções volta ao automático');
  setNowRadiusKm(5, s);
  setNowRadiusKm(null, s);
  assert.equal(nowRadiusKm(s), null);
  assert.equal(nowRadiusKm(undefined), null);
});
