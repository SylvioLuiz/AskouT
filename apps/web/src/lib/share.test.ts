import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eventLink, eventShareText, profileLink, profileShareText } from './share.ts';

describe('compartilhar', () => {
  it('monta o link do evento', () => {
    assert.equal(eventLink('https://askout.app', 'abc 1'), 'https://askout.app/eventos/abc%201');
  });
  it('monta o link e o texto do perfil', () => {
    assert.equal(profileLink('https://askout.app', 'ana.silva'), 'https://askout.app/u/ana.silva');
    assert.equal(profileLink('https://askout.app', 'a b'), 'https://askout.app/u/a%20b');
    assert.match(profileShareText('ana'), /@ana/);
  });
  it('texto inclui o título', () => {
    assert.match(eventShareText('Show X'), /Show X/);
  });
});
