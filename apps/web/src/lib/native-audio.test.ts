import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeWav, nativeAudio, nativeErrorCode, toBase64 } from './native-audio.ts';

test('acha a ponte do player do iPhone só quando está completa', () => {
  const fn = async () => ({ durationMs: 0, positionMs: 0 });
  assert.equal(nativeAudio({}), undefined);
  assert.equal(nativeAudio({ AskouTAudio: { play: fn } }), undefined, 'ponte incompleta');
  const bridge = { play: fn, pause: fn, stop: fn, onStopped: () => () => undefined };
  assert.equal(nativeAudio({ AskouTAudio: bridge }), bridge);
});

test('lê o código do erro do plugin', () => {
  assert.equal(nativeErrorCode({ code: 'UNSUPPORTED' }), 'UNSUPPORTED');
  assert.equal(nativeErrorCode(new Error('x')), undefined);
  assert.equal(nativeErrorCode(undefined), undefined);
});

test('base64 igual ao do Buffer, inclusive em áudio grande', () => {
  const bytes = new Uint8Array(100_000).map((_, i) => (i * 37) % 256);
  assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'));
});

test('WAV: cabeçalho PCM 16 bits mono e as amostras misturadas dos canais', () => {
  const left = new Float32Array([0, 1, -1, 0.5]);
  const right = new Float32Array([0, 1, -1, -0.5]);
  const wav = encodeWav({ numberOfChannels: 2, sampleRate: 48000, length: 4, getChannelData: (c) => (c === 0 ? left : right) });
  const view = new DataView(wav.buffer);
  const text = (at: number, n: number) => String.fromCharCode(...wav.subarray(at, at + n));
  assert.equal(wav.length, 44 + 8);
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 8);
  assert.deepEqual([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true)), [0, 32767, -32768, 0]);
});
