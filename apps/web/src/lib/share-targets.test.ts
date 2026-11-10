import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chatLinkMessage, emailLink, filterTargets, nativeShare, nativeShareAvailable, sentText, shareTargets, telegramLink, whatsappLink } from './share-targets.ts';
import type { ConversationItem, PublicProfile } from './types.ts';

const person = (userId: string, username: string, displayName = username): PublicProfile => ({ userId, username, displayName, avatarUrl: null, isPrivate: false });
const direct = (id: string, other: PublicProfile, canSend = true): ConversationItem => ({ id, type: 'DIRECT', other, name: null, imageUrl: null, memberCount: 2, lastMessage: null, unread: 0, canSend, pinned: false, muted: false });
const group = (id: string, name: string): ConversationItem => ({ id, type: 'GROUP', other: null, name, imageUrl: null, memberCount: 4, lastMessage: null, unread: 0, canSend: true, pinned: false, muted: false });

describe('destinos de compartilhar', () => {
  it('conversas primeiro, depois amigos sem conversa, sem repetir', () => {
    const ana = person('1', 'ana', 'Ana Souza');
    const bia = person('2', 'bia');
    const caio = person('3', 'caio');
    const list = shareTargets([direct('c1', ana), group('g1', 'Rolê de sexta'), direct('c3', caio, false)], [ana, bia, caio]);
    assert.deepEqual(list.map((x) => x.key), ['c:c1', 'c:g1', 'u:2', 'u:3']);
    assert.equal(list[2]?.userId, '2');
    assert.equal(list[1]?.group?.name, 'Rolê de sexta');
  });
  it('busca pelo usuário ou pelo nome, sem acento', () => {
    const list = shareTargets([direct('c1', person('1', 'ana', 'Ana Souza')), group('g1', 'Rolê de sexta')], [person('2', 'joao', 'João')]);
    assert.deepEqual(filterTargets(list, 'souza').map((x) => x.key), ['c:c1']);
    assert.deepEqual(filterTargets(list, 'role').map((x) => x.key), ['c:g1']);
    assert.deepEqual(filterTargets(list, 'JOÃO').map((x) => x.key), ['u:2']);
    assert.deepEqual(filterTargets(list, '@ana').map((x) => x.key), ['c:c1']);
    assert.equal(filterTargets(list, '  ').length, 3);
  });
});

describe('links e textos de compartilhar', () => {
  it('mensagem opcional vem antes do link', () => {
    assert.equal(chatLinkMessage('Olha', 'https://a.b/p/1'), 'Olha: https://a.b/p/1');
    assert.equal(chatLinkMessage('Olha', 'https://a.b/p/1', '  bora? '), 'bora?\n\nOlha: https://a.b/p/1');
  });
  it('monta os links do WhatsApp, Telegram e e-mail', () => {
    assert.equal(whatsappLink('Olha isso', 'https://a.b/p/1'), 'https://wa.me/?text=Olha%20isso%20https%3A%2F%2Fa.b%2Fp%2F1');
    assert.equal(telegramLink('Oi', 'https://a.b'), 'https://t.me/share/url?url=https%3A%2F%2Fa.b&text=Oi');
    assert.match(emailLink('AskouT', 'Oi', 'https://a.b'), /^mailto:\?subject=AskouT&body=Oi%0A%0Ahttps/);
  });
  it('retorno de envio', () => {
    assert.equal(sentText([]), '');
    assert.equal(sentText(['ana']), 'Enviado para ana.');
    assert.equal(sentText(['ana', 'bia', 'caio']), 'Enviado para ana e mais 2.');
  });
});

describe('menu do aparelho', () => {
  const data = { title: 'AskouT', text: 'Oi', url: 'https://a.b' };
  it('prefere a ponte do app nativo', async () => {
    let used = '';
    const env = { AskouTShare: { share: async () => { used = 'native'; } }, navigator: { share: async () => { used = 'web'; } } };
    assert.equal(nativeShareAvailable(env), true);
    assert.equal(await nativeShare(data, env), true);
    assert.equal(used, 'native');
  });
  it('fechar o menu não é erro', async () => {
    assert.equal(await nativeShare(data, { AskouTShare: { share: async () => Promise.reject(new Error('Share canceled')) } }), false);
    assert.equal(await nativeShare(data, { navigator: { share: async () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })) } }), false);
  });
  it('sem menu no aparelho', async () => {
    assert.equal(nativeShareAvailable({}), false);
    await assert.rejects(nativeShare(data, {}));
  });
});
