import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampCaptionY, durationLabel, nativeGallery } from './gallery.ts';

test('galeria nativa só vale com todos os métodos', () => {
  assert.equal(nativeGallery({}), undefined);
  assert.equal(nativeGallery({ AskouTGallery: { access: async () => 'full' } }), undefined);
  const fn = async () => undefined as never;
  const full = { access: fn, request: fn, recent: fn, file: fn, manage: fn, openSettings: fn };
  assert.equal(nativeGallery({ AskouTGallery: full }), full);
});

test('duração do vídeo na miniatura', () => {
  assert.equal(durationLabel(7.4), '0:07');
  assert.equal(durationLabel(92), '1:32');
  assert.equal(durationLabel(undefined), '');
  assert.equal(durationLabel(NaN), '');
});

test('texto do story fica entre 10% e 90% da tela', () => {
  assert.equal(clampCaptionY(0), 0.1);
  assert.equal(clampCaptionY(1), 0.9);
  assert.equal(clampCaptionY(0.42), 0.42);
  assert.equal(clampCaptionY(NaN), 0.5);
});
