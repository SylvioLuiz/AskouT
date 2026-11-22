import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cardCaption, hashtag, shareCardImage, shortUrl, wrapText } from './share-card.ts';

const mono = (s: string) => s.length; // 1 letra = 1 de largura

describe('cartão para outras redes', () => {
  it('quebra o título em linhas e põe reticências no que sobra', () => {
    assert.deepEqual(wrapText('samba de roda no bar', mono, 10, 3), ['samba de', 'roda no', 'bar']);
    assert.deepEqual(wrapText('samba de roda no bar do zé', mono, 10, 2), ['samba de', 'roda no…']);
    assert.deepEqual(wrapText('askout.app/eventos/abcdef', mono, 10, 3), ['askout.app', '/eventos/a', 'bcdef']);
    assert.deepEqual(wrapText('   ', mono, 10, 2), []);
  });
  it('monta a legenda com título, detalhes, convite, link e hashtags sem repetir', () => {
    const text = cardCaption({ title: 'Samba no Bar', lines: ['Sáb, 25 out · 20:00', '', 'Bar do Zé'], url: 'https://askout.app/eventos/1', invite: 'Bora?', tags: ['Samba de Roda', 'AskouT'] });
    assert.equal(text, 'Samba no Bar\nSáb, 25 out · 20:00\nBar do Zé\n\nBora? https://askout.app/eventos/1\n\n#askout #sambaderoda');
  });
  it('hashtag e link curto', () => {
    assert.equal(hashtag('Música ao vivo!'), 'musicaaovivo');
    assert.equal(shortUrl('https://askout.app/posts/9/'), 'askout.app/posts/9');
  });
  it('no app nativo usa a ponte com a legenda; versão antiga cai no salvar foto', async () => {
    const blob = new Blob([new Uint8Array([1, 2])], { type: 'image/png' });
    const calls: unknown[] = [];
    const result = await shareCardImage(blob, 'Samba no Bar', 'legenda', { AskouTFiles: { shareImage: async (o) => (calls.push(o), false) } });
    assert.equal(result, 'cancelled');
    assert.deepEqual(calls, [{ filename: 'samba-no-bar.png', base64: 'AQI=', text: 'legenda' }]);
    const old: unknown[] = [];
    assert.equal(await shareCardImage(blob, 'x', '', { AskouTFiles: { saveImages: async (o) => void old.push(o) } }), 'shared');
    assert.equal(old.length, 1);
  });
  it('no celular abre o menu com o arquivo e respeita o cancelamento', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
    const shared: ShareData[] = [];
    const nav = { canShare: () => true, share: async (d: ShareData) => void shared.push(d) };
    assert.equal(await shareCardImage(blob, 'post', 'x', { navigator: nav }), 'shared');
    assert.equal(shared[0]?.files?.[0]?.name, 'post.png');
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    assert.equal(await shareCardImage(blob, 'post', 'x', { navigator: { canShare: () => true, share: async () => Promise.reject(abort) } }), 'cancelled');
  });
});
