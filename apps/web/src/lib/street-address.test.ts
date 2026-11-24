import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HOUSE_NUMBER_RE, numberFromQuery, streetAddress } from './street-address.ts';

describe('endereço de rua com número', () => {
  it('monta nome e endereço sem repetir a rua (nem abreviada)', () => {
    assert.deepEqual(streetAddress({ name: 'Rua Augusta', address: 'Consolação - São Paulo - SP' }, '1500', 'apto 12'), {
      name: 'Rua Augusta, 1500',
      address: 'Rua Augusta, 1500 - apto 12 - Consolação - São Paulo - SP',
    });
    assert.equal(streetAddress({ name: 'Rua Augusta', address: 'R. Augusta - Consolação, São Paulo - SP, Brasil' }, '10', '').address, 'Rua Augusta, 10 - Consolação, São Paulo - SP, Brasil');
    assert.equal(streetAddress({ name: 'Rua A', address: null }, '1', ' ').address, 'Rua A, 1');
  });
  it('pega o número digitado na busca, mas não o do nome da rua', () => {
    assert.equal(numberFromQuery('rua augusta 1500', 'Rua Augusta'), '1500');
    assert.equal(numberFromQuery('rua augusta, 20b', 'Rua Augusta'), '20B');
    assert.equal(numberFromQuery('rua augusta', 'Rua Augusta'), '');
    assert.equal(numberFromQuery('rua 7', 'Rua 7'), '');
    assert.equal(numberFromQuery('rua 7 120', 'Rua 7'), '120');
  });
  it('aceita só número de endereço', () => {
    for (const ok of ['123', '20B', '12-A', '3/4']) assert.ok(HOUSE_NUMBER_RE.test(ok), ok);
    for (const bad of ['', 'abc', 'S/N', '12345678901', '1 2']) assert.ok(!HOUSE_NUMBER_RE.test(bad), bad);
  });
});
