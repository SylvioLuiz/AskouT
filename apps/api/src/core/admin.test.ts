import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld, PASSWORD } from './testing/world.ts';

const H = 3_600_000;
const JPEG = (n = 10) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('adm', 'ana', 'bia', 'caio');
  const adm = u['adm']!, ana = u['ana']!, bia = u['bia']!, caio = u['caio']!;
  w.users.users.set(adm, { ...w.users.users.get(adm)!, role: 'ADMIN' });
  const A = { userId: adm, role: 'ADMIN' as const };
  const U = (id: string) => ({ userId: id, role: 'USER' as const });
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: -23.58, lng: -46.65, isSample: false });
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, ana);
  return { w, A, U, adm, ana, bia, caio };
}

test('só admin usa a gestão', async () => {
  const { w, U, ana } = await setup();
  await rejectsWith(w.core.admin.stats(U(ana)), 'FORBIDDEN');
  await rejectsWith(w.core.admin.searchUsers(U(ana), {}), 'FORBIDDEN');
  await rejectsWith(w.core.admin.setUserStatus(U(ana), ana, 'SUSPENDED', 'x'), 'FORBIDDEN');
  await rejectsWith(w.core.admin.listClaims(U(ana), {}), 'FORBIDDEN');
  await rejectsWith(w.core.admin.audit(U(ana), {}), 'FORBIDDEN');
});

test('login do painel: admin entra; usuário comum e senha errada recebem a mesma resposta', async () => {
  const { w } = await setup();
  const ok = await w.core.admin.login({ identifier: 'adm', password: PASSWORD });
  assert.equal(ok.user.role, 'ADMIN');
  const common = await rejectsWith(w.core.admin.login({ identifier: 'ana', password: PASSWORD }), 'UNAUTHORIZED');
  const wrong = await rejectsWith(w.core.admin.login({ identifier: 'adm', password: 'errada-errada-1' }), 'UNAUTHORIZED');
  assert.equal(common.message, wrong.message);
  const actor = await w.core.auth.authenticate(ok.token);
  assert.equal(actor.role, 'ADMIN');
});

test('pedidos de donos: lista com documento, aprova e deixa no registro', async () => {
  const { w, A, ana, adm } = await setup();
  const c = await w.core.venues.requestClaim(ana, 'v1', { document: JPEG(), note: 'Sou o dono' });
  const list = await w.core.admin.listClaims(A, {});
  assert.equal(list.length, 1);
  assert.deepEqual([list[0]!.venue.name, list[0]!.user.username, list[0]!.user.email, list[0]!.note, list[0]!.documentMime], ['Bar do Zé', 'ana', 'ana@exemplo.com', 'Sou o dono', 'image/jpeg']);
  assert.equal((await w.core.admin.claimDocument(A, c.id))?.mime, 'image/jpeg');
  await rejectsWith(w.core.admin.reviewClaim(A, c.id, 'REJECTED', ''), 'VALIDATION');
  await w.core.admin.reviewClaim(A, c.id, 'APPROVED', null);
  assert.equal((await w.places.findVenue('v1'))?.ownerId, ana);
  assert.deepEqual(await w.core.admin.listClaims(A, {}), []);
  assert.equal((await w.core.admin.listClaims(A, { status: 'APPROVED' })).length, 1);
  assert.deepEqual([(await w.core.admin.stats(A)).approvedClaims, (await w.core.admin.stats(A)).pendingClaims], [1, 0]);
  const log = await w.core.admin.audit(A, {});
  assert.deepEqual([log.items[0]!.action, log.items[0]!.adminUsername, log.items[0]!.targetId], ['CLAIM_APPROVED', 'adm', c.id]);
  void adm;
});

test('tirar o responsável do local exige motivo e libera para novo pedido', async () => {
  const { w, A, ana, bia } = await setup();
  const c = await w.core.venues.requestClaim(ana, 'v1', { document: JPEG() });
  await w.core.admin.reviewClaim(A, c.id, 'APPROVED', null);
  await rejectsWith(w.core.admin.removeVenueOwner(A, 'v1', ''), 'VALIDATION');
  await rejectsWith(w.core.admin.removeVenueOwner(A, 'nao-existe', 'x'), 'NOT_FOUND');
  await w.core.admin.removeVenueOwner(A, 'v1', 'Documento falso');
  await rejectsWith(w.core.admin.removeVenueOwner(A, 'v1', 'de novo'), 'CONFLICT');
  assert.equal((await w.places.findVenue('v1'))?.ownerId ?? null, null);
  await w.core.venues.requestClaim(bia, 'v1', { document: JPEG() });
  const venues = await w.core.admin.searchVenues(A, { q: 'zé' });
  assert.deepEqual([venues.items.length, venues.items[0]!.owner], [1, null]);
});

