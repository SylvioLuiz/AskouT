import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commentEvidence, parseCommentGif } from './gif.ts';
import { GiphyGifSource } from '../infra/giphy/giphy-gif-source.ts';
import { FakeGifSource } from './testing/in-memory.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;
const GIF = { id: 'abc123XYZ', url: 'https://media2.giphy.com/media/abc123XYZ/200w.gif' };

test('parseCommentGif: só id e https em servidor da Giphy', () => {
  assert.equal(parseCommentGif(undefined), null);
  assert.equal(parseCommentGif(null), null);
  assert.deepEqual(parseCommentGif(GIF), GIF);
  assert.ok(parseCommentGif({ id: 'abc123XYZ', url: 'https://media.giphy.com/media/abc123XYZ/giphy.gif' }));
  assert.ok(parseCommentGif({ id: 'abc123XYZ', url: 'https://i.giphy.com/abc123XYZ.gif' }));
  const bad: unknown[] = [
    'texto',
    [],
    {},
    { id: 'abc123XYZ' },
    { id: 'abc', url: GIF.url },
    { id: 'abc 123!', url: GIF.url },
    { id: GIF.id, url: 'http://media2.giphy.com/media/abc123XYZ/200w.gif' },
    { id: GIF.id, url: 'https://evil.com/media/abc123XYZ/200w.gif' },
    { id: GIF.id, url: 'https://media2.giphy.com.evil.com/x.gif' },
    { id: GIF.id, url: 'https://evilgiphy.com/x.gif' },
    { id: GIF.id, url: 'https://user:pw@media2.giphy.com/x.gif' },
    { id: GIF.id, url: 'https://media2.giphy.com:8443/x.gif' },
    { id: GIF.id, url: 'javascript:alert(1)' },
    { id: GIF.id, url: `https://media2.giphy.com/${'a'.repeat(600)}` },
    { id: GIF.id, url: 42 },
  ];
  for (const raw of bad) assert.throws(() => parseCommentGif(raw), (e: unknown) => (e as { code?: string }).code === 'VALIDATION', JSON.stringify(raw));
});

test('commentEvidence: texto, GIF ou os dois', () => {
  assert.equal(commentEvidence('  oi  ', null), 'oi');
  assert.equal(commentEvidence('', GIF.url), `[GIF] ${GIF.url}`);
  assert.equal(commentEvidence('oi', GIF.url), `oi [GIF] ${GIF.url}`);
});

test('busca de GIFs: desligada sem a Giphy; com ela, trending, busca e limites', async () => {
  const off = makeWorld();
  assert.equal(off.core.gifs.enabled, false);
  assert.deepEqual(await off.core.gifs.trending(), { enabled: false, items: [], nextOffset: null });
  assert.equal((await off.core.gifs.search({ q: 'festa' })).enabled, false);

  const gifs = new FakeGifSource();
  const w = makeWorld({ gifs });
  assert.equal(w.core.gifs.enabled, true);
  assert.equal((await w.core.gifs.trending()).items.length, 2);
  assert.deepEqual(gifs.calls[0], { kind: 'trending', limit: 24, offset: 0, lang: 'pt' });
  assert.equal((await w.core.gifs.search({ q: '  festa  ', lang: 'es' })).items.length, 1);
  assert.deepEqual(gifs.calls[1], { kind: 'search', q: 'festa', limit: 24, offset: 0, lang: 'es' });
  await w.core.gifs.search({ q: '', limit: '999', offset: '-5', lang: 'xx' });
  assert.deepEqual(gifs.calls[2], { kind: 'trending', limit: 30, offset: 0, lang: 'pt' }, 'busca vazia vira trending; limites e idioma saneados');
  await w.core.gifs.search({ q: 'x'.repeat(200) });
  assert.equal(gifs.calls[3]!.q!.length, 50);
});

test('comentário de post: só GIF vale, aparece na lista, na denúncia e some ao apagar', async () => {
  const w = makeWorld({ gifs: new FakeGifSource() });
  const u = await w.signUpMany('ana', 'bia');
  const ana = u['ana']!, bia = u['bia']!;
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, ana);
  const post = await w.core.posts.create(ana, { images: [JPEG] });
  await rejectsWith(w.core.posts.addComment(bia, post.id, '  '), 'VALIDATION');
  await rejectsWith(w.core.posts.addComment(bia, post.id, 'oi', { id: 'x', url: 'https://evil.com/a.gif' }), 'VALIDATION');
  const only = await w.core.posts.addComment(bia, post.id, undefined, GIF);
  assert.deepEqual([only.body, only.gif], ['', GIF]);
  w.clock.tick(1000);
  const both = await w.core.posts.addComment(bia, post.id, 'olha', GIF);
  w.clock.tick(1000);
  const plain = await w.core.posts.addComment(bia, post.id, 'sem gif');
  assert.equal(plain.gif, null);
  const list = await w.core.posts.comments(ana, post.id);
  assert.deepEqual(list.items.map((c) => [c.body, c.gif?.id ?? null]), [['', GIF.id], ['olha', GIF.id], ['sem gif', null]]);
  assert.ok((await w.core.notifications.list(ana)).items.some((n) => n.type === 'POST_COMMENT' && n.body === 'GIF'));
  await w.core.posts.reportComment(ana, post.id, only.id, 'SPAM');
  const reports = [...w.users.reports.values()].filter((r) => r.commentId === only.id);
  assert.equal(reports[0]?.evidence, `[GIF] ${GIF.url}`);
  await w.core.posts.deleteComment(bia, post.id, only.id);
  await w.core.posts.deleteComment(bia, post.id, both.id);
  assert.deepEqual((await w.core.posts.comments(ana, post.id)).items.map((c) => c.body), ['sem gif']);
});

