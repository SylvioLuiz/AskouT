import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkinLink, codeFromSearch, qrFileName, rememberCheckinReturn, takeCheckinReturn } from './checkin.ts';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

test('o link do QR leva o local e o código', () => {
  const link = checkinLink('https://askout.com.br', 'abc 1', 'Zx9_-Q8wLmN3pRtV2kYh');
  assert.equal(link, 'https://askout.com.br/checkin/abc%201?codigo=Zx9_-Q8wLmN3pRtV2kYh');
  assert.equal(codeFromSearch(new URL(link).search), 'Zx9_-Q8wLmN3pRtV2kYh');
});

test('código ausente ou malformado é recusado', () => {
  assert.equal(codeFromSearch(''), undefined);
  assert.equal(codeFromSearch('?codigo='), undefined);
  assert.equal(codeFromSearch('?codigo=curto'), undefined);
  assert.equal(codeFromSearch('?codigo=<script>alert(1)</script>'), undefined);
  assert.equal(codeFromSearch(`?codigo=${'a'.repeat(129)}`), undefined);
});

test('quem não entrou volta ao check-in depois do login, uma vez só', () => {
  const storage = memory();
  rememberCheckinReturn(storage, '/checkin/v1?codigo=Zx9_-Q8wLmN3pRtV2kYh');
  assert.equal(takeCheckinReturn(storage), '/checkin/v1?codigo=Zx9_-Q8wLmN3pRtV2kYh');
  assert.equal(takeCheckinReturn(storage), undefined);
});

test('só caminhos de check-in ficam guardados (nada de redirecionar para fora)', () => {
  const storage = memory();
  rememberCheckinReturn(storage, '//evil.example/x');
  rememberCheckinReturn(storage, 'https://evil.example/checkin/v1?codigo=Zx9_-Q8wLmN3pRtV2kYh');
  rememberCheckinReturn(storage, '/perfil');
  assert.equal(takeCheckinReturn(storage), undefined);
  assert.doesNotThrow(() => rememberCheckinReturn(undefined, '/checkin/v1?codigo=Zx9_-Q8wLmN3pRtV2kYh'));
  assert.equal(takeCheckinReturn(undefined), undefined);
});

test('nome do arquivo do QR', () => {
  assert.equal(qrFileName('Bar do Zé & Cia'), 'qr-bar-do-ze-cia.png');
  assert.equal(qrFileName('!!!'), 'qr-local.png');
});
