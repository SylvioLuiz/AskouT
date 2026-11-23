import assert from 'node:assert/strict';
import { test } from 'node:test';
import { haptic } from './haptics.ts';

test('haptic: no app usa a ponte nativa e não o navigator.vibrate', () => {
  const played: string[] = [];
  const vibrated: number[] = [];
  haptic('success', { AskouTHaptics: { play: async (k: string) => void played.push(k) }, navigator: { vibrate: (ms: number) => (vibrated.push(ms), true) } });
  assert.deepEqual(played, ['success']);
  assert.deepEqual(vibrated, []);
});

test('haptic: no navegador cai no navigator.vibrate; sem nada, não quebra', () => {
  const vibrated: number[] = [];
  haptic('tick', { navigator: { vibrate: (ms: number) => (vibrated.push(ms), true) } });
  assert.deepEqual(vibrated, [4]);
  assert.doesNotThrow(() => haptic('tap', {}));
  assert.doesNotThrow(() => haptic('tap', { navigator: { vibrate: () => { throw new Error('bloqueado'); } } }));
});
