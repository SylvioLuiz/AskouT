import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasSound } from './sound.ts';

test('só item com vídeo tem botão de som (por enquanto)', () => {
  assert.equal(hasSound({ videoPath: '/posts/videos/x' }), true);
  assert.equal(hasSound({ videoPath: null }), false);
  assert.equal(hasSound({}), false);
});
