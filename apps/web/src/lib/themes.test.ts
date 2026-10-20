import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterByThemes, readThemes, saveThemes, themeOfCategory, themeOfEvent } from './themes.ts';

describe('temas de rolê', () => {
  it('reconhece o tema pelo tipo do local', () => {
    assert.equal(themeOfCategory('bar'), 'BAR');
    assert.equal(themeOfCategory('Boteco'), 'BAR');
    assert.equal(themeOfCategory('pub'), 'BAR');
    assert.equal(themeOfCategory('night_club'), 'NIGHT');
    assert.equal(themeOfCategory('nightclub'), 'NIGHT');
    assert.equal(themeOfCategory('Balada eletrônica'), 'NIGHT');
    assert.equal(themeOfCategory('Bar e balada'), 'NIGHT');
    assert.equal(themeOfCategory('cafe'), undefined);
    assert.equal(themeOfCategory(null), undefined);
  });
  it('evento: Noite é balada, o resto segue o local e cai em bares', () => {
    assert.equal(themeOfEvent({ kind: 'NIGHT', venue: { category: 'Bar' } }), 'NIGHT');
    assert.equal(themeOfEvent({ kind: 'SHOW', venue: { category: 'Casa noturna' } }), 'NIGHT');
    assert.equal(themeOfEvent({ kind: 'SHOW', venue: { category: null } }), 'BAR');
  });
  it('filtra pelos temas escolhidos; vazio mantém tudo', () => {
    const items = [{ c: 'bar' }, { c: 'night_club' }, { c: 'cafe' }];
    const of = (i: { c: string }) => themeOfCategory(i.c);
    assert.equal(filterByThemes(items, new Set(), of).length, 3);
    assert.deepEqual(filterByThemes(items, new Set(['NIGHT' as const]), of).map((i) => i.c), ['night_club']);
    assert.deepEqual(filterByThemes(items, new Set(['BAR' as const, 'NIGHT' as const]), of).map((i) => i.c), ['bar', 'night_club']);
  });
  it('guarda a escolha e ignora lixo', () => {
    const data = new Map<string, string>();
    const s = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    assert.deepEqual(readThemes(s, 'u'), []);
    saveThemes(s, 'u', ['NIGHT']);
    assert.deepEqual(readThemes(s, 'u'), ['NIGHT']);
    data.set('askout.themes.u', 'não é json');
    assert.deepEqual(readThemes(s, 'u'), []);
    data.set('askout.themes.u', '["X","BAR"]');
    assert.deepEqual(readThemes(s, 'u'), ['BAR']);
    assert.deepEqual(readThemes(undefined, 'u'), []);
  });
});
