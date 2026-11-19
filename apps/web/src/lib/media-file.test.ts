import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaTypeOf } from './media-file.ts';

test('mediaTypeOf: tipo vazio ou alternativo vira o tipo aceito pelo servidor', () => {
  assert.equal(mediaTypeOf({ name: 'VID_2026.mp4', type: '' }), 'video/mp4');
  assert.equal(mediaTypeOf({ name: 'IMG_1.MOV', type: '' }), 'video/quicktime');
  assert.equal(mediaTypeOf({ name: 'clip.m4v', type: 'video/x-m4v' }), 'video/mp4');
  assert.equal(mediaTypeOf({ name: 'x.webm', type: 'application/octet-stream' }), 'video/webm');
  assert.equal(mediaTypeOf({ name: 'foto.jpg', type: 'image/jpeg' }), 'image/jpeg');
  assert.equal(mediaTypeOf({ name: 'sem-extensao', type: '' }), '');
});
