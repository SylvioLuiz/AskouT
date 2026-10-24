import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpCalendarFetcher, isPrivateAddress } from './http-calendar-fetcher.ts';

test('endereços internos são recusados e os públicos passam', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fd12::1', '::ffff:10.0.0.1', 'nao-e-ip']) {
    assert.equal(isPrivateAddress(a), true, a);
  }
  for (const a of ['8.8.8.8', '172.32.0.1', '142.250.78.14', '2800:3f0:4001:80a::200e']) assert.equal(isPrivateAddress(a), false, a);
});

test('o leitor não abre http, endereço interno nem nome que resolve para rede interna', async () => {
  const f = new HttpCalendarFetcher();
  await assert.rejects(f.fetch('http://exemplo.com/a.ics'), /https/);
  await assert.rejects(f.fetch('https://127.0.0.1/a.ics'), /público/);
  await assert.rejects(f.fetch('https://localhost/a.ics'), /público/);
});
