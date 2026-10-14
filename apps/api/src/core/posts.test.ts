import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST_IMAGES_MAX } from './post-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const JPEG = (n = 10) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio');
  const ana = u['ana']!, bia = u['bia']!, caio = u['caio']!;
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, ana);
  return { w, ana, bia, caio };
}

test('post com uma foto, sem legenda', async () => {
  const { w, ana } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG()] });
  assert.equal(post.caption, null);
  assert.equal(post.images.length, 1);
  assert.equal(post.images[0]!.kind, 'UPLOAD');
  assert.equal(post.mine, true);
  const bytes = await w.core.posts.image(post.images[0]!.id);
  assert.equal(bytes?.mime, 'image/jpeg');
});

test('carrossel: mantém a ordem e aceita no máximo 5 fotos', async () => {
  const { w, ana } = await setup();
  const post = await w.core.posts.create(ana, { caption: '  Noite boa  ', images: [JPEG(1), JPEG(2), JPEG(3)] });
  assert.equal(post.caption, 'Noite boa');
  const sizes = await Promise.all(post.images.map(async (i) => (await w.core.posts.image(i.id))!.data.length));
  assert.deepEqual(sizes, [5, 6, 7]);
  await rejectsWith(w.core.posts.create(ana, { images: Array.from({ length: POST_IMAGES_MAX + 1 }, () => JPEG()) }), 'VALIDATION');
  await rejectsWith(w.core.posts.create(ana, { images: [] }), 'VALIDATION');
  await rejectsWith(w.core.posts.create(ana, {}), 'VALIDATION');
});

test('foto do lugar (Google): vale como foto, com autor; só uma por post; pode misturar com enviadas', async () => {
  const { w, ana } = await setup();
  const post = await w.core.posts.create(ana, {
    caption: 'Bom demais',
    placeName: 'Bar do Zé',
    placeAddress: 'Rua A, 10',
    images: [{ placePhotoRef: 'places/ChIJ/photos/x', placePhotoAuthor: 'Maria' }, JPEG()],
  });
  assert.equal(post.images[0]!.kind, 'PLACE');
  assert.equal(post.images[0]!.photoRef, 'places/ChIJ/photos/x');
  assert.equal(post.images[0]!.photoAuthor, 'Maria');
  assert.equal(post.placeName, 'Bar do Zé');
  assert.equal(await w.core.posts.image(post.images[0]!.id), undefined, 'foto do lugar não tem bytes guardados');
  await rejectsWith(w.core.posts.create(ana, { images: [{ placePhotoRef: 'a' }, { placePhotoRef: 'b' }] }), 'VALIDATION');
  await rejectsWith(w.core.posts.create(ana, { images: [{ placePhotoRef: '' }] }), 'VALIDATION');
});

test('recusa arquivo que não é imagem, imagem grande demais e legenda longa', async () => {
  const { w, ana } = await setup();
  await rejectsWith(w.core.posts.create(ana, { images: ['data:text/html;base64,PGI+'] }), 'VALIDATION');
  await rejectsWith(w.core.posts.create(ana, { images: [`data:image/jpeg;base64,${Buffer.from([1, 2, 3, 4]).toString('base64')}`] }), 'VALIDATION');
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG(200_000)] }), 'VALIDATION');
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG()], caption: 'x'.repeat(501) }), 'VALIDATION');
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG()], caption: 5 }), 'VALIDATION');
});

test('perfil: lista os posts do mais recente, com paginação; privado só para quem segue', async () => {
  const { w, ana, bia, caio } = await setup();
  for (const c of ['um', 'dois', 'três']) {
    await w.core.posts.create(ana, { caption: c, images: [JPEG()] });
    w.clock.tick(1000);
  }
  const page = await w.core.posts.listByUsername(bia, 'ana', { limit: 2 });
  assert.deepEqual(page.items.map((p) => p.caption), ['três', 'dois']);
  assert.equal(page.total, 3);
  assert.equal(page.hasMore, true);
  const rest = await w.core.posts.listByUsername(bia, 'ana', { limit: 2, offset: 2 });
  assert.deepEqual(rest.items.map((p) => p.caption), ['um']);
  assert.equal(rest.hasMore, false);
  // perfil público: qualquer um vê; privado: só quem segue (com aprovação)
  assert.equal((await w.core.posts.listByUsername(caio, 'ana')).items.length, 3);
  await w.core.profiles.setPrivacy(ana, true);
  await rejectsWith(w.core.posts.listByUsername(caio, 'ana'), 'FORBIDDEN');
  assert.equal((await w.core.posts.listByUsername(bia, 'ana')).items.length, 3, 'quem já segue continua vendo');
  const only = await w.core.posts.get(bia, (await w.core.posts.listByUsername(ana, 'ana')).items[0]!.id);
  assert.equal(only.mine, false);
  await rejectsWith(w.core.posts.get(caio, only.id), 'NOT_FOUND');
});

