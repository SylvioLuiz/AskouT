import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const JPEG = (n = 10) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]).toString('base64')}`;
const WEEK = (open = '18:00', close = '02:00') => [null, { open, close }, { open, close }, { open, close }, { open, close }, { open, close }, { open, close }];

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('dono', 'ana', 'bia');
  const dono = u['dono']!, ana = u['ana']!, bia = u['bia']!;
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: -23.58, lng: -46.65, isSample: false, ownerId: dono });
  await w.places.createVenue({ id: 'v2', name: 'Sem dono', address: null, category: 'bar', lat: -23.59, lng: -46.65, isSample: false });
  return { w, dono, ana, bia };
}

test('página pública: qualquer pessoa vê, com ou sem dono', async () => {
  const { w, dono, ana } = await setup();
  const asAna = await w.core.venues.profile(ana, 'v1');
  assert.equal(asAna.name, 'Bar do Zé');
  assert.equal(asAna.claimed, true);
  assert.equal(asAna.isOwner, false);
  assert.equal(asAna.following, false);
  assert.equal((await w.core.venues.profile(dono, 'v1')).isOwner, true);
  const free = await w.core.venues.profile(ana, 'v2');
  assert.equal(free.claimed, false);
  assert.equal(free.hours, null);
  await rejectsWith(w.core.venues.profile(ana, 'nao-existe'), 'NOT_FOUND');
});

test('dono edita nome, descrição e horários; outras pessoas não', async () => {
  const { w, dono, ana } = await setup();
  await rejectsWith(w.core.venues.updateProfile(ana, 'v1', { name: 'Invasor' }), 'NOT_FOUND');
  await rejectsWith(w.core.venues.updateProfile(ana, 'v2', { name: 'Invasor' }), 'NOT_FOUND');
  const v = await w.core.venues.updateProfile(dono, 'v1', { name: ' Bar do Zé & Cia ', description: 'Música ao vivo', hours: WEEK(), category: 'Boteco' });
  assert.equal(v.name, 'Bar do Zé & Cia');
  assert.equal(v.description, 'Música ao vivo');
  assert.equal(v.hours?.[0], null);
  assert.deepEqual(v.hours?.[5], { open: '18:00', close: '02:00' });
  // só o que vem muda
  const again = await w.core.venues.updateProfile(dono, 'v1', { description: '' });
  assert.equal(again.description, null);
  assert.equal(again.name, 'Bar do Zé & Cia');
  assert.equal(again.hours?.length, 7);
  const cleared = await w.core.venues.updateProfile(dono, 'v1', { hours: null });
  assert.equal(cleared.hours, null);
  const bad = (input: Record<string, unknown>) => rejectsWith(w.core.venues.updateProfile(dono, 'v1', input), 'VALIDATION');
  await bad({ name: 'A' });
  await bad({ name: '' });
  await bad({ name: 'x'.repeat(81) });
  await bad({ description: 'x'.repeat(601) });
  await bad({ hours: [null] });
  await bad({ hours: WEEK('25:00', '02:00') });
  await bad({ hours: WEEK('18:00', '18:00') });
  await bad({ hours: 'sempre aberto' });
});

test('capa do estabelecimento: aparelho, link, manter e remover', async () => {
  const { w, dono } = await setup();
  const up = await w.core.venues.updateProfile(dono, 'v1', { imageData: JPEG(50) });
  assert.match(up.coverUrl ?? '', /^\/venues\/v1\/cover\?v=\d+$/);
  assert.equal((await w.core.venues.venueCover('v1'))?.mime, 'image/jpeg');
  const kept = await w.core.venues.updateProfile(dono, 'v1', { name: 'Zé' });
  assert.equal(kept.coverUrl, up.coverUrl);
  const kept2 = await w.core.venues.updateProfile(dono, 'v1', { imageUrl: up.coverUrl });
  assert.equal(kept2.coverUrl, up.coverUrl);
  assert.ok(await w.core.venues.venueCover('v1'));
  await rejectsWith(w.core.venues.updateProfile(dono, 'v1', { imageUrl: 'http://x.com/a.jpg' }), 'VALIDATION');
  await rejectsWith(w.core.venues.updateProfile(dono, 'v1', { imageUrl: '/venues/v2/cover?v=1' }), 'VALIDATION');
  await rejectsWith(w.core.venues.updateProfile(dono, 'v1', { imageData: JPEG(300 * 1024) }), 'VALIDATION');
  const link = await w.core.venues.updateProfile(dono, 'v1', { imageUrl: 'https://img.exemplo/a.jpg' });
  assert.equal(link.coverUrl, 'https://img.exemplo/a.jpg');
  assert.equal(await w.core.venues.venueCover('v1'), undefined);
  await w.core.venues.updateProfile(dono, 'v1', { imageData: JPEG() });
  const none = await w.core.venues.updateProfile(dono, 'v1', { imageUrl: null });
  assert.equal(none.coverUrl, null);
  assert.equal(await w.core.venues.venueCover('v1'), undefined);
});

test('seguir o bar: contagem, idempotência e desfazer', async () => {
  const { w, ana, bia } = await setup();
  assert.deepEqual(await w.core.venues.follow(ana, 'v1'), { following: true, followerCount: 1 });
  assert.deepEqual(await w.core.venues.follow(ana, 'v1'), { following: true, followerCount: 1 });
  await w.core.venues.follow(bia, 'v1');
  const p = await w.core.venues.profile(ana, 'v1');
  assert.equal(p.following, true);
  assert.equal(p.followerCount, 2);
  assert.deepEqual(await w.core.venues.unfollow(ana, 'v1'), { following: false, followerCount: 1 });
  assert.equal((await w.core.venues.profile(ana, 'v1')).following, false);
  await rejectsWith(w.core.venues.follow(ana, 'nao-existe'), 'NOT_FOUND');
  // locais sem dono também podem ser seguidos
  assert.equal((await w.core.venues.follow(ana, 'v2')).followerCount, 1);
});

test('agenda da página: só o que ainda vai acontecer, do mais cedo ao mais tarde', async () => {
  const { w, dono, ana } = await setup();
  const now = w.clock.now().getTime();
  await w.core.venues.createEvent(dono, 'v1', { title: 'Depois', startsAt: new Date(now + 48 * H).toISOString() });
  await w.core.venues.createEvent(dono, 'v1', { title: 'Antes', startsAt: new Date(now + 24 * H).toISOString() });
  const page = await w.core.venues.profile(ana, 'v1');
  assert.deepEqual(page.upcomingEvents.map((e) => e.title), ['Antes', 'Depois']);
  w.clock.tick(25 * H);
  assert.deepEqual((await w.core.venues.profile(ana, 'v1')).upcomingEvents.map((e) => e.title), ['Antes', 'Depois']);
  w.clock.tick(5 * H);
  assert.deepEqual((await w.core.venues.profile(ana, 'v1')).upcomingEvents.map((e) => e.title), ['Depois']);
});

test('posts do bar: só o dono publica, aparecem na página e no feed de quem segue', async () => {
  const { w, dono, ana, bia } = await setup();
  await rejectsWith(w.core.posts.createForVenue(ana, 'v1', { images: [JPEG()] }), 'NOT_FOUND');
  await rejectsWith(w.core.posts.createForVenue(dono, 'v2', { images: [JPEG()] }), 'NOT_FOUND');
  await rejectsWith(w.core.posts.createForVenue(dono, 'v1', { images: [{ placePhotoRef: 'places/x/photos/y' }] }), 'VALIDATION');
  const post = await w.core.posts.createForVenue(dono, 'v1', { caption: 'Hoje tem samba', images: [JPEG()], tagUserIds: [ana], event: { title: 'x' } });
  assert.deepEqual(post.venue, { id: 'v1', name: 'Bar do Zé', logoUrl: null });
  assert.equal(post.placeName, 'Bar do Zé');
  assert.equal(post.tags.length, 0);
  assert.equal(post.event, null);
  // página pública: qualquer pessoa
  const page = await w.core.posts.listByVenue(ana, 'v1');
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]!.caption, 'Hoje tem samba');
  // feed: só quem segue o bar
  assert.equal((await w.core.posts.feed(ana)).items.length, 0);
  await w.core.venues.follow(ana, 'v1');
  const feed = await w.core.posts.feed(ana);
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0]!.venue?.name, 'Bar do Zé');
  assert.equal((await w.core.posts.feed(bia)).items.length, 0);
  assert.equal((await w.core.posts.feed(dono)).items.length, 1, 'quem administra o local vê os posts dele no próprio Início');
  // não aparece no perfil pessoal do dono
  const donoProfile = await w.core.posts.listByUsername(ana, 'dono');
  assert.equal(donoProfile.items.length, 0);
  assert.equal(donoProfile.total, 0);
  // interação: curtir e comentar, mesmo com o dono privado e sem seguir
  await w.core.profiles.setPrivacy(dono, true);
  const like = await w.core.posts.like(bia, post.id);
  assert.equal(like.likeCount, 1);
  const c = await w.core.posts.addComment(bia, post.id, 'Vou!');
  assert.equal(c.body, 'Vou!');
  assert.equal((await w.core.posts.get(bia, post.id)).commentCount, 1);
  // deixar de seguir tira do feed
  await w.core.venues.unfollow(ana, 'v1');
  assert.equal((await w.core.posts.feed(ana)).items.length, 0);
});

test('lugar do Google: abre a página conferindo na fonte e não duplica', async () => {
  const { w, ana } = await setup();
  w.placeSource.places = [{ externalId: 'ABC123', source: 'GOOGLE', name: 'Boteco da Esquina', category: 'bar', lat: -23.55, lng: -46.63, photoRef: 'places/ABC123/photos/p1', photoAuthor: 'Maria' }];
  await rejectsWith(w.core.venues.openExternal({ key: 'google:NAO-EXISTE', lat: -23.55, lng: -46.63 }), 'NOT_FOUND');
  await rejectsWith(w.core.venues.openExternal({ key: 'qualquer coisa', lat: 1, lng: 1 }), 'VALIDATION');
  await rejectsWith(w.core.venues.openExternal({ key: 'google:ABC123', lat: 'x', lng: 1 }), 'VALIDATION');
  const { venueId } = await w.core.venues.openExternal({ key: 'google:ABC123', lat: -23.55, lng: -46.63 });
  const again = await w.core.venues.openExternal({ key: 'google:ABC123', lat: 0, lng: 0 });
  assert.equal(again.venueId, venueId);
  const page = await w.core.venues.profile(ana, venueId);
  assert.equal(page.name, 'Boteco da Esquina');
  assert.equal(page.claimed, false);
  assert.equal(page.photoRef, 'places/ABC123/photos/p1');
  assert.equal(page.photoAuthor, 'Maria');
  assert.equal((await w.core.venues.follow(ana, venueId)).followerCount, 1);
});

test('logo do estabelecimento: aparelho, link, manter, remover; independente da capa', async () => {
  const { w, dono } = await setup();
  const a = await w.core.venues.updateProfile(dono, 'v1', { logoData: JPEG(40), imageData: JPEG(60) });
  assert.match(a.logoUrl ?? '', /^\/venues\/v1\/logo\?v=\d+$/);
  assert.match(a.coverUrl ?? '', /^\/venues\/v1\/cover\?v=\d+$/);
  assert.equal((await w.core.venues.venueLogo('v1'))?.mime, 'image/jpeg');
  // editar só o nome mantém as duas
  const kept = await w.core.venues.updateProfile(dono, 'v1', { name: 'Zé 2' });
  assert.equal(kept.logoUrl, a.logoUrl);
  assert.equal(kept.coverUrl, a.coverUrl);
  // trocar a capa por link não apaga a logo
  await w.core.venues.updateProfile(dono, 'v1', { imageUrl: 'https://img.exemplo/capa.jpg' });
  assert.ok(await w.core.venues.venueLogo('v1'));
  assert.equal(await w.core.venues.venueCover('v1'), undefined);
  // a logo não aceita o caminho da capa, nem arquivo grande ou PDF
  await rejectsWith(w.core.venues.updateProfile(dono, 'v1', { logoUrl: '/venues/v1/cover?v=1' }), 'VALIDATION');
  await rejectsWith(w.core.venues.updateProfile(dono, 'v1', { logoUrl: 'http://x.com/l.png' }), 'VALIDATION');
  await rejectsWith(w.core.venues.updateProfile(dono, 'v1', { logoData: JPEG(200 * 1024) }), 'VALIDATION');
  await rejectsWith(w.core.venues.updateProfile(dono, 'v1', { logoData: 'data:application/pdf;base64,JVBERi0=' }), 'VALIDATION');
  const link = await w.core.venues.updateProfile(dono, 'v1', { logoUrl: 'https://img.exemplo/logo.png' });
  assert.equal(link.logoUrl, 'https://img.exemplo/logo.png');
  assert.equal(await w.core.venues.venueLogo('v1'), undefined);
  await w.core.venues.updateProfile(dono, 'v1', { logoData: JPEG() });
  const none = await w.core.venues.updateProfile(dono, 'v1', { logoUrl: null });
  assert.equal(none.logoUrl, null);
  assert.equal(await w.core.venues.venueLogo('v1'), undefined);
});

test('dono comenta no post do próprio bar como o bar; nos outros posts, como pessoa', async () => {
  const { w, dono, ana, bia } = await setup();
  await w.core.profiles.setPrivacy(dono, true);
  const post = await w.core.posts.createForVenue(dono, 'v1', { images: [JPEG()] });
  const a = await w.core.posts.addComment(ana, post.id, 'Que legal!');
  assert.equal(a.venue, null);
  const b = await w.core.posts.addComment(dono, post.id, 'Obrigado, aparece!');
  assert.deepEqual(b.venue, { id: 'v1', name: 'Bar do Zé', logoUrl: null });
  assert.equal(b.mine, true);
  // a lista mostra o comentário do bar mesmo para quem não segue o perfil (privado) do dono
  const list = await w.core.posts.comments(bia, post.id);
  assert.deepEqual(list.items.map((c) => [c.body, c.venue?.name ?? null]), [['Que legal!', null], ['Obrigado, aparece!', 'Bar do Zé']]);
  // quem escreveu ou o dono apaga; o dono apaga o comentário de outra pessoa no post do bar
  assert.equal(list.items[0]!.canDelete, false);
  assert.equal((await w.core.posts.comments(dono, post.id)).items[0]!.canDelete, true);
  // post pessoal do dono: comentário de pessoa
  const own = await w.core.posts.create(dono, { images: [JPEG()] });
  const c = await w.core.posts.addComment(dono, own.id, 'Meu post');
  assert.equal(c.venue, null);
  // post de outro bar (v2 não é dele, mas o post é de um bar de outra pessoa): comenta como pessoa
  await w.places.createVenue({ id: 'v3', name: 'Outro Bar', address: null, category: null, lat: 0, lng: 0, isSample: false, ownerId: ana });
  const other = await w.core.posts.createForVenue(ana, 'v3', { images: [JPEG()] });
  assert.equal((await w.core.posts.addComment(dono, other.id, 'Parabéns')).venue, null);
});

test('busca de bares traz o perfil: logo, seguidores, horários e se já segue', async () => {
  const { w, dono, ana } = await setup();
  await w.core.venues.updateProfile(dono, 'v1', { logoUrl: 'https://img.exemplo/logo.png', hours: WEEK() });
  await w.core.venues.follow(ana, 'v1');
  const found = await w.core.explore.search(ana, { q: 'zé' });
  const place = found.places.find((p) => p.name === 'Bar do Zé')!;
  assert.equal(place.source, 'ASKOUT');
  assert.deepEqual(place.venue, { id: 'v1', logoUrl: 'https://img.exemplo/logo.png', hours: WEEK(), followerCount: 1, following: true, claimed: true });
  const dois = found.places.find((p) => p.name === 'Sem dono');
  assert.equal(dois, undefined);
  const free = (await w.core.explore.search(dono, { q: 'sem dono' })).places[0]!;
  assert.deepEqual([free.venue?.following, free.venue?.followerCount, free.venue?.claimed], [false, 0, false]);
});

test('lugar do Google já aberto não aparece duas vezes na busca', async () => {
  const { w, ana } = await setup();
  w.placeSource.places = [{ externalId: 'ABC', source: 'GOOGLE', name: 'Boteco da Esquina', category: 'bar', lat: -23.55, lng: -46.63 }];
  const before = await w.core.explore.search(ana, { q: 'boteco', lat: -23.55, lng: -46.63 });
  assert.deepEqual(before.places.map((p) => p.source), ['GOOGLE']);
  await w.core.venues.openExternal({ key: 'google:ABC', lat: -23.55, lng: -46.63 });
  const after = await w.core.explore.search(ana, { q: 'boteco', lat: -23.55, lng: -46.63 });
  assert.deepEqual(after.places.map((p) => p.source), ['ASKOUT']);
  assert.equal(after.places[0]!.venue?.claimed, false);
});

test('avaliação de 1 a 5: uma nota por pessoa, média, troca, remoção e dono não avalia', async () => {
  const { w, dono, ana, bia } = await setup();
  const empty = (await w.core.venues.profile(ana, 'v1')).rating;
  assert.deepEqual(empty, { average: null, count: 0, mine: null });
  assert.deepEqual(await w.core.venues.rate(ana, 'v1', 5), { average: 5, count: 1, mine: 5 });
  assert.deepEqual(await w.core.venues.rate(bia, 'v1', 4), { average: 4.5, count: 2, mine: 4 });
  // avaliar de novo troca a nota, não soma
  assert.deepEqual(await w.core.venues.rate(ana, 'v1', 2), { average: 3, count: 2, mine: 2 });
  assert.deepEqual((await w.core.venues.profile(bia, 'v1')).rating, { average: 3, count: 2, mine: 4 });
  assert.equal((await w.core.venues.profile(dono, 'v1')).rating.mine, null);
  await rejectsWith(w.core.venues.rate(dono, 'v1', 5), 'FORBIDDEN');
  for (const bad of [0, 6, 3.5, '4', null, undefined, Number.NaN]) await rejectsWith(w.core.venues.rate(ana, 'v1', bad), 'VALIDATION');
  await rejectsWith(w.core.venues.rate(ana, 'nao-existe', 3), 'NOT_FOUND');
  assert.deepEqual(await w.core.venues.clearRating(ana, 'v1'), { average: 4, count: 1, mine: null });
  // local sem dono também pode ser avaliado
  assert.equal((await w.core.venues.rate(ana, 'v2', 3)).average, 3);
});

test('busca de locais traz a nota do estabelecimento', async () => {
  const { w, ana, bia } = await setup();
  await w.core.venues.rate(ana, 'v1', 4);
  await w.core.venues.rate(bia, 'v1', 5);
  const r = await w.core.explore.search(ana, { q: 'Bar do Zé' });
  const item = r.places.find((p) => p.key === 'askout:v1')!;
  assert.equal(item.rating, 4.5);
  assert.equal(item.ratingCount, 2);
});

test('feed: eventos de quem o bar segue aparecem para quem segue, só os que ainda não acabaram', async () => {
  const { w, dono, ana, bia } = await setup();
  const now = w.clock.now().getTime();
  await w.core.venues.follow(ana, 'v1');
  assert.deepEqual((await w.core.explore.followedEvents(ana)).events, []);
  await w.core.venues.createEvent(dono, 'v1', { title: 'Roda de Samba', kind: 'SHOW', startsAt: new Date(now + 2 * H).toISOString(), endsAt: new Date(now + 5 * H).toISOString(), isFree: true });
  const mine = await w.core.explore.followedEvents(ana);
  assert.deepEqual(mine.events.map((e) => e.title), ['Roda de Samba']);
  assert.equal(mine.events[0]?.venue.id, 'v1');
  assert.deepEqual((await w.core.explore.followedEvents(bia)).events, []);
});

test('ranking de frequentadores: conta presença em eventos que já começaram, respeita privacidade e bloqueio', async () => {
  const { w, ana, bia } = await setup();
  const u = await w.signUpMany('caio', 'dedo');
  const caio = u['caio']!, dedo = u['dedo']!;
  const now = w.clock.now().getTime();
  const ev = (id: string, startsAt: number, venueId = 'v1') => ({ id, venueId, title: id, description: null, startsAt: new Date(startsAt), endsAt: new Date(startsAt + 3 * H), kind: 'OTHER' as const, isFree: false, imageUrl: null, tags: [], isSample: false });
  await w.places.createEvent(ev('e1', now - 72 * H));
  await w.places.createEvent(ev('e2', now - 48 * H));
  await w.places.createEvent(ev('e3', now - 24 * H));
  await w.places.createEvent(ev('futuro', now + 24 * H));
  await w.places.createEvent(ev('outro', now - 24 * H, 'v2'));
  const go = (id: string, userId: string) => w.eventRoom.addGoing({ source: 'PLACE', id }, userId, new Date(now));
  for (const id of ['e1', 'e2', 'e3']) await go(id, ana);
  for (const id of ['e1', 'e2']) await go(id, bia);
  await go('e1', caio);
  await go('futuro', caio);
  await go('outro', caio);
  await go('e1', dedo);
  const names = async (viewer: string) => (await w.core.venues.profile(viewer, 'v1')).regulars.map((r) => [r.rank, r.user.username, r.visits]);
  assert.deepEqual(await names(bia), [[1, 'ana', 3], [2, 'bia', 2], [3, 'caio', 1], [4, 'dedo', 1]], 'só eventos do local que já começaram; empate pelo nome');
  await w.core.profiles.setPrivacy(caio, true);
  assert.deepEqual((await names(bia)).map((r) => r[1]), ['ana', 'bia', 'dedo'], 'perfil privado some para quem não segue');
  await w.core.follows.follow(bia, caio);
  await w.core.follows.approve(caio, bia);
  assert.deepEqual((await names(bia)).map((r) => r[1]), ['ana', 'bia', 'caio', 'dedo'], 'e aparece para quem segue');
  await w.core.blocks.block(bia, dedo);
  assert.deepEqual((await names(bia)).map((r) => r[1]), ['ana', 'bia', 'caio'], 'bloqueio some nos dois sentidos');
  assert.deepEqual((await w.core.venues.profile(ana, 'v2')).regulars, [], 'local sem presença não tem ranking');
});

test('amigos que já foram: só quem se segue de volta, sem o próprio visitante', async () => {
  const { w, ana, bia } = await setup();
  const u = await w.signUpMany('caio');
  const caio = u['caio']!;
  const now = w.clock.now().getTime();
  await w.places.createEvent({ id: 'p1', venueId: 'v1', title: 'p1', description: null, startsAt: new Date(now - 48 * H), endsAt: new Date(now - 45 * H), kind: 'OTHER' as const, isFree: false, imageUrl: null, tags: [], isSample: false });
  for (const id of [ana, bia, caio]) await w.eventRoom.addGoing({ source: 'PLACE', id: 'p1' }, id, new Date(now));
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, ana);
  await w.core.follows.follow(ana, caio); // caio não segue de volta: não é amigo
  const seen = (await w.core.venues.profile(ana, 'v1')).friendsWent;
  assert.equal(seen.count, 1);
  assert.deepEqual(seen.sample.map((p) => p.username), ['bia']);
  const alone = (await w.core.venues.profile(caio, 'v1')).friendsWent;
  assert.deepEqual([alone.count, alone.sample.length], [0, 0], 'sem amigos: zero');
  assert.deepEqual((await w.core.venues.profile(ana, 'v2')).friendsWent, { count: 0, sample: [] });
});

test('post de pessoa: o nome do rolê leva à página do local quando bate com um só local', async () => {
  const { w, ana, bia } = await setup();
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, ana);
  const igual = await w.core.posts.create(ana, { images: [JPEG()], placeName: '  bar do zé ' });
  const outro = await w.core.posts.create(ana, { images: [JPEG()], placeName: 'Lugar que não existe' });
  assert.equal((await w.core.posts.get(bia, igual.id)).placeVenueId, 'v1');
  assert.equal((await w.core.posts.get(bia, outro.id)).placeVenueId, null);
  // duas casas com o mesmo nome: ambíguo, sem link
  await w.places.createVenue({ id: 'v3', name: 'Bar do Zé', address: null, category: 'bar', lat: -23.6, lng: -46.7, isSample: false });
  assert.equal((await w.core.posts.get(bia, igual.id)).placeVenueId, null);
});
