import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld, PASSWORD, asSession } from './testing/world.ts';

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
  const ok = await asSession(w.core.admin.login({ identifier: 'adm', password: PASSWORD }));
  assert.equal(ok.user.role, 'ADMIN');
  const common = await rejectsWith(w.core.admin.login({ identifier: 'ana', password: PASSWORD }), 'UNAUTHORIZED');
  const wrong = await rejectsWith(w.core.admin.login({ identifier: 'adm', password: 'errada-errada-1' }), 'UNAUTHORIZED');
  assert.equal(common.message, wrong.message);
  const actor = await w.core.auth.authenticate(ok.token);
  assert.equal(actor.role, 'ADMIN');
});

test('login do painel com a Apple: só admin entra e nunca cria conta', async () => {
  const { w } = await setup();
  const tok = (sub: string, email: string) => JSON.stringify({ provider: 'APPLE', verified: true, sub, email });
  const ok = await asSession(w.core.admin.socialLogin({ provider: 'APPLE', idToken: tok('a-adm', 'adm@exemplo.com') }));
  assert.equal(ok.user.role, 'ADMIN');
  assert.equal((await w.core.auth.authenticate(ok.token)).role, 'ADMIN');
  // Da segunda vez entra pelo ID fixo da Apple, mesmo com outro e-mail (ex.: ocultar e-mail).
  assert.equal((await asSession(w.core.admin.socialLogin({ provider: 'APPLE', idToken: tok('a-adm', 'oculto@privaterelay.appleid.com') }))).user.role, 'ADMIN');

  await rejectsWith(w.core.admin.socialLogin({ provider: 'APPLE', idToken: tok('a-ana', 'ana@exemplo.com') }), 'UNAUTHORIZED');
  assert.equal(await w.identities.find('APPLE', 'a-ana'), undefined, 'conta comum não ganha vínculo com a Apple pelo painel');
  await rejectsWith(w.core.admin.socialLogin({ provider: 'APPLE', idToken: 'lixo' }), 'UNAUTHORIZED');

  await rejectsWith(w.core.admin.socialLogin({ provider: 'APPLE', idToken: tok('a-nova', 'nova@exemplo.com') }), 'UNAUTHORIZED');
  assert.equal(await w.users.findByEmail('nova@exemplo.com'), undefined, 'não cria conta pelo painel');
});

test('trocar a própria senha no painel: confere a atual e valida a nova', async () => {
  const { w, A, U, ana } = await setup();
  const NOVA = 'outra-senha-forte-456';
  await rejectsWith(w.core.admin.changeOwnPassword(U(ana), { currentPassword: PASSWORD, newPassword: NOVA }), 'FORBIDDEN');
  const wrong = await rejectsWith(w.core.admin.changeOwnPassword(A, { currentPassword: 'errada-errada-1', newPassword: NOVA }), 'VALIDATION');
  assert.equal(wrong.message, 'Senha atual incorreta');
  await rejectsWith(w.core.admin.changeOwnPassword(A, { currentPassword: PASSWORD, newPassword: 'curta' }), 'VALIDATION');
  await rejectsWith(w.core.admin.changeOwnPassword(A, { currentPassword: PASSWORD, newPassword: PASSWORD }), 'VALIDATION');
  await rejectsWith(w.core.admin.changeOwnPassword(A, { currentPassword: PASSWORD, newPassword: 'adm' + '@exemplo.com' }), 'VALIDATION');
  assert.ok(await w.core.admin.login({ identifier: 'adm', password: PASSWORD }), 'recusas não mudam a senha');

  await w.core.admin.changeOwnPassword(A, { currentPassword: PASSWORD, newPassword: NOVA });
  await rejectsWith(w.core.admin.login({ identifier: 'adm', password: PASSWORD }), 'UNAUTHORIZED');
  assert.equal((await asSession(w.core.admin.login({ identifier: 'adm', password: NOVA }))).user.role, 'ADMIN');
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
  assert.deepEqual(all.items.map((r) => r.loginProviders), [[], [], [], []], 'sem conta Google/Apple ligada');
  await w.identities.link('GOOGLE', 'g-ana', ana);
  await w.identities.link('APPLE', 'a-ana', ana);
  await w.identities.link('APPLE', 'a-bia', bia);
  const linked = new Map((await w.core.admin.searchUsers(A, {})).items.map((r) => [r.username, r.loginProviders]));
  assert.deepEqual([linked.get('ana'), linked.get('bia'), linked.get('caio')], [['APPLE', 'GOOGLE'], ['APPLE'], []]);
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
  const post = await w.core.posts.create(ana, { placeName: 'Bar do Zé', images: [JPEG()], caption: 'Foto do pôr do sol' });
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
  const post = await w.core.posts.create(ana, { placeName: 'Bar do Zé', images: [JPEG()], caption: 'Post ofensivo' });
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
  await w.core.posts.create(ana, { placeName: 'Bar do Zé', images: [JPEG()], caption: 'um' });
  const s = await w.core.admin.stats(A);
  assert.deepEqual([s.users, s.suspendedUsers, s.venues, s.venuesWithOwner, s.posts, s.pendingClaims], [4, 0, 1, 0, 1, 0]);
  const p1 = await w.core.admin.searchUsers(A, { limit: '3', offset: '0' });
  const p2 = await w.core.admin.searchUsers(A, { limit: '3', offset: '3' });
  assert.deepEqual([p1.items.length, p1.hasMore, p2.items.length, p2.hasMore], [3, true, 1, false]);
  await rejectsWith(w.core.admin.searchUsers(A, { q: 'x'.repeat(81) }), 'VALIDATION');
});

