import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentType, fileLabel, fileProblem, formatFileSize } from './chat-file.ts';

test('documentType: confia no tipo aceito; senão, pela extensão', () => {
  assert.equal(documentType('Ingresso.pdf', 'application/pdf'), 'application/pdf');
  assert.equal(documentType('Planilha.xlsx', 'application/octet-stream'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(documentType('foto.exe', ''), undefined);
});

test('fileProblem: tipo, vazio e 25 MB', () => {
  assert.equal(fileProblem({ name: 'a.pdf', type: 'application/pdf', size: 10 }), undefined);
  assert.match(fileProblem({ name: 'a.zip', type: 'application/zip', size: 10 })!, /PDF/);
  assert.match(fileProblem({ name: 'a.pdf', type: 'application/pdf', size: 0 })!, /vazio/);
  assert.match(fileProblem({ name: 'a.pdf', type: 'application/pdf', size: 26 * 1024 * 1024 })!, /25 MB/);
});

test('fileLabel e formatFileSize', () => {
  assert.equal(fileLabel('x.PDF'), 'PDF');
  assert.equal(fileLabel('x.docx'), 'Documento');
  assert.equal(fileLabel('x.csv'), 'Planilha');
  assert.equal(formatFileSize(340 * 1024), '340 KB');
  assert.equal(formatFileSize(1.25 * 1024 * 1024), '1,3 MB');
});