test('busca de pessoas e suspensão: motivo obrigatório, trava o login e a sessão, reativa', async () => {
  const { w, A, adm, ana, bia } = await setup();
  const all = await w.core.admin.searchUsers(A, {});
  assert.equal(all.items.length, 4);
  assert.deepEqual((await w.core.admin.searchUsers(A, { q: 'ANA@exemplo' })).items.map((r) => r.username), ['ana']);
  assert.deepEqual((await w.core.admin.searchUsers(A, { q: 'ana', limit: '1' })).hasMore, false);
  assert.equal((await w.core.admin.searchUsers(A, { limit: '2' })).hasMore, true);
  await rejectsWith(w.core.admin.setUserStatus(A, ana, 'SUSPENDED', ''), 'VALIDATION');
  await rejectsWith(w.core.admin.setUserStatus(A, ana, 'TALVEZ', 'x'), 'VALIDATION');
  await rejectsWith(w.core.admin.setUserStatus(A, adm, 'SUSPENDED', 'x'), 'CONFLICT');
  await rejectsWith(w.core.admin.setUserStatus(A, 'nao-existe', 'SUSPENDED', 'x'), 'NOT_FOUND');
  const session = await w.signUp('dora');
  await w.core.admin.setUserStatus(A, session.user.id, 'SUSPENDED', 'Spam repetido');
  await rejectsWith(w.core.auth.login({ identifier: 'dora', password: PASSWORD }), 'FORBIDDEN');
  await rejectsWith(w.core.auth.authenticate(session.token), 'UNAUTHORIZED');
  assert.deepEqual((await w.core.admin.searchUsers(A, { status: 'SUSPENDED' })).items.map((r) => r.username), ['dora']);
  await rejectsWith(w.core.admin.setUserStatus(A, session.user.id, 'SUSPENDED', 'x'), 'CONFLICT');
  await w.core.admin.setUserStatus(A, session.user.id, 'ACTIVE', null);
  assert.ok(await w.core.auth.login({ identifier: 'dora', password: PASSWORD }));
  const actions = (await w.core.admin.audit(A, {})).items.map((r) => r.action);
  assert.deepEqual(actions, ['USER_REACTIVATED', 'USER_SUSPENDED']);
  void bia;
});

test('posts e eventos: busca, remoção com motivo e registro', async () => {
  const { w, A, ana } = await setup();
  const start = new Date(w.clock.now().getTime() + 24 * H).toISOString();
  const post = await w.core.posts.create(ana, { images: [JPEG()], caption: 'Foto do pôr do sol' });
  const ev = await w.core.posts.create(ana, { images: [JPEG()], caption: 'Vem!', placeName: 'Praça', event: { title: 'Corrida de rua', startsAt: start } });
  await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Samba', description: null, kind: 'SHOW', isFree: true, imageUrl: null, tags: [], startsAt: new Date(w.clock.now().getTime() + 2 * H), endsAt: new Date(w.clock.now().getTime() + 5 * H), isSample: false });
  assert.equal((await w.core.admin.searchPosts(A, {})).items.length, 2);
  assert.deepEqual((await w.core.admin.searchPosts(A, { q: 'pôr' })).items.map((p) => p.id), [post.id]);
  assert.deepEqual((await w.core.admin.searchPosts(A, { events: 'true' })).items.map((p) => p.id), [ev.id]);
  const row = (await w.core.admin.searchPosts(A, { q: 'sol' })).items[0]!;
  assert.deepEqual([row.author.username, row.imagesCount, row.reportsCount], ['ana', 1, 0]);
  assert.equal((await w.core.admin.searchPlaceEvents(A, { q: 'samba' })).items.length, 1);
  await rejectsWith(w.core.admin.deletePost(A, post.id, ''), 'VALIDATION');
  await w.core.admin.deletePost(A, post.id, 'Foto indevida');
  await rejectsWith(w.core.admin.deletePost(A, post.id, 'de novo'), 'NOT_FOUND');
  assert.equal((await w.core.admin.searchPosts(A, {})).items.length, 1);
  await rejectsWith(w.core.admin.deletePlaceEvent(A, 'e1', ''), 'VALIDATION');
  await w.core.admin.deletePlaceEvent(A, 'e1', 'Evento falso');
  await rejectsWith(w.core.admin.deletePlaceEvent(A, 'e1', 'de novo'), 'NOT_FOUND');
  assert.equal((await w.core.admin.stats(A)).placeEvents, 0);
  assert.deepEqual((await w.core.admin.audit(A, {})).items.map((r) => r.action), ['PLACE_EVENT_REMOVED', 'POST_REMOVED']);
});

