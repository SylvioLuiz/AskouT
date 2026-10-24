import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INVITE_CARD_GOAL, inviteUrl, parseInvite, rememberInvite, shareableInviteUrl, showInviteCard, storeLink, takeInvite, whatsappUrl } from './invite.ts';

describe('card "Chame a galera" na Home', () => {
  it('aparece com menos de 5 amigos e some a partir do 5º', () => {
    assert.equal(INVITE_CARD_GOAL, 5);
    assert.equal(showInviteCard(0), true);
    assert.equal(showInviteCard(4), true);
    assert.equal(showInviteCard(5), false);
    assert.equal(showInviteCard(40), false);
  });
  it('não aparece enquanto a lista de amigos não chegou (ou falhou)', () => {
    assert.equal(showInviteCard(undefined), false);
  });
  it('compartilha o link do site enquanto não há loja e o da loja quando houver', () => {
    assert.equal(storeLink(undefined), undefined);
    assert.equal(storeLink('   '), undefined);
    assert.equal(storeLink('javascript:alert(1)'), undefined);
    assert.equal(storeLink('apps.apple.com/app/x'), undefined, 'sem http(s) não vale');
    assert.equal(storeLink(' https://apps.apple.com/br/app/askout/id1 '), 'https://apps.apple.com/br/app/askout/id1');
    assert.equal(shareableInviteUrl('https://askout.com.br', 'ana', undefined), 'https://askout.com.br/cadastro?convite=ana');
    assert.equal(shareableInviteUrl('https://askout.com.br', 'ana', 'https://loja.example/askout'), 'https://loja.example/askout');
  });
});

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
