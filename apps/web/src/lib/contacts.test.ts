import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanEmails, emailsFromVcf, sha256Hex } from './contacts.ts';

test('limpa e-mails: minúsculas, sem repetir, só válidos', () => {
  assert.deepEqual(cleanEmails([' Ana@Exemplo.com ', 'ana@exemplo.com', 'sem-arroba', 'a@b']), ['ana@exemplo.com']);
});

test('lê e-mails de um vCard, inclusive com dobra de linha e prefixo item1.', () => {
  const vcf = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ana\r\nEMAIL;TYPE=INTERNET:Ana@Exemplo.com\r\nitem1.EMAIL;type=HOME:bia@\r\n exemplo.com\r\nTEL:+5511999999999\r\nEND:VCARD\r\n';
  assert.deepEqual(emailsFromVcf(vcf), ['ana@exemplo.com', 'bia@exemplo.com']);
});

test('SHA-256 em hexadecimal', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