test('denúncias de flash: fila da gestão, mídia mesmo vencida, decisão uma vez e remoção do flash', async () => {
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
  assert.equal((await w.core.admin.stats(A)).openStoryReports, 1, 'a denúncia do flash apagado sai junto');
  const actions = (await w.core.admin.audit(A, {})).items.map((r) => r.action);
  assert.deepEqual(actions, ['STORY_REMOVED', 'REPORT_DISMISSED']);
});

test('corrigir data de nascimento: só admin, motivo obrigatório, registra de/para e tira a marca de menor', async () => {
  const { w, A, U, adm, caio } = await setup();
  const minor = (await w.signUp('juca', { minor: true })).user.id;
  assert.equal((await w.core.age.status(minor)).adult, false);
  const before = w.users.users.get(minor)!.birthDate!;

  await rejectsWith(w.core.admin.setUserBirthDate(U(caio), minor, '2000-01-01', 'erro'), 'FORBIDDEN');
  await rejectsWith(w.core.admin.setUserBirthDate(A, minor, '2000-01-01', ''), 'VALIDATION');
  await rejectsWith(w.core.admin.setUserBirthDate(A, minor, 'lixo', 'erro'), 'VALIDATION');
  await rejectsWith(w.core.admin.setUserBirthDate(A, minor, `${w.clock.now().getUTCFullYear() - 8}-01-01`, 'erro'), 'VALIDATION');
  await rejectsWith(w.core.admin.setUserBirthDate(A, minor, before, 'erro'), 'VALIDATION'); // a data nova também precisa ser de maior de 18 anos
  await rejectsWith(w.core.admin.setUserBirthDate(A, adm, '2000-01-01', 'erro'), 'CONFLICT');
  await rejectsWith(w.core.admin.setUserBirthDate(A, '00000000-0000-4000-8000-000000000000', '2000-01-01', 'erro'), 'NOT_FOUND');

  await w.core.admin.setUserBirthDate(A, minor, '2000-01-01', 'Digitou o ano errado; conferido por documento');
  assert.equal((await w.core.age.status(minor)).adult, true);
  await rejectsWith(w.core.admin.setUserBirthDate(A, minor, '2000-01-01', 'de novo'), 'CONFLICT');
  const audit = await w.core.admin.audit(A, {});
  const row = audit.items.find((r) => r.action === 'USER_BIRTHDATE_CHANGED')!;
  assert.ok(row.note?.includes(`de ${before} para 2000-01-01`));
  const listed = (await w.core.admin.searchUsers(A, { q: 'juca' })).items[0]!;
  assert.equal(listed.birthDate, '2000-01-01');
});