test('bloqueio esconde os posts nos dois sentidos', async () => {
  const { w, ana, bia } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG()] });
  await w.core.blocks.block(ana, bia);
  await rejectsWith(w.core.posts.listByUsername(bia, 'ana'), 'NOT_FOUND');
  await rejectsWith(w.core.posts.get(bia, post.id), 'NOT_FOUND');
  assert.equal((await w.core.posts.feed(bia)).items.length, 0);
});

test('feed: seus posts e os dos amigos, não os de quem só você segue', async () => {
  const { w, ana, bia, caio } = await setup();
  await w.core.follows.follow(ana, caio); // só segue: não é amigo
  await w.core.posts.create(bia, { caption: 'da Bia', images: [JPEG()] });
  w.clock.tick(1000);
  await w.core.posts.create(caio, { caption: 'do Caio', images: [JPEG()] });
  w.clock.tick(1000);
  await w.core.posts.create(ana, { caption: 'da Ana', images: [JPEG()] });
  const feed = await w.core.posts.feed(ana);
  assert.deepEqual(feed.items.map((p) => p.caption), ['da Ana', 'da Bia']);
  assert.equal(feed.items[1]!.author.username, 'bia');
  assert.equal(feed.hasMore, false);
  assert.equal(feed.total, null);
});

test('apagar: só o autor; some do perfil e do feed e a foto deixa de existir', async () => {
  const { w, ana, bia } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG()] });
  await rejectsWith(w.core.posts.delete(bia, post.id), 'NOT_FOUND');
  assert.deepEqual(await w.core.posts.delete(ana, post.id), { deleted: true });
  await rejectsWith(w.core.posts.delete(ana, post.id), 'NOT_FOUND');
  assert.equal((await w.core.posts.feed(bia)).items.length, 0);
  assert.equal(await w.core.posts.image(post.images[0]!.id), undefined);
  await rejectsWith(w.core.posts.get(ana, 'nao-existe'), 'NOT_FOUND');
});

test('marcar amigos: só amigos, fica pendente, avisa e só entra no feed e no perfil depois de aceitar', async () => {
  const { w, ana, bia, caio } = await setup();
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG()], tagUserIds: [caio] }), 'VALIDATION');
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG()], tagUserIds: 'bia' }), 'VALIDATION');
  const post = await w.core.posts.create(ana, { caption: 'Com a Bia', images: [JPEG()], tagUserIds: [bia, bia, ana] });
  assert.deepEqual(post.tags.map((t) => [t.user.username, t.status]), [['bia', 'PENDING']], 'duplicado e a própria pessoa são ignorados');
  const news = await w.core.notifications.list(bia);
  assert.ok(news.items.some((n) => n.type === 'POST_TAG' && n.body.includes('Aceite')));
  // pendente: Caio (público) não vê a marcação; Bia vê a sua; o feed e o perfil dela não trazem o post marcado
  const asCaio = await w.core.posts.get(caio, post.id);
  assert.deepEqual(asCaio.tags, []);
  assert.equal((await w.core.posts.get(bia, post.id)).myTag, 'PENDING');
  assert.equal((await w.core.posts.listByUsername(caio, 'bia')).items.length, 0);
  assert.equal((await w.core.posts.pendingTags(bia)).items[0]!.id, post.id);
  // aceitar: aparece na lista de quem vê o perfil da Bia e no feed dela, e a marcação fica pública
  assert.deepEqual(await w.core.posts.respondTag(bia, post.id, 'accept'), { status: 'ACCEPTED' });
  assert.equal((await w.core.posts.pendingTags(bia)).items.length, 0);
  assert.deepEqual((await w.core.posts.listByUsername(caio, 'bia')).items.map((p) => p.id), [post.id]);
  assert.deepEqual((await w.core.posts.get(caio, post.id)).tags.map((t) => t.user.username), ['bia']);
  assert.equal((await w.core.posts.feed(bia)).items.length, 1);
  // recusar depois: some de novo
  await w.core.posts.respondTag(bia, post.id, 'decline');
  assert.equal((await w.core.posts.listByUsername(caio, 'bia')).items.length, 0);
  assert.deepEqual((await w.core.posts.get(ana, post.id)).tags, []);
  await rejectsWith(w.core.posts.respondTag(caio, post.id, 'accept'), 'NOT_FOUND');
  await rejectsWith(w.core.posts.respondTag(bia, post.id, 'talvez'), 'VALIDATION');
});

