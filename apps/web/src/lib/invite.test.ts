import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inviteUrl, parseInvite, rememberInvite, takeInvite, whatsappUrl } from './invite.ts';

describe('convite por link', () => {
  it('monta o link e o WhatsApp', () => {
    assert.equal(inviteUrl('https://askout.app', 'ana.s'), 'https://askout.app/cadastro?convite=ana.s');
    const wa = whatsappUrl('Oi', 'https://x/y?a=1');
    assert.ok(wa.startsWith('https://wa.me/?text='));
    assert.equal(decodeURIComponent(wa.split('text=')[1] ?? ''), 'Oi https://x/y?a=1');
  });
  it('só aceita usuário no formato certo', () => {
    assert.equal(parseInvite('@Ana.S'), 'ana.s');
    assert.equal(parseInvite('ab'), undefined);
    assert.equal(parseInvite('a b c'), undefined);
    assert.equal(parseInvite('<script>'), undefined);
    assert.equal(parseInvite(null), undefined);
  });
  it('vale uma vez só', () => {
    const data = new Map<string, string>();
    const s = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
    rememberInvite(s, 'ana');
    assert.equal(takeInvite(s), 'ana');
    assert.equal(takeInvite(s), undefined);
    assert.equal(takeInvite(undefined), undefined);
  });
});
