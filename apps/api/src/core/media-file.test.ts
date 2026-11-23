import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanFileName, parseChatFile } from './media.ts';

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));

test('parseChatFile: aceita PDF e Office conferindo os primeiros bytes', () => {
  const pdf = parseChatFile('application/pdf', bytes('%PDF-1.7 ...'), 'Ingresso.pdf');
  assert.equal(pdf.name, 'Ingresso.pdf');
  assert.ok(parseChatFile('application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes('PK\u0003\u0004xx'), 'a.docx'));
  assert.ok(parseChatFile('text/plain; charset=utf-8', bytes('lista de compras'), 'lista.txt'));
});

test('parseChatFile: recusa tipo fora da lista, disfarce e vazio', () => {
  assert.throws(() => parseChatFile('application/x-msdownload', bytes('MZ'), 'virus.exe'), /PDF, documento/);
  assert.throws(() => parseChatFile('application/pdf', bytes('PK\u0003\u0004'), 'falso.pdf'), /não parece/);
  assert.throws(() => parseChatFile('text/plain', bytes('a\u0000b'), 'bin.txt'), /não parece/);
  assert.throws(() => parseChatFile('application/pdf', new Uint8Array(), 'x.pdf'), /vazio/);
});

test('cleanFileName: tira pasta e caracteres estranhos, encurta mantendo a extensão', () => {
  assert.equal(cleanFileName('C:\\Users\\ana\\Ingresso: show?.pdf'), 'Ingresso show.pdf');
  assert.equal(cleanFileName(''), 'arquivo');
  const long = cleanFileName(`${'a'.repeat(200)}.pdf`);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('.pdf'));
});

test('parseChatFile: RTF pelo cabeçalho', () => {
  assert.ok(parseChatFile('application/rtf', new Uint8Array(Buffer.from('{' + String.fromCharCode(92) + 'rtf1 oi}', 'latin1')), 'a.rtf'));
});