test('post marcado de autor que o visitante não pode ver não aparece no perfil do marcado', async () => {
  const { w, ana, bia, caio } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG()], tagUserIds: [bia] });
  await w.core.posts.respondTag(bia, post.id, 'accept');
  await w.core.profiles.setPrivacy(ana, true);
  assert.equal((await w.core.posts.listByUsername(bia, 'bia')).items.length, 1, 'a própria Bia vê (segue a Ana)');
  assert.equal((await w.core.posts.listByUsername(caio, 'bia')).items.length, 0, 'Caio não segue a Ana (privada)');
});

test('evento: título, lugar e início no futuro; fim padrão 3 h depois; post comum vem com event nulo', async () => {
  const { w, ana } = await setup();
  const start = new Date(w.clock.now().getTime() + 24 * 3_600_000).toISOString();
  const plain = await w.core.posts.create(ana, { images: [JPEG()] });
  assert.equal(plain.event, null);
  const ev = await w.core.posts.create(ana, { images: [JPEG()], placeName: 'Bar do Zé', event: { title: 'Pagode de sábado', startsAt: start } });
  assert.equal(ev.event?.title, 'Pagode de sábado');
  assert.equal(new Date(ev.event!.endsAt).getTime() - new Date(ev.event!.startsAt).getTime(), 3 * 3_600_000);
  assert.equal((await w.core.posts.get(ana, ev.id)).event?.title, 'Pagode de sábado');
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG()], event: { title: 'Sem lugar', startsAt: start } }), 'VALIDATION');
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG()], placeName: 'X', event: { title: '', startsAt: start } }), 'VALIDATION');
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG()], placeName: 'X', event: { title: 'Passado', startsAt: new Date(w.clock.now().getTime() - 3_600_000).toISOString() } }), 'VALIDATION');
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG()], placeName: 'X', event: { title: 'Fim antes', startsAt: start, endsAt: new Date(new Date(start).getTime() - 1000).toISOString() } }), 'VALIDATION');
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG()], placeName: 'X', event: { title: 'Data ruim', startsAt: 'amanhã' } }), 'VALIDATION');
});

test('lista do perfil separa eventos de posts comuns (kind=event|post)', async () => {
  const { w, ana } = await setup();
  const start = new Date(w.clock.now().getTime() + 24 * 3_600_000).toISOString();
  const plain = await w.core.posts.create(ana, { images: [JPEG()] });
  w.clock.tick(1000);
  const ev = await w.core.posts.create(ana, { images: [JPEG()], placeName: 'Bar', event: { title: 'Pagode', startsAt: start } });
  const all = await w.core.posts.listByUsername(ana, 'ana');
  assert.equal(all.items.length, 2);
  const onlyEvents = await w.core.posts.listByUsername(ana, 'ana', { kind: 'event' });
  assert.deepEqual(onlyEvents.items.map((p) => p.id), [ev.id]);
  assert.equal(onlyEvents.total, 1);
  const onlyPosts = await w.core.posts.listByUsername(ana, 'ana', { kind: 'post' });
  assert.deepEqual(onlyPosts.items.map((p) => p.id), [plain.id]);
  await rejectsWith(w.core.posts.listByUsername(ana, 'ana', { kind: 'xis' }), 'VALIDATION');
});

