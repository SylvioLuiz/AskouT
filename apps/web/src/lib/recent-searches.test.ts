import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addRecent, buildSuggestions, cleanTerm, readRecent, RECENT_MAX, removeRecent, saveRecent } from './recent-searches.ts';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

describe('buscas recentes', () => {
  it('limpa o termo e recusa busca curta', () => {
    assert.equal(cleanTerm('  samba   de  raiz '), 'samba de raiz');
    assert.equal(cleanTerm('a'), '');
    assert.equal(cleanTerm('#'), '');
    assert.equal(cleanTerm('#sa'), '#sa');
  });
  it('repetido sobe, sem duplicar, e a lista tem limite', () => {
    let list: string[] = [];
    for (const t of ['samba', 'rock', 'Samba']) list = addRecent(list, t);
    assert.deepEqual(list, ['Samba', 'rock']);
    for (let i = 0; i < 12; i++) list = addRecent(list, `busca ${i}`);
    assert.equal(list.length, RECENT_MAX);
    assert.equal(list[0], 'busca 11');
    assert.deepEqual(addRecent(['a1'], 'x'), ['a1']);
  });
  it('remove um termo', () => {
    assert.deepEqual(removeRecent(['a1', 'b2'], 'a1'), ['b2']);
  });
  it('guarda por usuário, apaga quando esvazia e ignora lixo', () => {
    const s = memory();
    saveRecent(s, 'u', ['samba', 'rock']);
    assert.deepEqual(readRecent(s, 'u'), ['samba', 'rock']);
    assert.deepEqual(readRecent(s, 'outro'), []);
    saveRecent(s, 'u', []);
    assert.equal(s.data.size, 0);
    s.data.set('askout.recent-searches.u', '[1,"ok!",null,"x"]');
    assert.deepEqual(readRecent(s, 'u'), ['ok!']);
    s.data.set('askout.recent-searches.u', 'não é json');
    assert.deepEqual(readRecent(s, 'u'), []);
    assert.deepEqual(readRecent(undefined, 'u'), []);
  });
  it('sugestões: tags e rolês, sem repetir as recentes', () => {
    const out = buildSuggestions({ tags: [{ tag: 'samba' }, { tag: 'rock' }], places: [{ name: 'Bar do Zé' }, { name: 'bar do zé' }, { name: 'Balada Nova' }], recent: ['#rock'] });
    assert.deepEqual(out, ['#samba', 'Bar do Zé', 'Balada Nova']);
  });
});
