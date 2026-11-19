import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterByThemes, readThemes, saveThemes, THEMES, themeFilter, themeOfCategory, themeOfEvent, themesOfCategory, themesOfEvent, userThemes } from './themes.ts';

describe('temas de rolê', () => {
  it('reconhece o tema pelo tipo do local', () => {
    assert.equal(themeOfCategory('bar'), 'BAR');
    assert.equal(themeOfCategory('Boteco'), 'BAR');
    assert.equal(themeOfCategory('pub'), 'BAR');
    assert.equal(themeOfCategory('night_club'), 'NIGHT');
    assert.equal(themeOfCategory('nightclub'), 'NIGHT');
    assert.equal(themeOfCategory('Balada eletrônica'), 'NIGHT');
    assert.equal(themeOfCategory('Bar e balada'), 'NIGHT');
    assert.equal(themeOfCategory('cafe'), 'CAFE');
    assert.equal(themeOfCategory('pharmacy'), undefined);
    assert.equal(themeOfCategory(null), undefined);
  });
  it('evento: Noite é balada, o resto segue o local e cai em bares', () => {
    assert.equal(themeOfEvent({ kind: 'NIGHT', venue: { category: 'Bar' } }), 'NIGHT');
    assert.equal(themeOfEvent({ kind: 'SHOW', venue: { category: 'Casa noturna' } }), 'NIGHT');
    assert.equal(themeOfEvent({ kind: 'OTHER', venue: { category: null } }), 'BAR');
  });
  it('gostos novos: local e evento podem ter mais de um', () => {
    assert.deepEqual(themesOfCategory('Bar com música ao vivo'), ['BAR', 'SHOW']);
    assert.deepEqual(themesOfCategory('restaurant'), ['FOOD']);
    assert.deepEqual(themesOfCategory('cafe'), ['CAFE']);
    assert.deepEqual(themesOfCategory('movie_theater'), ['CULTURE']);
    assert.deepEqual(themesOfCategory('Karaokê'), ['GAMES']);
    assert.deepEqual(themesOfCategory('parking'), [], 'estacionamento não é parque');
    assert.deepEqual(themesOfCategory('Parque Ibirapuera'), ['OUTDOOR']);
    assert.deepEqual(themesOfCategory('Estádio'), ['SPORT']);
    assert.deepEqual(themesOfEvent({ kind: 'SHOW', venue: { category: null } }), ['SHOW']);
    assert.deepEqual(themesOfEvent({ kind: 'CINEMA', venue: { category: 'Bar' } }), ['CULTURE', 'BAR']);
    assert.deepEqual(themesOfEvent({ kind: 'GASTRONOMY', venue: { category: 'Balada' } }), ['NIGHT', 'FOOD']);
    const items = [{ c: 'Bar com música ao vivo' }, { c: 'cafe' }];
    assert.deepEqual(filterByThemes(items, new Set(['SHOW' as const]), (i) => themesOfCategory(i.c)).map((i) => i.c), ['Bar com música ao vivo']);
  });
  it('gostos da conta valem antes dos do navegador; marcar tudo não filtra', () => {
    const s = { getItem: (k: string) => (k === 'askout.themes.u' ? '["NIGHT"]' : null) };
    assert.deepEqual(userThemes(s, { id: 'u', tastes: ['SHOW', 'X', 'BAR'] }), ['BAR', 'SHOW']);
    assert.deepEqual(userThemes(s, { id: 'u', tastes: [] }), ['NIGHT']);
    assert.deepEqual(userThemes(s, { id: 'u' }), ['NIGHT']);
    assert.equal(themeFilter(THEMES.map((t) => t.id)).size, 0);
    assert.deepEqual([...themeFilter(['CAFE'])], ['CAFE']);
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
