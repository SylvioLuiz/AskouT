import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatVoiceTime, pickVoiceMime, voiceProblemFrom } from './voice.ts';

test('formatVoiceTime: minutos e segundos', () => {
  assert.equal(formatVoiceTime(0), '0:00');
  assert.equal(formatVoiceTime(7_400), '0:07');
  assert.equal(formatVoiceTime(90_000), '1:30');
  assert.equal(formatVoiceTime(-5), '0:00');
});

test('pickVoiceMime: escolhe o primeiro formato que o navegador grava', () => {
  assert.equal(pickVoiceMime(() => true), 'audio/webm;codecs=opus');
  assert.equal(pickVoiceMime((m) => m === 'audio/mp4'), 'audio/mp4'); // Safari
  assert.equal(pickVoiceMime((m) => m.startsWith('audio/ogg')), 'audio/ogg;codecs=opus'); // Firefox
  assert.equal(pickVoiceMime(() => false), undefined);
});

test('voiceProblemFrom: traduz o erro do microfone', () => {
  assert.equal(voiceProblemFrom({ name: 'NotAllowedError' }), 'denied');
  assert.equal(voiceProblemFrom({ name: 'NotFoundError' }), 'no-device');
  assert.equal(voiceProblemFrom(new Error('x')), 'failed');
  assert.equal(voiceProblemFrom(undefined), 'failed');
});
