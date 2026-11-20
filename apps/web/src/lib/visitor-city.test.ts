import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HERE_ID, readVisitorCity, saveVisitorCity } from './visitor-city.ts';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

test('sem escolha não há cidade (o app não carrega nada)', () => {
  assert.equal(readVisitorCity(memory()), undefined);
  assert.equal(readVisitorCity(undefined), undefined);
});

test('guarda a cidade escolhida e a própria localização; lixo volta ao padrão', () => {
  const s = memory();
  saveVisitorCity(s, { id: 'santos', position: { lat: 0, lng: 0 } });
  assert.equal(readVisitorCity(s)?.name, 'Santos');
  saveVisitorCity(s, { id: HERE_ID, position: { lat: -23.9, lng: -46.3 } });
  assert.deepEqual(readVisitorCity(s)?.position, { lat: -23.9, lng: -46.3 });
  s.setItem('askout.visitor.city', '{"id":"aqui","position":{"lat":999,"lng":0}}');
  assert.equal(readVisitorCity(s), undefined);
  s.setItem('askout.visitor.city', 'não é json');
  assert.equal(readVisitorCity(s), undefined);
});

test('volta depois do login só para telas do visitante', async () => {
  const { rememberLoginReturn, takeLoginReturn } = await import('./visitor-city.ts');
  const m = new Map<string, string>();
  const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  rememberLoginReturn(s, '/eventos/abc');
  assert.equal(takeLoginReturn(s), '/eventos/abc');
  assert.equal(takeLoginReturn(s), undefined, 'usa uma vez só');
  rememberLoginReturn(s, '//malicioso.com');
  assert.equal(takeLoginReturn(s), undefined);
  rememberLoginReturn(s, '/conversas/1');
  assert.equal(takeLoginReturn(s), undefined);
  rememberLoginReturn(s, '/explorar');
  assert.equal(takeLoginReturn(s), undefined, 'Explorar é só com conta');
  rememberLoginReturn(s, '/bares/v1?x=1');
  assert.equal(takeLoginReturn(s), '/bares/v1?x=1');
});