test('denúncia de perfil e de comentário: vai para a fila da gestão, com o texto da época, e se resolve', async () => {
  const { w, A, U, ana, bia, caio } = await setup();
  await w.core.profiles.updateOwn(bia, { bio: 'bio ofensiva' });
  // Perfil
  await rejectsWith(w.core.profiles.report(ana, 'bia', 'XYZ'), 'VALIDATION');
  await rejectsWith(w.core.profiles.report(ana, 'ana', 'OFFENSIVE'), 'FORBIDDEN');
  await rejectsWith(w.core.profiles.report(ana, 'ninguem', 'OFFENSIVE'), 'NOT_FOUND');
  await w.core.profiles.report(ana, 'bia', 'OFFENSIVE', '  muito ruim  ');
  await w.core.profiles.report(ana, 'bia', 'SPAM'); // denunciar de novo atualiza, não duplica
  await rejectsWith(w.core.profiles.report(ana, 'bia', 'OFFENSIVE', 'x'.repeat(301)), 'VALIDATION');
  // Comentário
  const post = await w.core.posts.create(bia, { placeName: 'Bar do Zé', caption: 'oi', images: [JPEG()] });
  const c = await w.core.posts.addComment(ana, post.id, 'comentário ruim');
  await rejectsWith(w.core.posts.reportComment(ana, post.id, c.id, 'OFFENSIVE'), 'FORBIDDEN');
  await w.core.posts.reportComment(bia, post.id, c.id, 'OFFENSIVE', 'ofensa');
  await rejectsWith(w.core.posts.reportComment(bia, post.id, 'nao-existe', 'OFFENSIVE'), 'NOT_FOUND');

  await rejectsWith(w.core.admin.userReports(U(caio), {}), 'FORBIDDEN');
  const open = await w.core.admin.userReports(A, {});
  assert.equal(open.items.length, 2);
  const profile = open.items.find((r) => r.kind === 'PROFILE')!;
  assert.equal(profile.reason, 'SPAM');
  assert.equal(profile.reported.username, 'bia');
  assert.ok(profile.evidence.includes('bio ofensiva'));
  const comment = open.items.find((r) => r.kind === 'COMMENT')!;
  assert.equal(comment.evidence, 'comentário ruim');
  assert.equal(comment.reported.username, 'ana');
  assert.equal((await w.core.admin.stats(A)).openUserReports, 2);

  await rejectsWith(w.core.admin.resolveUserReport(A, profile.id, 'X', null), 'VALIDATION');
  await w.core.admin.resolveUserReport(A, profile.id, 'ACTIONED', 'Pedi para mudar a bio');
  await rejectsWith(w.core.admin.resolveUserReport(A, profile.id, 'DISMISSED', null), 'CONFLICT');
  await rejectsWith(w.core.admin.resolveUserReport(A, 'nao-existe', 'DISMISSED', null), 'NOT_FOUND');
  assert.equal((await w.core.admin.userReports(A, {})).items.length, 1);
  assert.equal((await w.core.admin.userReports(A, { status: 'resolved' })).items[0]!.resolution, 'ACTIONED');
  assert.equal((await w.core.admin.stats(A)).openUserReports, 1);
});

test('comentário denunciado: a gestão apaga com motivo e fica na auditoria', async () => {
  const { w, A, U, ana, bia } = await setup();
  const post = await w.core.posts.create(bia, { placeName: 'Bar do Zé', caption: 'oi', images: [JPEG()] });
  const c = await w.core.posts.addComment(ana, post.id, 'comentário ruim');
  await w.core.posts.reportComment(bia, post.id, c.id, 'OFFENSIVE');
  const row = (await w.core.admin.userReports(A, {})).items.find((r) => r.kind === 'COMMENT')!;
  assert.deepEqual([row.commentId, row.commentExists], [c.id, true]);

  await rejectsWith(w.core.admin.deletePostComment(U(ana), c.id, 'x'), 'FORBIDDEN');
  await rejectsWith(w.core.admin.deletePostComment(A, c.id, ''), 'VALIDATION');
  await w.core.admin.deletePostComment(A, c.id, 'Ofensivo');
  await rejectsWith(w.core.admin.deletePostComment(A, c.id, 'de novo'), 'NOT_FOUND');
  assert.equal((await w.core.posts.comments(bia, post.id)).items.length, 0);
  assert.equal((await w.core.admin.userReports(A, {})).items.find((r) => r.kind === 'COMMENT')!.commentExists, false);
  assert.equal((await w.core.admin.audit(A, {})).items[0]!.action, 'COMMENT_REMOVED');
});

test('as listas da gestão trazem o total de registros, que acompanha a busca e não o tamanho da página', async () => {
  const { w, A } = await setup();
  const all = await w.core.admin.searchUsers(A, {});
  assert.equal(all.total, 4, 'os 4 usuários do cenário');
  const two = await w.core.admin.searchUsers(A, { limit: '2' });
  assert.equal(two.items.length, 2);
  assert.equal(two.total, 4, 'o total é de tudo, não só desta página');
  assert.equal(two.hasMore, true);
  assert.equal((await w.core.admin.searchUsers(A, { q: 'ANA@exemplo' })).total, 1, 'a busca muda o total');
  assert.equal((await w.core.admin.searchUsers(A, { q: 'ninguem-assim' })).total, 0);
  assert.equal((await w.core.admin.searchVenues(A, {})).total, 1);
  assert.equal((await w.core.admin.searchVenues(A, { q: 'não existe' })).total, 0);
  assert.equal((await w.core.admin.searchPlaceEvents(A, {})).total, 0);
  assert.equal((await w.core.admin.searchPosts(A, {})).total, 0);
  assert.equal((await w.core.admin.audit(A, {})).total, (await w.core.admin.audit(A, { limit: '100' })).items.length);
  assert.equal((await w.core.admin.postReports(A, {})).total, 0);
  assert.equal((await w.core.admin.feedPosts(A, {})).total, 0);
  assert.equal((await w.core.admin.feedReports(A, { status: 'resolved' })).total, 0);
});

