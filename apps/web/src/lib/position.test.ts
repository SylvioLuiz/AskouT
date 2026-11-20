import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { cachedPosition, positionWithin, rememberPosition, requestPosition, resetPositionForTests } from './position.ts';

type Ok = (p: { coords: { latitude: number; longitude: number } }) => void;
type Fail = (e: { code: number }) => void;

function fakeGeolocation(behavior: 'ok' | 'denied' | 'silent' | 'error') {
  const calls = { n: 0 };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition(ok: Ok, fail: Fail) {
          calls.n++;
          if (behavior === 'ok') ok({ coords: { latitude: -23.9, longitude: -46.3 } });
          else if (behavior === 'denied') fail({ code: 1 });
          else if (behavior === 'error') fail({ code: 2 });
        },
      },
    },
  });
  return calls;
}

describe('posição do aparelho, uma só para o app', () => {
  beforeEach(() => resetPositionForTests());

  it('pede uma vez e reaproveita a resposta', async () => {
    const calls = fakeGeolocation('ok');
    assert.deepEqual(await requestPosition(), { status: 'ok', position: { lat: -23.9, lng: -46.3 } });
    assert.deepEqual(await requestPosition(), { status: 'ok', position: { lat: -23.9, lng: -46.3 } });
    assert.equal(calls.n, 1);
    assert.deepEqual(cachedPosition(), { lat: -23.9, lng: -46.3 });
  });

  it('pedidos ao mesmo tempo viram um só pedido ao navegador', async () => {
    const calls = fakeGeolocation('ok');
    await Promise.all([requestPosition(), requestPosition(), positionWithin(500)]);
    assert.equal(calls.n, 1);
  });

  it('negativa da pessoa vale para a sessão; falha de sinal tenta de novo', async () => {
    const denied = fakeGeolocation('denied');
    assert.deepEqual(await requestPosition(), { status: 'denied' });
    assert.deepEqual(await requestPosition(), { status: 'denied' });
    assert.equal(denied.n, 1, 'não pergunta de novo depois do não');
    resetPositionForTests();
    const flaky = fakeGeolocation('error');
    assert.deepEqual(await requestPosition(), { status: 'unavailable' });
    assert.deepEqual(await requestPosition(), { status: 'unavailable' });
    assert.equal(flaky.n, 2);
  });

  it('positionWithin não trava esperando a pessoa decidir', async () => {
    fakeGeolocation('silent');
    const started = Date.now();
    assert.equal(await positionWithin(40), undefined);
    assert.ok(Date.now() - started < 500);
  });

  it('posição guardada de outro lugar do app vale como cache', async () => {
    const calls = fakeGeolocation('ok');
    rememberPosition({ lat: 1, lng: 2 });
    assert.deepEqual(await positionWithin(100), { lat: 1, lng: 2 });
    assert.equal(calls.n, 0);
  });

  it('sem geolocalização no aparelho, devolve indisponível', async () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    assert.deepEqual(await requestPosition(), { status: 'unavailable' });
  });
});
