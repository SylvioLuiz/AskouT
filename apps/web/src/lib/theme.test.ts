import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyTheme, isThemeChoice, readTheme, saveTheme, THEME_KEY } from './theme.ts';

describe('tema', () => {
  it('lê só valores válidos e nunca lança', () => {
    assert.equal(readTheme({ getItem: () => 'dark' }), 'dark');
    assert.equal(readTheme({ getItem: () => 'rosa' }), 'system');
    assert.equal(readTheme({ getItem: () => null }), 'system');
    assert.equal(readTheme({ getItem: () => { throw new Error('bloqueado'); } }), 'system');
    assert.equal(readTheme(undefined), 'system');
    assert.equal(isThemeChoice('light'), true);
    assert.equal(isThemeChoice(1), false);
  });
  it('aplica e guarda', () => {
    const attrs = new Map<string, string>();
    const root = { setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) };
    applyTheme('dark', root);
    assert.equal(attrs.get('data-theme'), 'dark');
    applyTheme('system', root);
    assert.equal(attrs.has('data-theme'), false);
    const store = new Map<string, string>();
    const storage = { setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    saveTheme('light', storage);
    assert.equal(store.get(THEME_KEY), 'light');
    saveTheme('system', storage);
    assert.equal(store.has(THEME_KEY), false);
    assert.doesNotThrow(() => saveTheme('dark', { setItem: () => { throw new Error('x'); }, removeItem: () => undefined }));
  });
});
