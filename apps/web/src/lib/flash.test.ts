import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { distanceMeters, flashNoteProblem, formatAge, formatDistance, formatRemaining, geolocationMessage, minutesLeft } from './flash.ts';

describe('distanceMeters', () => {
  it('é zero para o mesmo ponto', () => {
    assert.equal(distanceMeters({ lat: -23.55, lng: -46.63 }, { lat: -23.55, lng: -46.63 }), 0);
  });
  it('Praça da Sé até a Avenida Paulista (MASP) fica em torno de 2,6 km', () => {
    const d = distanceMeters({ lat: -23.5503, lng: -46.6339 }, { lat: -23.5614, lng: -46.6559 });
    assert.ok(d > 2400 && d < 2800, String(d));
  });
  it('um grau de latitude vale cerca de 111 km', () => {
    const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    assert.ok(Math.abs(d - 111_195) < 300, String(d));
  });
  it('é simétrica', () => {
    const a = { lat: -23.5, lng: -46.6 };
    const b = { lat: -22.9, lng: -43.2 };
    assert.equal(distanceMeters(a, b), distanceMeters(b, a));
  });
});

describe('formatDistance', () => {
  it('perto: passos de 10 m, nunca 0 m', () => {
    assert.equal(formatDistance(3), '10 m');
    assert.equal(formatDistance(84), '80 m');
  });
  it('médio: passos de 50 m', () => assert.equal(formatDistance(430), '450 m'));
  it('km com vírgula e uma casa até 10 km', () => {
    assert.equal(formatDistance(1240), '1,2 km');
    assert.equal(formatDistance(15_400), '15 km');
  });
  it('valor inválido vira traço', () => assert.equal(formatDistance(Number.NaN), '—'));
});

describe('tempo', () => {
  it('minutesLeft arredonda para cima e não fica negativo', () => {
    const now = Date.parse('2026-10-13T12:00:00Z');
    assert.equal(minutesLeft('2026-10-13T12:00:01Z', now), 1);
    assert.equal(minutesLeft('2026-10-13T11:59:00Z', now), 0);
    assert.equal(minutesLeft('lixo', now), 0);
  });
  it('formatRemaining', () => {
    assert.equal(formatRemaining(0), 'acabou');
    assert.equal(formatRemaining(5), '5 min');
    assert.equal(formatRemaining(60), '1 h');
    assert.equal(formatRemaining(95), '1 h 35 min');
  });
  it('formatAge usa o relógio do servidor', () => {
    const now = '2026-10-13T12:00:00Z';
    assert.equal(formatAge('2026-10-13T11:59:58Z', now), 'agora');
    assert.equal(formatAge('2026-10-13T11:59:30Z', now), 'há 30 s');
    assert.equal(formatAge('2026-10-13T11:56:00Z', now), 'há 4 min');
  });
});

describe('recado e permissões', () => {
  it('recado até 60 caracteres', () => {
    assert.equal(flashNoteProblem('a'.repeat(60)), undefined);
    assert.ok(flashNoteProblem('a'.repeat(61)));
  });
  it('mensagens de geolocalização', () => {
    assert.match(geolocationMessage(1, true), /bloqueada/);
    assert.match(geolocationMessage(undefined, false), /https/);
    assert.match(geolocationMessage(2, true), /sinal/);
  });
});