test('curtir: conta, desfaz, avisa o autor uma vez e não vale em post que não dá para ver', async () => {
  const { w, ana, bia, caio } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG()] });
  assert.deepEqual([post.likeCount, post.likedByMe, post.commentCount], [0, false, 0]);
  assert.deepEqual(await w.core.posts.like(bia, post.id), { liked: true, likeCount: 1 });
  assert.deepEqual(await w.core.posts.like(bia, post.id), { liked: true, likeCount: 1 }, 'curtir de novo não duplica');
  const seen = await w.core.posts.get(bia, post.id);
  assert.deepEqual([seen.likeCount, seen.likedByMe], [1, true]);
  assert.equal((await w.core.posts.get(ana, post.id)).likedByMe, false);
  const news = await w.core.notifications.list(ana);
  assert.equal(news.items.filter((n) => n.type === 'POST_LIKE').length, 1);
  assert.deepEqual(await w.core.posts.unlike(bia, post.id), { liked: false, likeCount: 0 });
  await w.core.posts.like(ana, post.id);
  assert.equal((await w.core.notifications.list(ana)).items.filter((n) => n.type === 'POST_LIKE').length, 1, 'curtir o próprio post não avisa');
  await w.core.profiles.setPrivacy(ana, true);
  await rejectsWith(w.core.posts.like(caio, post.id), 'NOT_FOUND');
  await rejectsWith(w.core.posts.like(bia, 'nao-existe'), 'NOT_FOUND');
});

test('comentários: escrever, listar do mais antigo, apagar (autor do comentário ou do post) e avisar', async () => {
  const { w, ana, bia, caio } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG()] });
  const c1 = await w.core.posts.addComment(bia, post.id, '  Que legal!  ');
  assert.equal(c1.body, 'Que legal!');
  assert.deepEqual([c1.mine, c1.canDelete], [true, true]);
  w.clock.tick(1000);
  const c2 = await w.core.posts.addComment(ana, post.id, 'Valeu');
  const list = await w.core.posts.comments(ana, post.id);
  assert.deepEqual(list.items.map((c) => c.body), ['Que legal!', 'Valeu']);
  assert.deepEqual(list.items.map((c) => [c.mine, c.canDelete]), [[false, true], [true, true]], 'o dono do post pode apagar qualquer um');
  assert.equal((await w.core.posts.get(ana, post.id)).commentCount, 2);
  assert.equal((await w.core.notifications.list(ana)).items.filter((n) => n.type === 'POST_COMMENT').length, 1, 'só o comentário de outra pessoa avisa');
  await rejectsWith(w.core.posts.addComment(bia, post.id, '   '), 'VALIDATION');
  await rejectsWith(w.core.posts.addComment(bia, post.id, 'x'.repeat(501)), 'VALIDATION');
  await rejectsWith(w.core.posts.deleteComment(bia, post.id, c2.id), 'FORBIDDEN');
  await w.core.posts.deleteComment(bia, post.id, c1.id);
  await w.core.posts.deleteComment(ana, post.id, c2.id);
  assert.equal((await w.core.posts.comments(ana, post.id)).items.length, 0);
  await rejectsWith(w.core.posts.deleteComment(ana, post.id, c2.id), 'NOT_FOUND');
  await w.core.profiles.setPrivacy(ana, true);
  await rejectsWith(w.core.posts.addComment(caio, post.id, 'oi'), 'NOT_FOUND');
});

test('denunciar e "não tenho interesse": somem do feed de quem pediu; o próprio post não', async () => {
  const { w, ana, bia } = await setup();
  const p1 = await w.core.posts.create(ana, { images: [JPEG()] });
  w.clock.tick(1000);
  const p2 = await w.core.posts.create(ana, { images: [JPEG()] });
  assert.equal((await w.core.posts.feed(bia)).items.length, 2);
  await w.core.posts.notInterested(bia, p1.id);
  assert.deepEqual((await w.core.posts.feed(bia)).items.map((p) => p.id), [p2.id]);
  assert.equal((await w.core.posts.feed(ana)).items.length, 2, 'não afeta quem publicou');
  assert.equal((await w.core.posts.listByUsername(bia, 'ana')).items.length, 2, 'o perfil continua mostrando');
  await rejectsWith(w.core.posts.report(bia, p2.id, 'NADA'), 'VALIDATION');
  await rejectsWith(w.core.posts.report(ana, p2.id, 'SPAM'), 'FORBIDDEN');
  await rejectsWith(w.core.posts.notInterested(ana, p2.id), 'FORBIDDEN');
  assert.deepEqual(await w.core.posts.report(bia, p2.id, 'SPAM', 'propaganda'), { reported: true });
  assert.deepEqual(await w.core.posts.report(bia, p2.id, 'OFFENSIVE'), { reported: true }, 'denunciar de novo troca o motivo');
  assert.equal((await w.core.posts.feed(bia)).items.length, 0, 'denunciado também some');
});