test('denúncias de posts: aparecem abertas, são decididas uma vez e saem da fila', async () => {
  const { w, A, ana, bia } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG()], caption: 'Post ofensivo' });
  await w.core.posts.report(bia, post.id, 'OFFENSIVE', 'Ofende');
  assert.equal((await w.core.admin.stats(A)).openPostReports, 1);
  const open = await w.core.admin.postReports(A, {});
  assert.equal(open.items.length, 1);
  const r = open.items[0]!;
  assert.deepEqual([r.reason, r.details, r.reporter.username, r.post.author.username, r.post.caption], ['OFFENSIVE', 'Ofende', 'bia', 'ana', 'Post ofensivo']);
  assert.equal((await w.core.admin.searchUsers(A, { q: 'ana' })).items[0]!.reportsCount, 1);
  await rejectsWith(w.core.admin.resolvePostReport(A, r.id, 'TALVEZ', null), 'VALIDATION');
  await rejectsWith(w.core.admin.resolvePostReport(A, 'nao-existe', 'DISMISSED', null), 'NOT_FOUND');
  await w.core.admin.resolvePostReport(A, r.id, 'DISMISSED', 'Sem problema');
  await rejectsWith(w.core.admin.resolvePostReport(A, r.id, 'ACTIONED', null), 'CONFLICT');
  assert.deepEqual((await w.core.admin.postReports(A, {})).items, []);
  const done = (await w.core.admin.postReports(A, { status: 'resolved' })).items[0]!;
  assert.deepEqual([done.resolution, done.resolutionNote], ['DISMISSED', 'Sem problema']);
  assert.equal((await w.core.admin.stats(A)).openPostReports, 0);
  assert.equal((await w.core.admin.audit(A, {})).items[0]!.action, 'REPORT_DISMISSED');
});

test('denúncias de conversa: trazem o trecho enviado e podem levar à suspensão', async () => {
  const { w, A, ana, bia } = await setup();
  const conv = await w.core.conversations.open(bia, ana);
  await w.core.conversations.send(ana, conv.id, { body: 'mensagem ruim' });
  await w.core.conversations.report(bia, conv.id, 'OFFENSIVE', 'Me xingou');
  assert.equal((await w.core.admin.stats(A)).openConversationReports, 1);
  const r = (await w.core.admin.conversationReports(A, {})).items[0]!;
  assert.deepEqual([r.reporter.username, r.reported?.username, r.reported?.status, r.reason], ['bia', 'ana', 'ACTIVE', 'OFFENSIVE']);
  assert.ok(r.evidence.includes('mensagem ruim'));
  await w.core.admin.setUserStatus(A, r.reported!.id, 'SUSPENDED', 'Ofensas');
  await w.core.admin.resolveConversationReport(A, r.id, 'ACTIONED', 'Conta suspensa');
  assert.deepEqual((await w.core.admin.conversationReports(A, {})).items, []);
  const done = (await w.core.admin.conversationReports(A, { status: 'resolved' })).items[0]!;
  assert.deepEqual([done.resolution, done.reported?.status], ['ACTIONED', 'SUSPENDED']);
  await rejectsWith(w.core.admin.resolveConversationReport(A, r.id, 'DISMISSED', null), 'CONFLICT');
});