test('detalhe do local na gestão: cadastro, origem, responsável, seguidores e eventos; só admin', async () => {
  const { w, A, U, ana, bia } = await setup();
  await rejectsWith(w.core.admin.venueDetail(U(ana), 'v1'), 'FORBIDDEN');
  await rejectsWith(w.core.admin.venueDetail(A, 'nao-existe'), 'NOT_FOUND');
  await rejectsWith(w.core.admin.venueDetail(A, 42), 'NOT_FOUND');

  await w.places.createVenue({ id: 'v2', name: 'Kill Beer Lab', address: 'Rua X, 10', category: 'bar', lat: -23.52, lng: -46.18, isSample: false, ownerId: ana, externalKey: 'google:abc', description: 'Gastrobar de Mogi' });
  const at = w.clock.now().getTime();
  const mk = (id: string, startsAt: number, endsAt: number) => w.places.createEvent({ id, venueId: 'v2', title: id, description: null, startsAt: new Date(startsAt), endsAt: new Date(endsAt), kind: 'NIGHT', isFree: false, imageUrl: null, tags: [], isSample: id === 'teste' });
  await mk('passado', at - 48 * H, at - 44 * H);
  await mk('teste', at + 2 * H, at + 6 * H);
  await mk('depois', at + 30 * H, at + 34 * H);
  await w.core.venues.follow(bia, 'v2');

  const d = await w.core.admin.venueDetail(A, 'v2');
  assert.equal(d.name, 'Kill Beer Lab');
  assert.equal(d.source, 'GOOGLE');
  assert.equal(d.owner?.id, ana);
  assert.equal(d.owner?.username, 'ana');
  assert.equal(d.followers, 1);
  assert.equal(d.eventsTotal, 3);
  assert.equal(d.upcomingCount, 2);
  assert.deepEqual(d.events.map((e) => [e.id, e.upcoming]), [['teste', true], ['depois', true], ['passado', false]], 'próximos por data e depois o que já passou');
  assert.equal(d.events[0]!.isSample, true);
  assert.equal(d.description, 'Gastrobar de Mogi');

  const bare = await w.core.admin.venueDetail(A, 'v1');
  assert.equal(bare.owner, null);
  assert.equal(bare.source, null);
  assert.deepEqual(bare.events, []);
});

test('detalhe do evento na gestão: cadastro, local, responsável e quem confirmou; só admin', async () => {
  const { w, A, U, ana, bia } = await setup();
  await w.places.createVenue({ id: 'v3', name: 'Sweet Mogi', address: 'Av. Y, 20', category: 'bar', lat: -23.52, lng: -46.18, isSample: false, ownerId: ana });
  const at = w.clock.now().getTime();
  await w.places.createEvent({ id: 'terca', venueId: 'v3', title: 'Terçaneja', description: 'Sertanejo toda terça', startsAt: new Date(at + 2 * H), endsAt: new Date(at + 6 * H), kind: 'NIGHT', isFree: true, imageUrl: null, tags: ['sertanejo'], isSample: false });
  await rejectsWith(w.core.admin.eventDetail(U(ana), 'terca'), 'FORBIDDEN');
  await rejectsWith(w.core.admin.eventDetail(A, 'nao-existe'), 'NOT_FOUND');
  await rejectsWith(w.core.admin.eventDetail(A, 42), 'NOT_FOUND');

  await w.core.eventPages.go(bia, 'terca');
  const d = await w.core.admin.eventDetail(A, 'terca');
  assert.equal(d.title, 'Terçaneja');
  assert.equal(d.description, 'Sertanejo toda terça');
  assert.equal(d.status, 'UPCOMING');
  assert.equal(d.isFree, true);
  assert.deepEqual(d.tags, ['sertanejo']);
  assert.equal(d.venue.name, 'Sweet Mogi');
  assert.equal(d.venue.owner?.username, 'ana');
  assert.equal(d.goingCount, 1);
  assert.deepEqual(d.going.map((g) => g.username), ['bia']);
});

