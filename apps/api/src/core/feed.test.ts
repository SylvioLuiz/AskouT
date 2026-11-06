import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const JPEG = (n = 10) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'duda', 'edu');
  const ana = u['ana']!, bia = u['bia']!, caio = u['caio']!, duda = u['duda']!, edu = u['edu']!;
  for (const [a, b] of [[ana, bia], [ana, caio], [ana, edu]] as const) {
    await w.core.follows.follow(a, b);
    await w.core.follows.follow(b, a);
  }
  const start = new Date(w.clock.now().getTime() + 24 * H).toISOString();
  const ev = await w.core.posts.create(ana, { images: [JPEG()], caption: 'Vem!', placeName: 'Praça', event: { title: 'Corrida', startsAt: start } });
  // Bar com dono (edu) e um evento dele; outro bar sem dono.
  await w.places.createVenue({ id: 'v1', name: 'Bar do Edu', address: 'Rua A', category: 'bar', lat: -23.5, lng: -46.6, isSample: false, ownerId: edu });
  await w.places.createVenue({ id: 'v2', name: 'Bar Sem Dono', address: null, category: 'bar', lat: -23.5, lng: -46.6, isSample: false });
  await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Samba', description: null, kind: 'OTHER', isFree: true, imageUrl: null, tags: [], startsAt: new Date(w.clock.now().getTime() + 2 * H), endsAt: new Date(w.clock.now().getTime() + 5 * H), isSample: false });
  return { w, ana, bia, caio, duda, edu, ev };
}

const news = async (w: Awaited<ReturnType<typeof setup>>['w'], userId: string, type?: string) => (await w.core.notifications.list(userId)).items.filter((n) => !type || n.type === type);

test('regra padrão: só o dono publica; o dono escolhe aberto, com aprovação ou só ele', async () => {
  const { w, ana, bia, ev } = await setup();
  const first = await w.core.feed.list(bia, 'event', ev.id);
  assert.deepEqual([first.policy, first.canPost, first.isModerator, first.hasModerator, first.items], ['OWNER_ONLY', false, false, true, []]);
  await rejectsWith(w.core.feed.create(bia, 'event', ev.id, { body: 'oi' }), 'FORBIDDEN');
  const mine = await w.core.feed.create(ana, 'event', ev.id, { body: ' Ponto de encontro na praça ', images: [JPEG(), JPEG(20)] });
  assert.deepEqual([mine.body, mine.status, mine.imageIds.length, mine.mine, mine.canDelete, mine.venue], ['Ponto de encontro na praça', 'PUBLISHED', 2, true, true, null]);
  await rejectsWith(w.core.feed.setPolicy(bia, 'event', ev.id, 'OPEN'), 'FORBIDDEN');
  await rejectsWith(w.core.feed.setPolicy(ana, 'event', ev.id, 'TODOS'), 'VALIDATION');
  const open = await w.core.feed.setPolicy(ana, 'event', ev.id, 'OPEN');
  assert.deepEqual([open.policy, open.isModerator], ['OPEN', true]);
  const theirs = await w.core.feed.create(bia, 'event', ev.id, { body: 'Chego às 8' });
  assert.equal(theirs.status, 'PUBLISHED', 'aberto: entra direto');
  const page = await w.core.feed.list(bia, 'event', ev.id);
  assert.deepEqual(page.items.map((p) => p.body), ['Chego às 8', 'Ponto de encontro na praça'], 'mais recente primeiro');
  assert.equal(page.items[1]!.canDelete, false, 'não apaga a do dono');
  assert.equal((await w.core.feed.list(ana, 'event', ev.id)).items[0]!.canDelete, true, 'o dono apaga a de outra pessoa');
  // Só o dono de novo: quem não é dono para de publicar, mas o que já foi publicado fica.
  await w.core.feed.setPolicy(ana, 'event', ev.id, 'OWNER_ONLY');
  await rejectsWith(w.core.feed.create(bia, 'event', ev.id, { body: 'de novo' }), 'FORBIDDEN');
  assert.equal((await w.core.feed.list(bia, 'event', ev.id)).items.length, 2);
});