test('editar: legenda, lugar e evento; só o autor; evento mantém o início se não mudou', async () => {
  const { w, ana, bia } = await setup();
  const start = new Date(w.clock.now().getTime() + 24 * 3_600_000).toISOString();
  const post = await w.core.posts.create(ana, { caption: 'antes', images: [JPEG()], placeName: 'Bar', event: { title: 'Show', startsAt: start } });
  const edited = await w.core.posts.update(ana, post.id, { caption: 'depois' });
  assert.deepEqual([edited.caption, edited.edited, edited.event?.title, edited.placeName], ['depois', true, 'Show', 'Bar']);
  assert.equal((await w.core.posts.update(ana, post.id, { caption: '' })).caption, null, 'vazio limpa');
  assert.equal((await w.core.posts.update(ana, post.id, { event: { title: 'Show 2', startsAt: start } })).event?.title, 'Show 2');
  w.clock.tick(48 * 3_600_000);
  assert.equal((await w.core.posts.update(ana, post.id, { caption: 'já passou' })).event?.title, 'Show 2', 'editar a legenda de um evento que já passou funciona');
  assert.equal((await w.core.posts.update(ana, post.id, { event: { title: 'Show 3', startsAt: start } })).event?.title, 'Show 3', 'mesmo início, mesmo no passado');
  await rejectsWith(w.core.posts.update(ana, post.id, { event: { title: 'Outro', startsAt: new Date(w.clock.now().getTime() - 2 * 86_400_000).toISOString() } }), 'VALIDATION');
  assert.equal((await w.core.posts.update(ana, post.id, { event: null })).event, null, 'tirar o evento vira post comum');
  await rejectsWith(w.core.posts.update(ana, post.id, { placeName: '', event: { title: 'X', startsAt: new Date(w.clock.now().getTime() + 3_600_000).toISOString() } }), 'VALIDATION');
  await rejectsWith(w.core.posts.update(bia, post.id, { caption: 'invadi' }), 'FORBIDDEN');
  await rejectsWith(w.core.posts.update(ana, post.id, { caption: 'x'.repeat(501) }), 'VALIDATION');
});

test('ajustar foto: troca os bytes de uma foto enviada, só do autor; foto de lugar não', async () => {
  const { w, ana, bia } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG(3), { placePhotoRef: 'places/x/photos/y' }] });
  const [up, place] = post.images;
  const after = await w.core.posts.replaceImage(ana, post.id, up!.id, JPEG(9));
  assert.equal(after.images.length, 2);
  assert.notEqual(after.images[0]!.id, up!.id, 'a foto ganha endereço novo (sem cache velho)');
  assert.equal(await w.core.posts.image(up!.id), undefined);
  assert.equal((await w.core.posts.image(after.images[0]!.id))!.data.length, 13);
  assert.equal(after.images[1]!.kind, 'PLACE', 'a ordem se mantém');
  await rejectsWith(w.core.posts.replaceImage(ana, post.id, place!.id, JPEG()), 'NOT_FOUND');
  await rejectsWith(w.core.posts.replaceImage(bia, post.id, after.images[0]!.id, JPEG()), 'FORBIDDEN');
  await rejectsWith(w.core.posts.replaceImage(ana, post.id, after.images[0]!.id, 'data:text/html;base64,PGI+'), 'VALIDATION');
});

test('arquivar: some do feed, do perfil e para os outros; volta ao desarquivar', async () => {
  const { w, ana, bia } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG()] });
  await rejectsWith(w.core.posts.archive(bia, post.id), 'FORBIDDEN');
  assert.deepEqual(await w.core.posts.archive(ana, post.id), { archived: true });
  assert.equal((await w.core.posts.feed(ana)).items.length, 0);
  assert.equal((await w.core.posts.feed(bia)).items.length, 0);
  assert.equal((await w.core.posts.listByUsername(bia, 'ana')).items.length, 0);
  assert.equal((await w.core.posts.listByUsername(ana, 'ana')).total, 0);
  await rejectsWith(w.core.posts.get(bia, post.id), 'NOT_FOUND');
  await rejectsWith(w.core.posts.like(bia, post.id), 'NOT_FOUND');
  assert.equal((await w.core.posts.get(ana, post.id)).archived, true);
  assert.deepEqual((await w.core.posts.listArchived(ana)).items.map((p) => p.id), [post.id]);
  await w.core.posts.unarchive(ana, post.id);
  assert.equal((await w.core.posts.feed(bia)).items.length, 1);
  assert.equal((await w.core.posts.listArchived(ana)).items.length, 0);
});