test('gestão edita nome, @usuário e biografia de uma pessoa (com motivo na auditoria) e vê a atividade dela', async () => {
  const { w, A, U, adm, ana, bia } = await setup();
  await rejectsWith(w.core.admin.editUser(U(ana), bia, { displayName: 'X', note: 'x' }), 'FORBIDDEN');
  await rejectsWith(w.core.admin.editUser(A, bia, { displayName: 'Bia Nova' }), 'VALIDATION'); // sem motivo
  await rejectsWith(w.core.admin.editUser(A, bia, { username: 'ana', note: 'troca' }), 'VALIDATION'); // @ já em uso
  assert.deepEqual(await w.core.admin.usernameAvailableFor(A, bia, 'ana'), { username: 'ana', available: false, problem: 'Esse @usuário já está em uso' });
  assert.equal((await w.core.admin.usernameAvailableFor(A, bia, 'bia')).available, true, 'o @ dela mesma');
  assert.equal((await w.core.admin.usernameAvailableFor(A, bia, 'Bia.Livre')).username, 'bia.livre');
  await rejectsWith(w.core.admin.usernameAvailableFor(U(ana), bia, 'x'), 'FORBIDDEN');
  await rejectsWith(w.core.admin.editUser(A, adm, { displayName: 'Outro', note: 'x' }), 'CONFLICT'); // conta admin

  const before = await w.core.admin.userDetail(A, bia);
  assert.equal(before.username, 'bia');
  const edited = await w.core.admin.editUser(A, bia, { displayName: 'Bia Nova', username: 'bia.nova', bio: 'Oi', note: 'Pedido da própria pessoa' });
  assert.deepEqual([edited.displayName, edited.username, edited.bio], ['Bia Nova', 'bia.nova', 'Oi']);
  assert.equal((await w.users.findProfileByUsername('bia.nova'))?.userId, bia);
  assert.equal(await w.users.findProfileByUsername('bia'), undefined);
  const log = await w.core.admin.audit(A, {});
  assert.ok(log.items.some((r) => r.action === 'USER_PROFILE_EDITED' && /@bia → @bia\.nova/.test(r.note ?? '')));
  await rejectsWith(w.core.admin.editUser(A, bia, { displayName: 'Bia Nova', note: 'de novo' }), 'CONFLICT'); // nada mudou

  // Atividade: o que a pessoa fez (aqui, seguiu a ana).
  await rejectsWith(w.core.admin.userActivity(U(ana), bia, {}), 'FORBIDDEN');
  const activity = await w.core.admin.userActivity(A, bia, {});
  assert.ok(activity.items.some((i) => i.action === 'FOLLOW_USER'));
  const follows = await w.core.admin.userActivity(A, bia, { kind: 'LIKE' });
  assert.ok(follows.items.every((i) => i.kind === 'LIKE'));
});

test('tabelas da gestão ordenam pela coluna pedida, nas duas direções, e recusam coluna desconhecida', async () => {
  const { w, A } = await setup();
  const names = async (q: { sort?: string; dir?: string }) => (await w.core.admin.searchUsers(A, q)).items.map((r) => r.username);
  assert.deepEqual(await names({ sort: 'username' }), ['adm', 'ana', 'bia', 'caio']);
  assert.deepEqual(await names({ sort: 'username', dir: 'desc' }), ['caio', 'bia', 'ana', 'adm']);
  await w.places.createVenue({ id: 'v2', name: 'Arena', address: null, category: null, lat: -23.5, lng: -46.6, isSample: false });
  const venues = async (q: { sort?: string; dir?: string }) => (await w.core.admin.searchVenues(A, q)).items.map((r) => r.name);
  assert.deepEqual(await venues({}), ['Arena', 'Bar do Zé']);
  assert.deepEqual(await venues({ sort: 'name', dir: 'desc' }), ['Bar do Zé', 'Arena']);
  // Sem tipo fica no fim, nas duas direções.
  assert.deepEqual(await venues({ sort: 'category', dir: 'desc' }), ['Bar do Zé', 'Arena']);
  assert.deepEqual(await venues({ sort: 'category' }), ['Bar do Zé', 'Arena']);
  await rejectsWith(w.core.admin.searchUsers(A, { sort: 'passwordHash' }), 'VALIDATION');
  await rejectsWith(w.core.admin.searchUsers(A, { sort: 'email', dir: 'up' }), 'VALIDATION');
});