test('com aprovação: fica pendente, o dono é avisado, aprova ou recusa', async () => {
  const { w, ana, bia, caio, ev } = await setup();
  await w.core.feed.setPolicy(ana, 'event', ev.id, 'MODERATED');
  const asBia = await w.core.feed.list(bia, 'event', ev.id);
  assert.deepEqual([asBia.canPost, asBia.needsApproval, asBia.pendingCount], [true, true, 0]);
  const p1 = await w.core.feed.create(bia, 'event', ev.id, { body: 'Foto do aquecimento', images: [JPEG()] });
  const p2 = await w.core.feed.create(caio, 'event', ev.id, { body: 'Alguém tem carona?' });
  assert.equal(p1.status, 'PENDING');
  assert.equal((await news(w, ana, 'FEED_PENDING')).length, 1, 'um aviso por evento enquanto não lido');
  assert.deepEqual((await w.core.feed.list(caio, 'event', ev.id)).items, [], 'pendente não aparece para os outros');
  assert.deepEqual((await w.core.feed.list(bia, 'event', ev.id)).myPending.map((p) => p.id), [p1.id], 'quem escreveu vê a sua pendente');
  await rejectsWith(w.core.feed.get(caio, p1.id), 'NOT_FOUND');
  await rejectsWith(w.core.feed.pending(bia, 'event', ev.id), 'FORBIDDEN');
  await rejectsWith(w.core.feed.approve(bia, p1.id), 'FORBIDDEN');
  await rejectsWith(w.core.feed.react(bia, p1.id, '❤️'), 'FORBIDDEN');
  const asOwner = await w.core.feed.list(ana, 'event', ev.id);
  assert.equal(asOwner.pendingCount, 2);
  assert.deepEqual((await w.core.feed.pending(ana, 'event', ev.id)).items.map((p) => [p.id, p.canModerate]), [[p1.id, true], [p2.id, true]], 'da mais antiga para a mais nova');
  const approved = await w.core.feed.approve(ana, p1.id);
  assert.equal(approved.status, 'PUBLISHED');
  await rejectsWith(w.core.feed.approve(ana, p1.id), 'NOT_FOUND');
  assert.equal((await news(w, bia, 'FEED_APPROVED')).length, 1);
  await w.core.feed.reject(ana, p2.id);
  assert.equal((await news(w, caio, 'FEED_REJECTED')).length, 1);
  await rejectsWith(w.core.feed.get(caio, p2.id), 'NOT_FOUND');
  assert.deepEqual((await w.core.feed.list(caio, 'event', ev.id)).items.map((p) => p.id), [p1.id]);
  // O dono publica direto, mesmo com aprovação ligada.
  assert.equal((await w.core.feed.create(ana, 'event', ev.id, { body: 'Largada 8h' })).status, 'PUBLISHED');
});

test('validação: texto ou foto, limite de fotos e tamanho, aviso precisa de texto', async () => {
  const { w, ana, ev } = await setup();
  await rejectsWith(w.core.feed.create(ana, 'event', ev.id, { body: '   ' }), 'VALIDATION');
  await rejectsWith(w.core.feed.create(ana, 'event', ev.id, { body: 'x'.repeat(1001) }), 'VALIDATION');
  await rejectsWith(w.core.feed.create(ana, 'event', ev.id, { images: Array.from({ length: 6 }, () => JPEG()) }), 'VALIDATION');
  await rejectsWith(w.core.feed.create(ana, 'event', ev.id, { images: ['data:text/plain;base64,AAAA'] }), 'VALIDATION');
  await rejectsWith(w.core.feed.create(ana, 'event', ev.id, { kind: 'NOTICE', images: [JPEG()] }), 'VALIDATION');
  await rejectsWith(w.core.feed.create(ana, 'event', ev.id, { kind: 'STORY', body: 'oi' }), 'VALIDATION');
  const onlyPhoto = await w.core.feed.create(ana, 'event', ev.id, { images: [JPEG()] });
  assert.equal(onlyPhoto.body, null);
  assert.deepEqual(Array.from((await w.core.feed.image(onlyPhoto.imageIds[0]))!.data).slice(0, 3), [0xff, 0xd8, 0xff]);
  await rejectsWith(w.core.feed.list(ana, 'event', ev.id, { cursor: 'lixo' }), 'VALIDATION');
  await rejectsWith(w.core.feed.list(ana, 'event', 'nao-existe'), 'NOT_FOUND');
  await rejectsWith(w.core.feed.list(ana, 'planeta', ev.id), 'NOT_FOUND');
});