test('painel: contagens e páginas', async () => {
  const { w, A, ana } = await setup();
  await w.core.posts.create(ana, { images: [JPEG()], caption: 'um' });
  const s = await w.core.admin.stats(A);
  assert.deepEqual([s.users, s.suspendedUsers, s.venues, s.venuesWithOwner, s.posts, s.pendingClaims], [4, 0, 1, 0, 1, 0]);
  const p1 = await w.core.admin.searchUsers(A, { limit: '3', offset: '0' });
  const p2 = await w.core.admin.searchUsers(A, { limit: '3', offset: '3' });
  assert.deepEqual([p1.items.length, p1.hasMore, p2.items.length, p2.hasMore], [3, true, 1, false]);
  await rejectsWith(w.core.admin.searchUsers(A, { q: 'x'.repeat(81) }), 'VALIDATION');
});

test('denúncias de story: fila da gestão, mídia mesmo vencida, decisão uma vez e remoção do story', async () => {
  const { w, A, U, ana, bia, caio } = await setup();
  const now = w.clock.now().getTime();
  await w.places.createEvent({ id: 'e9', venueId: 'v1', title: 'Noite do Samba', description: null, kind: 'SHOW', isFree: false, imageUrl: null, tags: [], startsAt: new Date(now + H), endsAt: new Date(now + 5 * H), isSample: false });
  for (const u of [ana, bia, caio]) await w.core.eventPages.go(u, 'e9');
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const s1 = (await w.core.eventPages.createStory(ana, 'e9', 'image/jpeg', jpg)).items[0]!.id;
  const s2 = (await w.core.eventPages.createStory(ana, 'e9', 'image/jpeg', jpg)).items[0]!.id;
  await w.core.eventPages.reportStory(bia, 'e9', s1, 'NUDITY', 'Imagem imprópria');
  w.clock.tick(1000);
  await w.core.eventPages.reportStory(caio, 'e9', s1, 'SPAM');
  w.clock.tick(1000);
  await w.core.eventPages.reportStory(caio, 'e9', s2, 'OTHER');
  await rejectsWith(w.core.admin.storyReports(U(ana), {}), 'FORBIDDEN');
  assert.equal((await w.core.admin.stats(A)).openStoryReports, 3);
  const open = (await w.core.admin.storyReports(A, {})).items;
  assert.equal(open.length, 3);
  const first = open[0]!;
  assert.deepEqual([first.reason, first.details, first.reporter.username, first.story.author.username, first.story.eventTitle, first.story.kind, first.story.reportsCount], ['NUDITY', 'Imagem imprópria', 'bia', 'ana', 'Noite do Samba', 'IMAGE', 2]);
  // a gestão ainda vê a mídia depois de vencida
  w.clock.tick(6 * H);
  assert.equal(await w.core.eventPages.storyMedia(s1), undefined);
  assert.equal((await w.core.admin.storyMedia(A, s1))?.mime, 'image/jpeg');
  await rejectsWith(w.core.admin.storyMedia(U(ana), s1), 'FORBIDDEN');
  await rejectsWith(w.core.admin.resolveStoryReport(A, first.id, 'TALVEZ', null), 'VALIDATION');
  await rejectsWith(w.core.admin.resolveStoryReport(A, 'nao-existe', 'DISMISSED', null), 'NOT_FOUND');
  await w.core.admin.resolveStoryReport(A, first.id, 'DISMISSED', 'Sem problema');
  await rejectsWith(w.core.admin.resolveStoryReport(A, first.id, 'ACTIONED', null), 'CONFLICT');
  assert.equal((await w.core.admin.storyReports(A, {})).items.length, 2);
  assert.equal((await w.core.admin.storyReports(A, { status: 'resolved' })).items[0]!.resolution, 'DISMISSED');
  await rejectsWith(w.core.admin.deleteStory(A, s2, ''), 'VALIDATION');
  await w.core.admin.deleteStory(A, s2, 'Fora das regras');
  await rejectsWith(w.core.admin.deleteStory(A, s2, 'de novo'), 'NOT_FOUND');
  assert.equal((await w.core.admin.stats(A)).openStoryReports, 1, 'a denúncia do story apagado sai junto');
  const actions = (await w.core.admin.audit(A, {})).items.map((r) => r.action);
  assert.deepEqual(actions, ['STORY_REMOVED', 'REPORT_DISMISSED']);
});