test('comentário do feed de evento: só GIF, gestão vê o GIF, denúncia guarda o GIF e apagar leva junto', async () => {
  const w = makeWorld({ gifs: new FakeGifSource() });
  const u = await w.signUpMany('ana', 'bia', 'caio');
  const ana = u['ana']!, bia = u['bia']!, caio = u['caio']!;
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, ana);
  w.users.users.set(caio, { ...w.users.users.get(caio)!, role: 'ADMIN' });
  const A = { userId: caio, role: 'ADMIN' as const };
  const start = new Date(w.clock.now().getTime() + 24 * H).toISOString();
  const ev = await w.core.posts.create(ana, { images: [JPEG], caption: 'Vem!', placeName: 'Praça', event: { title: 'Corrida', startsAt: start } });
  await w.core.feed.setPolicy(ana, 'event', ev.id, 'OPEN');
  const post = await w.core.feed.create(ana, 'event', ev.id, { body: 'Ponto de encontro' });
  await rejectsWith(w.core.feed.addComment(bia, post.id, '  '), 'VALIDATION');
  await rejectsWith(w.core.feed.addComment(bia, post.id, 'oi', { id: GIF.id, url: 'http://media2.giphy.com/x.gif' }), 'VALIDATION');
  const c = await w.core.feed.addComment(bia, post.id, undefined, GIF);
  assert.deepEqual([c.body, c.gif], ['', GIF]);
  assert.deepEqual((await w.core.feed.comments(ana, post.id)).items.map((x) => x.gif), [GIF]);
  await w.core.feed.reportComment(ana, c.id, 'OFFENSIVE');
  const open = await w.core.admin.feedReports(A, {});
  assert.equal(open.items[0]!.evidence, `[GIF] ${GIF.url}`);
  assert.equal((await w.core.admin.feedComments(A, post.id)).items[0]!.gifUrl, GIF.url);
  await w.core.admin.deleteFeedComment(A, c.id, 'ofensivo');
  assert.deepEqual((await w.core.admin.feedComments(A, post.id)).items, []);
  assert.equal(w.feed.comments.size, 0);
});

test('GiphyGifSource: chave só no servidor, filtra hosts, pagina e nunca lança', async () => {
  const urls: string[] = [];
  const item = (id: string, url: string) => ({ id, title: 'Dança', images: { fixed_width: { url, width: '200', height: '120' } } });
  const fetchFn = (async (u: string) => {
    urls.push(u);
    return { ok: true, json: async () => ({ data: [item('abc123XYZ', 'https://media1.giphy.com/media/abc123XYZ/200w.gif'), item('zzz999AAA', 'https://evil.com/x.gif'), { id: 1 }], pagination: { total_count: 100 } }) };
  }) as unknown as typeof fetch;
  const source = new GiphyGifSource({ apiKey: 'k3y', fetchFn });
  const page = await source.search('festa', { limit: 24, offset: 0, lang: 'pt' });
  assert.deepEqual(page.items, [{ id: 'abc123XYZ', title: 'Dança', url: 'https://media1.giphy.com/media/abc123XYZ/200w.gif', width: 200, height: 120 }]);
  assert.equal(page.nextOffset, 24);
  const u = new URL(urls[0]!);
  assert.deepEqual([u.pathname, u.searchParams.get('q'), u.searchParams.get('api_key'), u.searchParams.get('rating')], ['/v1/gifs/search', 'festa', 'k3y', 'g']);
  await source.trending({ limit: 24, offset: 0, lang: 'pt' });
  assert.equal(new URL(urls[1]!).pathname, '/v1/gifs/trending');
  await source.search('festa', { limit: 24, offset: 0, lang: 'pt' });
  assert.equal(urls.length, 2, 'repetir a mesma busca usa o cache');
  const down = new GiphyGifSource({ apiKey: 'k', fetchFn: (async () => { throw new Error('rede'); }) as unknown as typeof fetch });
  assert.deepEqual(await down.trending({ limit: 5, offset: 0, lang: 'pt' }), { items: [], nextOffset: null });
  const bad = new GiphyGifSource({ apiKey: 'k', fetchFn: (async () => ({ ok: false })) as unknown as typeof fetch });
  assert.deepEqual(await bad.search('x', { limit: 5, offset: 0, lang: 'pt' }), { items: [], nextOffset: null });
});

test('chat: GIF vira mensagem, aparece na lista, não mistura com texto e entra na denúncia', async () => {
  const w = makeWorld({ gifs: new FakeGifSource() });
  const u = await w.signUpMany('ana', 'bia');
  const ana = u['ana']!, bia = u['bia']!;
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, ana);
  const chat = await w.core.conversations.open(ana, bia);
  await rejectsWith(w.core.conversations.send(ana, chat.id, { gif: { id: 'x', url: 'https://evil.com/a.gif' } }), 'VALIDATION');
  await rejectsWith(w.core.conversations.send(ana, chat.id, { body: 'oi', gif: GIF }), 'VALIDATION');
  const sent = await w.core.conversations.send(ana, chat.id, { gif: GIF });
  assert.deepEqual([sent.kind, sent.body, sent.gif], ['TEXT', 'GIF', GIF]);
  const list = await w.core.conversations.messages(bia, chat.id);
  assert.deepEqual(list.messages.map((m) => m.gif), [GIF]);
  assert.ok((await w.core.notifications.list(bia)).items.some((n) => n.body.includes('GIF')));
  await w.core.conversations.deleteMessage(ana, chat.id, sent.id);
  assert.equal((await w.core.conversations.messages(bia, chat.id)).messages[0]!.gif, null, 'apagada some com o GIF');
});