test('rolagem infinita: páginas pelo cursor, sem repetir nem pular', async () => {
  const { w, ana, ev } = await setup();
  for (let i = 1; i <= 7; i++) {
    w.clock.tick(1000);
    await w.core.feed.create(ana, 'event', ev.id, { body: `post ${i}` });
  }
  const seen: string[] = [];
  let cursor: string | null | undefined;
  let pages = 0;
  do {
    const page = await w.core.feed.list(ana, 'event', ev.id, { limit: 3, ...(cursor ? { cursor } : {}) });
    seen.push(...page.items.map((p) => p.body ?? ''));
    cursor = page.nextCursor;
    pages++;
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.deepEqual(seen, ['post 7', 'post 6', 'post 5', 'post 4', 'post 3', 'post 2', 'post 1']);
});

test('reações: uma por pessoa, trocar e tirar; quem publicou é avisado', async () => {
  const { w, ana, bia, caio, ev } = await setup();
  const p = await w.core.feed.create(ana, 'event', ev.id, { body: 'Bora!' });
  assert.deepEqual(await w.core.feed.react(bia, p.id, '❤️'), { counts: [{ emoji: '❤️', count: 1 }], mine: '❤️' });
  await w.core.feed.react(caio, p.id, '😂');
  assert.deepEqual(await w.core.feed.react(caio, p.id, '❤️'), { counts: [{ emoji: '❤️', count: 2 }], mine: '❤️' }, 'reagir de novo troca');
  assert.deepEqual(await w.core.feed.react(caio, p.id, null), { counts: [{ emoji: '❤️', count: 1 }], mine: null });
  await rejectsWith(w.core.feed.react(bia, p.id, 'gostei'), 'VALIDATION');
  assert.equal((await news(w, ana, 'FEED_REACTION')).length, 2);
  await w.core.feed.react(ana, p.id, '🔥');
  assert.equal((await news(w, ana, 'FEED_REACTION')).length, 2, 'reagir à própria publicação não avisa');
  const view = (await w.core.feed.list(bia, 'event', ev.id)).items[0]!;
  assert.deepEqual(view.reactions.mine, '❤️');
});

test('comentários: @menção avisa quem pode ver, quem publicou é avisado, reações e quem apaga', async () => {
  const { w, ana, bia, caio, duda, ev } = await setup();
  await w.core.feed.setPolicy(ana, 'event', ev.id, 'OPEN');
  const p = await w.core.feed.create(bia, 'event', ev.id, { body: 'Quem vai de bike?' });
  const c1 = await w.core.feed.addComment(caio, p.id, 'Eu! @ana vem também? @ninguem_existe');
  assert.deepEqual(c1.mentions, ['ana'], 'só nomes que existem viram link');
  assert.equal((await news(w, ana, 'FEED_MENTION')).length, 1);
  assert.equal((await news(w, bia, 'FEED_COMMENT')).length, 1, 'quem publicou é avisado');
  await w.core.profiles.setPrivacy(ana, true);
  await w.core.feed.addComment(caio, p.id, 'chama a @duda');
  assert.equal((await news(w, duda, 'FEED_MENTION')).length, 0, 'quem não vê o evento não é avisado');
  await w.core.profiles.setPrivacy(ana, false);
  const c2 = await w.core.feed.addComment(bia, p.id, 'Fechou');
  assert.equal((await news(w, bia, 'FEED_COMMENT')).length, 2, 'o próprio comentário não avisa');
  const page = await w.core.feed.comments(ana, p.id, { limit: 2 });
  assert.equal(page.items[0]!.id, c1.id);
  assert.ok(page.nextCursor);
  const rest = await w.core.feed.comments(ana, p.id, { cursor: page.nextCursor });
  assert.deepEqual(rest.items.map((c) => c.id), [c2.id]);
  assert.equal((await w.core.feed.list(ana, 'event', ev.id)).items[0]!.commentCount, 3);
  assert.deepEqual(await w.core.feed.reactComment(ana, c1.id, '😂'), { counts: [{ emoji: '😂', count: 1 }], mine: '😂' });
  assert.equal((await news(w, caio, 'FEED_REACTION')).length, 1);
  await rejectsWith(w.core.feed.addComment(bia, p.id, '  '), 'VALIDATION');
  await rejectsWith(w.core.feed.addComment(bia, p.id, 'x'.repeat(501)), 'VALIDATION');
  // Quem apaga: quem escreveu, o autor da publicação e o dono do evento.
  await rejectsWith(w.core.feed.deleteComment(duda, c1.id), 'FORBIDDEN');
  const c3 = await w.core.feed.addComment(caio, p.id, 'outro');
  await w.core.feed.deleteComment(bia, c3.id);
  await w.core.feed.deleteComment(ana, c1.id);
  await w.core.feed.deleteComment(bia, c2.id);
  assert.equal((await w.core.feed.comments(ana, p.id)).items.length, 1);
  // Apagar a publicação: só quem escreveu ou o dono do evento.
  await rejectsWith(w.core.feed.remove(caio, p.id), 'FORBIDDEN');
  await w.core.feed.remove(ana, p.id);
  await rejectsWith(w.core.feed.get(bia, p.id), 'NOT_FOUND');
});

test('quem não vê o evento não vê o feed; bloqueio esconde publicações e comentários', async () => {
  const { w, ana, bia, caio, duda, ev } = await setup();
  await w.core.profiles.setPrivacy(ana, true);
  await rejectsWith(w.core.feed.list(duda, 'event', ev.id), 'NOT_FOUND');
  await w.core.profiles.setPrivacy(ana, false);
  await w.core.feed.setPolicy(ana, 'event', ev.id, 'OPEN');
  const p = await w.core.feed.create(bia, 'event', ev.id, { body: 'da bia' });
  await w.core.feed.addComment(bia, (await w.core.feed.create(caio, 'event', ev.id, { body: 'do caio' })).id, 'comentário da bia');
  await w.core.blocks.block(duda, bia);
  const page = await w.core.feed.list(duda, 'event', ev.id);
  assert.deepEqual(page.items.map((x) => x.body), ['do caio']);
  assert.deepEqual((await w.core.feed.comments(duda, page.items[0]!.id)).items, []);
  await rejectsWith(w.core.feed.get(duda, p.id), 'NOT_FOUND');
});

test('rolê: sem dono o feed fica fechado; o dono publica como o rolê e o aviso chega a quem ligou o sininho', async () => {
  const { w, ana, bia, edu } = await setup();
  const closed = await w.core.feed.list(ana, 'venue', 'v2');
  assert.deepEqual([closed.hasModerator, closed.canPost], [false, false]);
  await rejectsWith(w.core.feed.create(ana, 'venue', 'v2', { body: 'oi' }), 'FORBIDDEN');
  await w.places.followVenue(bia, 'v1', w.clock.now());
  await w.places.setVenueNotify(bia, 'v1', true);
  const notice = await w.core.feed.create(edu, 'venue', 'v1', { kind: 'NOTICE', body: 'Hoje abrimos às 20h' });
  assert.deepEqual([notice.kind, notice.venue?.name], ['NOTICE', 'Bar do Edu']);
  const got = await news(w, bia, 'FEED_NOTICE');
  assert.equal(got.length, 1);
  assert.equal(got[0]!.url, `/bares/v1?post=${notice.id}`);
  assert.equal((await news(w, ana, 'FEED_NOTICE')).length, 0, 'sem sininho, sem aviso');
  // Aberto: qualquer pessoa publica; o aviso de quem não é dono não dispara para ninguém.
  await w.core.feed.setPolicy(edu, 'venue', 'v1', 'OPEN');
  const fromAna = await w.core.feed.create(ana, 'venue', 'v1', { kind: 'NOTICE', body: 'Fila grande!' });
  assert.equal(fromAna.venue, null);
  assert.equal((await news(w, bia, 'FEED_NOTICE')).length, 1);
});

test('evento do local: quem modera é o dono do rolê; aviso chega a quem confirmou presença', async () => {
  const { w, bia, caio, edu } = await setup();
  await w.core.eventPages.go(bia, 'e1');
  const settings = await w.core.feed.list(edu, 'event', 'e1');
  assert.deepEqual([settings.isModerator, settings.canPost], [true, true]);
  assert.equal((await w.core.feed.list(caio, 'event', 'e1')).canPost, false);
  const notice = await w.core.feed.create(edu, 'event', 'e1', { kind: 'NOTICE', body: 'Mudamos para o salão de cima' });
  assert.equal(notice.venue?.id, 'v1', 'publica como o rolê');
  const got = await news(w, bia, 'FEED_NOTICE');
  assert.deepEqual([got.length, got[0]?.url], [1, `/eventos/e1?post=${notice.id}`]);
  assert.equal((await news(w, caio, 'FEED_NOTICE')).length, 0);
});
