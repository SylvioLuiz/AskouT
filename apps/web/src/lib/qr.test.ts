import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBits, qrCapacityBytes, qrMatrix, qrSvg, reedSolomon } from './qr.ts';

test('Reed-Solomon: exemplo da especificação (HELLO WORLD, versão 1-M)', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(reedSolomon(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('bits de formato do nível M', () => {
  assert.equal(formatBits(0).toString(2).padStart(15, '0'), '101010000010010');
  assert.equal(formatBits(4).toString(2).padStart(15, '0'), '100010111111001');
});

test('capacidade em bytes de cada versão (nível M)', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(qrCapacityBytes), [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
});

test('a matriz tem os três localizadores, o módulo escuro fixo e o tamanho da versão', () => {
  const m = qrMatrix('https://askout.app/checkin');
  assert.equal(m.length, 25);
  assert.ok(m.every((row) => row.length === 25));
  for (const [x, y] of [[0, 0], [18, 0], [0, 18]] as const) {
    assert.equal(m[y]![x], true);
    assert.equal(m[y + 3]![x + 3], true, 'centro do localizador');
    assert.equal(m[y + 1]![x + 1], false, 'anel claro');
  }
  assert.equal(m[25 - 8]![8], true);
});

test('o tamanho do texto escolhe a versão; o que não cabe falha', () => {
  assert.equal(qrMatrix('a'.repeat(14)).length, 21);
  assert.equal(qrMatrix('a'.repeat(15)).length, 25);
  assert.equal(qrMatrix('a'.repeat(213)).length, 57);
  assert.throws(() => qrMatrix('a'.repeat(214)));
  assert.deepEqual(qrMatrix('mesmo texto'), qrMatrix('mesmo texto'));
});

test('SVG tem a margem clara e o caminho dos módulos escuros', () => {
  const svg = qrSvg(qrMatrix('oi'));
  assert.match(svg, /viewBox="0 0 29 29"/);
  assert.match(svg, /<path d="M/);
});
