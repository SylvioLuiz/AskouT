import assert from 'node:assert/strict';
import { test } from 'node:test';
import { saveBlocker, splitProblems } from './editor-check.ts';
import { dataUrlBytes, fitWithin, mediaSrc } from './image.ts';

test('saveBlocker: o Salvar sempre explica por que não seguiu', () => {
  assert.equal(saveBlocker(0, {}), 'Nada mudou ainda: altere algum campo antes de salvar.');
  assert.equal(saveBlocker(2, {}), undefined);
  assert.equal(saveBlocker(1, { lat: 'Latitude entre -90 e 90' }, { lat: 'Latitude' }), 'Corrija antes de salvar: Latitude: Latitude entre -90 e 90');
  assert.equal(saveBlocker(1, { image: 'Use JPEG' }), 'Corrija antes de salvar: Use JPEG');
  assert.equal(saveBlocker(1, { name: undefined }), undefined);
});

test('splitProblems: campo que a tela não mostra vai para o aviso, não trava o botão em silêncio', () => {
  const r = splitProblems({ name: 'curto', venue: 'Dados do local inválidos', image: 'Use JPEG' }, ['name', 'imageData'], { image: 'imageData' });
  assert.deepEqual(r.byField, { name: 'curto', imageData: 'Use JPEG' });
  assert.deepEqual(r.loose, ['Dados do local inválidos']);
  assert.deepEqual(splitProblems(undefined, ['name']), { byField: {}, loose: [] });
});

test('mediaSrc: capa enviada pelo app abre pela API; https e anexo ficam; o resto some', () => {
  assert.equal(mediaSrc('https://api.x', '/venues/1/cover?v=2'), 'https://api.x/venues/1/cover?v=2');
  assert.equal(mediaSrc('/api', '/venues/1/logo?v=2'), '/api/venues/1/logo?v=2');
  assert.equal(mediaSrc('/api', 'https://cdn.x/a.jpg'), 'https://cdn.x/a.jpg');
  assert.equal(mediaSrc('/api', 'data:image/jpeg;base64,AAAA'), 'data:image/jpeg;base64,AAAA');
  assert.equal(mediaSrc('/api', 'javascript:alert(1)'), null);
  assert.equal(mediaSrc('/api', ''), null);
});

test('fitWithin e dataUrlBytes: reduz sem ampliar e conta os bytes do base64', () => {
  assert.deepEqual(fitWithin(4000, 2000, 1280), { width: 1280, height: 640 });
  assert.deepEqual(fitWithin(300, 200, 1280), { width: 300, height: 200 });
  assert.equal(dataUrlBytes('data:image/jpeg;base64,QUJD'), 3);
  assert.equal(dataUrlBytes('data:image/jpeg;base64,QUI='), 2);
});
