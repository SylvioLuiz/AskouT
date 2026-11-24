import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkKey } from './network-key.ts';

test('chave da rede: hash estável, sem o IP, e vazia sem endereço', () => {
  const a = networkKey('200.1.2.3');
  assert.equal(a, networkKey('200.1.2.3'));
  assert.notEqual(a, networkKey('200.1.2.4'));
  assert.ok(!a.includes('200'));
  assert.equal(networkKey(undefined), '');
  assert.equal(networkKey(''), '');
});

test('chave da rede: IPv4 dentro de IPv6 é o mesmo IPv4; IPv6 usa o prefixo /64', () => {
  assert.equal(networkKey('::ffff:200.1.2.3'), networkKey('200.1.2.3'));
  assert.equal(networkKey('2804:14c:65a1:4000:1111:2222:3333:4444'), networkKey('2804:14c:65a1:4000:aaaa::1'));
  assert.equal(networkKey('2804:014c:65a1:4000::1'), networkKey('2804:14c:65a1:4000:9::9'));
  assert.notEqual(networkKey('2804:14c:65a1:4000::1'), networkKey('2804:14c:65a1:4001::1'));
  assert.equal(networkKey('2804:14c::1'), networkKey('2804:14c:0:0:5::'));
});
