import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eventLink, eventShareText } from './share.ts';

describe('compartilhar', () => {
  it('monta o link do evento', () => {
    assert.equal(eventLink('https://askout.app', 'abc 1'), 'https://askout.app/eventos/abc%201');
  });
  it('texto inclui o título', () => {
    assert.match(eventShareText('Show X'), /Show X/);
  });
});
