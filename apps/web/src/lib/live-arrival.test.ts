import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arrivalTag, REOPEN_EVERY_MS, reopenClosedArrivals } from './live-arrival.ts';
import type { FlashMatch } from './types.ts';

const match = (inviteId: string, themArrival: boolean) => ({ inviteId, themArrival, other: { userId: `u-${inviteId}` } }) as unknown as FlashMatch;

describe('reabrir a Live Activity da chegada', () => {
  it('só reabre a que o iPhone diz que não está na tela, e não pergunta de novo logo em seguida', async () => {
    const reopened: string[] = [];
    const asked = new Map<string, number>();
    const showing = async (tag: string) => tag !== arrivalTag('b', 'u-b');
    const deps = { showing, reopen: async (id: string) => reopened.push(id), asked, nowMs: 1000 };
    assert.deepEqual(await reopenClosedArrivals([match('a', true), match('b', true), match('c', false)], deps), ['b']);
    assert.deepEqual(await reopenClosedArrivals([match('b', true)], { ...deps, nowMs: 1000 + REOPEN_EVERY_MS - 1 }), []);
    assert.deepEqual(await reopenClosedArrivals([match('b', true)], { ...deps, nowMs: 1000 + REOPEN_EVERY_MS }), ['b']);
    assert.deepEqual(reopened, ['b', 'b']);
  });

  it('sem Live Activity (Android, navegador, iPhone antigo) não faz nada', async () => {
    assert.deepEqual(await reopenClosedArrivals([match('a', true)], { showing: undefined, reopen: async () => assert.fail(), asked: new Map(), nowMs: 0 }), []);
    assert.deepEqual(await reopenClosedArrivals([match('a', true)], { showing: async () => undefined, reopen: async () => assert.fail(), asked: new Map(), nowMs: 0 }), []);
  });
});
