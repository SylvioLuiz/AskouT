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
  assert.deepEqual(d.sameTitle, []);
  assert.equal(d.sameTitleTotal, 1);

  // O mesmo nome em outras semanas: o detalhe lista as outras datas, e a lista mostra endereço e confirmados.
  const week = 7 * 24 * H;
  await w.places.createEvent({ id: 'terca-2', venueId: 'v3', title: 'terçaneja ', description: null, startsAt: new Date(at + 2 * H + week), endsAt: new Date(at + 6 * H + week), kind: 'NIGHT', isFree: false, imageUrl: null, tags: [], isSample: false });
  await w.places.createEvent({ id: 'terca-0', venueId: 'v3', title: 'Terçaneja', description: null, startsAt: new Date(at + 2 * H - week), endsAt: new Date(at + 6 * H - week), kind: 'NIGHT', isFree: false, imageUrl: null, tags: [], isSample: false });
  const again = await w.core.admin.eventDetail(A, 'terca');
  assert.equal(again.sameTitleTotal, 3);
  assert.deepEqual(again.sameTitle.map((e) => [e.id, e.upcoming]), [['terca-0', false], ['terca-2', true]]);
  const list = await w.core.admin.searchPlaceEvents(A, { q: 'terçaneja' });
  const row = list.items.find((e) => e.id === 'terca');
  assert.equal(row?.goingCount, 1);
  assert.equal(row?.isFree, true);
  assert.equal(row?.venue.address, 'Av. Y, 20');
  assert.equal(list.items.find((e) => e.id === 'terca-2')?.goingCount, 0);
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

test('detalhe da pessoa: cadastro inteiro, amigos, seguidores e eventos', async () => {
  const { w, A, U, ana, bia, caio } = await setup();
  await w.core.follows.follow(caio, ana);
  const start = new Date(w.clock.now().getTime() + 24 * H).toISOString();
  const ev = await w.core.posts.create(ana, { images: [JPEG()], caption: 'Vem!', placeName: 'Praça', event: { title: 'Corrida de rua', startsAt: start } });
  await rejectsWith(w.core.admin.userDetail(U(ana), ana), 'FORBIDDEN');
  const d = await w.core.admin.userDetail(A, ana);
  assert.equal(d.username, 'ana');
  assert.ok(d.extra);
  assert.deepEqual(d.extra.friends.map((f) => f.id), [bia]);
  assert.deepEqual(d.extra.followers.map((f) => f.id).sort(), [bia, caio].sort());
  assert.deepEqual([d.extra.counts.friends, d.extra.counts.followers, d.extra.counts.following], [1, 2, 1]);
  assert.deepEqual(d.extra.eventsCreated.map((e) => [e.id, e.title]), [[ev.id, 'Corrida de rua']]);
  assert.equal(d.extra.counts.posts, 1);
  assert.equal('passwordHash' in d, false);
  await rejectsWith(w.core.admin.userDetail(A, 'nao-existe'), 'NOT_FOUND');
});

test('números da pessoa para a gestão: só admin, contagens e último uso', async () => {
  const { w, A, U, ana, bia } = await setup();
  const start = new Date(w.clock.now().getTime() + 24 * H).toISOString();
  await w.core.posts.create(ana, { images: [JPEG()], caption: 'Vem!', placeName: 'Praça', event: { title: 'Corrida de rua', startsAt: start } });
  await rejectsWith(w.core.admin.userStats(U(ana), ana), 'FORBIDDEN');
  const s = await w.core.admin.userStats(A, ana);
  assert.equal(s.content.posts, 1);
  assert.equal(s.events.created, 1);
  assert.equal(s.social.friends, 1);
  assert.ok(s.lastSeenAt);
  assert.ok(s.actions30 >= 1);
  assert.equal(s.activeDays30 >= 1, true);
  assert.equal(s.accountAgeDays, 0);
  assert.equal('body' in s.messages, false);
  const other = await w.core.admin.userStats(A, bia);
  assert.equal(other.content.posts, 0);
  await rejectsWith(w.core.admin.userStats(A, 'nao-existe'), 'NOT_FOUND');
});

test('editar local pela gestão: motivo obrigatório, campos de admin e auditoria com o que mudou', async () => {
  const { w, A, U, ana } = await setup();
  await rejectsWith(w.core.admin.editVenue(U(ana), 'v1', { name: 'X', note: 'x' }), 'FORBIDDEN');
  await rejectsWith(w.core.admin.editVenue(A, 'v1', { name: 'Bar do Zé Novo' }), 'VALIDATION');
  await rejectsWith(w.core.admin.editVenue(A, 'v1', { name: 'Bar do Zé', note: 'nada' }), 'CONFLICT');
  await rejectsWith(w.core.admin.editVenue(A, 'v1', { lat: 200, note: 'posição' }), 'VALIDATION');
  await rejectsWith(w.core.admin.editVenue(A, 'v1', { feedPolicy: 'TODOS', note: 'feed' }), 'VALIDATION');
  const d = await w.core.admin.editVenue(A, 'v1', { name: 'Bar do Zé Novo', description: 'Samba toda sexta', lat: -23.5, isSample: true, feedPolicy: 'OPEN', note: 'Pedido do dono' });
  assert.deepEqual([d.name, d.description, d.lat, d.isSample, d.extra?.feedPolicy], ['Bar do Zé Novo', 'Samba toda sexta', -23.5, true, 'OPEN']);
  assert.equal(d.address, 'Rua A, 1', 'o que não veio continua');
  const log = (await w.core.admin.audit(A, {})).items[0]!;
  assert.equal(log.action, 'VENUE_EDITED');
  assert.match(log.note ?? '', /Pedido do dono/);
  assert.match(log.note ?? '', /nome: Bar do Zé → Bar do Zé Novo/);
  await rejectsWith(w.core.admin.editVenue(A, 'nao-existe', { name: 'X', note: 'x' }), 'NOT_FOUND');
});

test('editar local pela gestão: @ do Instagram normalizado, link aceito, vazio remove', async () => {
  const { w, A } = await setup();
  await rejectsWith(w.core.admin.editVenue(A, 'v1', { instagram: 'bar do zé', note: 'ig' }), 'VALIDATION');
  await rejectsWith(w.core.admin.editVenue(A, 'v1', { instagram: '@bar..ze', note: 'ig' }), 'VALIDATION');
  const d = await w.core.admin.editVenue(A, 'v1', { instagram: '@BarDoZe', note: 'ig' });
  assert.equal(d.instagram, 'bardoze');
  await rejectsWith(w.core.admin.editVenue(A, 'v1', { instagram: 'https://www.instagram.com/bardoze/?hl=pt', note: 'ig' }), 'CONFLICT');
  const log = (await w.core.admin.audit(A, {})).items[0]!;
  assert.match(log.note ?? '', /instagram: .*→ bardoze/);
  const vazio = await w.core.admin.editVenue(A, 'v1', { instagram: '', note: 'ig' });
  assert.equal(vazio.instagram, null);
});

test('editar local pela gestão: capa e logo anexadas viram imagem do local; erro cai no campo certo', async () => {
  const { w, A } = await setup();
  const png = (n: number) => `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n)]).toString('base64')}`;
  const d = await w.core.admin.editVenue(A, 'v1', { imageData: png(16), logoData: png(8), note: 'fotos do dono' });
  assert.match(d.coverUrl ?? '', /^\/venues\/v1\/cover\?v=/);
  assert.match(d.logoUrl ?? '', /^\/venues\/v1\/logo\?v=/);
  assert.equal((await w.core.venues.venueCover('v1'))?.mime, 'image/png');
  assert.equal((await w.core.venues.venueLogo('v1'))?.mime, 'image/png');
  const log = (await w.core.admin.audit(A, {})).items[0]!;
  assert.match(log.note ?? '', /capa: .*→/);
  assert.match(log.note ?? '', /logo: .*→/);
  const fieldsOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return Object.keys((e as { details?: Record<string, string> }).details ?? {});
    }
    assert.fail('devia recusar');
  };
  assert.deepEqual(await fieldsOf(w.core.admin.editVenue(A, 'v1', { logoUrl: 'http://x/logo.png', note: 'logo' })), ['logoUrl']);
  assert.deepEqual(await fieldsOf(w.core.admin.editVenue(A, 'v1', { logoData: 'data:image/png;base64,AAAA', note: 'logo' })), ['logoData']);
  assert.deepEqual(await fieldsOf(w.core.admin.editVenue(A, 'v1', { imageData: png(300 * 1024), note: 'capa' })), ['imageData']);
  assert.deepEqual(await fieldsOf(w.core.admin.editVenue(A, 'v1', { imageUrl: 'ftp://x', note: 'capa' })), ['imageUrl']);
});

test('editar evento de local pela gestão: mesmas regras de quem administra e auditoria', async () => {
  const { w, A, U, ana } = await setup();
  const now = w.clock.now().getTime();
  // Evento que já começou: dá para corrigir o resto sem mexer no início.
  await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Samba', description: null, kind: 'SHOW', isFree: false, imageUrl: null, tags: [], startsAt: new Date(now - 2 * H), endsAt: new Date(now + 2 * H), isSample: false });
  const base = { title: 'Samba', startsAt: new Date(now - 2 * H).toISOString(), endsAt: new Date(now + 2 * H).toISOString(), kind: 'SHOW', isFree: false };
  await rejectsWith(w.core.admin.editPlaceEvent(U(ana), 'e1', { ...base, note: 'x' }), 'FORBIDDEN');
  await rejectsWith(w.core.admin.editPlaceEvent(A, 'e1', { ...base, title: 'Samba de roda' }), 'VALIDATION');
  await rejectsWith(w.core.admin.editPlaceEvent(A, 'e1', { ...base, note: 'nada' }), 'CONFLICT');
  await rejectsWith(w.core.admin.editPlaceEvent(A, 'e1', { ...base, endsAt: base.startsAt, note: 'fim' }), 'VALIDATION');
  const d = await w.core.admin.editPlaceEvent(A, 'e1', { ...base, title: 'Samba de roda', isFree: true, tags: ['samba'], ticketUrl: 'https://ingressos.exemplo.com/samba', feedPolicy: 'MODERATED', note: 'Nome errado' });
  assert.deepEqual([d.title, d.isFree, d.tags, d.ticketUrl, d.extra?.feedPolicy], ['Samba de roda', true, ['samba'], 'https://ingressos.exemplo.com/samba', 'MODERATED']);
  const log = (await w.core.admin.audit(A, {})).items[0]!;
  assert.equal(log.action, 'PLACE_EVENT_EDITED');
  assert.match(log.note ?? '', /nome: Samba → Samba de roda/);
  await rejectsWith(w.core.admin.editPlaceEvent(A, 'nao-existe', { ...base, note: 'x' }), 'NOT_FOUND');
});

test('detalhe de evento criado por pessoa mostra quem vai e os convidados que ainda não confirmaram', async () => {
  const { w, A, adm, ana, bia, caio } = await setup();
  await w.core.follows.follow(ana, caio);
  await w.core.follows.follow(caio, ana);
  const start = new Date(w.clock.now().getTime() + 24 * H).toISOString();
  const post = await w.core.posts.create(ana, { placeName: 'Praça', tagUserIds: [bia, caio], event: { title: 'Corrida', startsAt: start, private: false } });
  await w.core.eventPages.go(bia, post.id);
  await w.core.eventPages.go(adm, post.id);
  await w.users.updateProfile({ ...(await w.users.findProfileById(bia))!, avatarUrl: 'https://exemplo.com/bia.jpg' });
  const p = await w.core.admin.postDetail(A, post.id);
  assert.deepEqual(p.going.map((g) => g.username), ['bia', 'adm']);
  assert.deepEqual(p.going.map((g) => g.avatarUrl), ['https://exemplo.com/bia.jpg', null]);
  assert.equal(p.counts.attendees, 2);
  // bia foi convidada e confirmou: só caio continua pendente.
  assert.deepEqual(p.invitedPending.map((i) => [i.username, i.invitedBy?.username]), [['caio', 'ana']]);
  assert.equal(p.invitedPendingCount, 1);
});

test('detalhe do post e detalhes de local e evento trazem o resto do cadastro', async () => {
  const { w, A, U, ana } = await setup();
  const post = await w.core.posts.create(ana, { placeName: 'Bar do Zé', images: [JPEG()], caption: 'Foto do pôr do sol' });
  await rejectsWith(w.core.admin.postDetail(U(ana), post.id), 'FORBIDDEN');
  const p = await w.core.admin.postDetail(A, post.id);
  assert.deepEqual([p.caption, p.author.username, p.placeName, p.images.length], ['Foto do pôr do sol', 'ana', 'Bar do Zé', 1]);
  await rejectsWith(w.core.admin.postDetail(A, 'nao-existe'), 'NOT_FOUND');
  await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Samba', description: null, kind: 'SHOW', isFree: true, imageUrl: null, tags: [], startsAt: new Date(w.clock.now().getTime() + 2 * H), endsAt: new Date(w.clock.now().getTime() + 5 * H), isSample: false });
  assert.equal((await w.core.admin.eventDetail(A, 'e1')).extra?.feedPolicy, 'OWNER_ONLY');
  assert.deepEqual((await w.core.admin.venueDetail(A, 'v1')).extra?.managers, []);
});

test('cadastrar local pela gestão: posição pelo endereço (gratuita primeiro), duplicado recusado e auditoria', async () => {
  const { w, A, U, ana } = await setup();
  await rejectsWith(w.core.admin.createVenue(U(ana), { name: 'Novo', address: 'Rua B, 2' }), 'FORBIDDEN');
  await rejectsWith(w.core.admin.createVenue(A, { name: 'X' }), 'VALIDATION');
  await rejectsWith(w.core.admin.createVenue(A, { name: 'Sem posição' }), 'VALIDATION');
  await rejectsWith(w.core.admin.createVenue(A, { name: 'Meia posição', lat: -23.5 }), 'VALIDATION');
  w.placeSource.searchable = [{ externalId: 'node/1', source: 'OSM', name: 'Rua B, 2', category: null, lat: -23.6, lng: -46.7, address: 'Rua B, 2 - São Paulo' }];
  const d = await w.core.admin.createVenue(A, { name: 'Bar Novo', address: 'Rua B, 2', category: 'bar', description: 'Samba', instagram: '@BarNovo', feedPolicy: 'OPEN', note: 'Pedido do comercial' });
  assert.deepEqual([d.name, d.address, d.lat, d.lng, d.description, d.instagram, d.extra?.feedPolicy], ['Bar Novo', 'Rua B, 2', -23.6, -46.7, 'Samba', 'barnovo', 'OPEN']);
  assert.equal(w.placeSource.premiumCalls, 0, 'achou na busca gratuita, não usou o Google');
  const log = (await w.core.admin.audit(A, {})).items[0]!;
  assert.equal(log.action, 'VENUE_CREATED');
  assert.equal(log.targetId, d.id);
  assert.match(log.note ?? '', /Pedido do comercial/);
  await rejectsWith(w.core.admin.createVenue(A, { name: 'bar  novo!', lat: -23.6001, lng: -46.7001 }), 'CONFLICT');
  // Endereço que a gratuita não acha: tenta o Google.
  w.placeSource.premiumSearch = true;
  w.placeSource.premiumOnly = [{ externalId: 'g1', source: 'GOOGLE', name: 'Av. C, 3', category: null, lat: -22.9, lng: -43.2, address: 'Av. C, 3 - Rio' }];
  const g = await w.core.admin.createVenue(A, { name: 'Casa Rio', address: 'Av. C, 3' });
  assert.deepEqual([g.lat, g.lng], [-22.9, -43.2]);
  assert.equal(w.placeSource.premiumCalls, 1);
});

test('importar locais pela gestão: prévia por linha, erros, duplicados e importação só do que está certo', async () => {
  const { w, A, U, ana } = await setup();
  await rejectsWith(w.core.admin.importVenues(U(ana), { rows: [{ name: 'X' }] }), 'FORBIDDEN');
  await rejectsWith(w.core.admin.importVenues(A, { rows: [] }), 'VALIDATION');
  w.placeSource.searchable = [{ externalId: 'node/9', source: 'OSM', name: 'Rua D, 4', category: null, lat: -23.4, lng: -46.4, address: null }];
  const rows = [
    { name: 'Balada Um', address: 'Rua D, 4', category: 'balada', isSample: 'sim' },
    { name: 'Bar Dois', lat: '-23,51', lng: '-46.61' },
    { name: 'B' },
    { name: 'Bar do Zé', lat: -23.5801, lng: -46.6501 },
    { name: 'Balada um', lat: -23.4001, lng: -46.4001 },
    { name: 'Lugar', address: 'Endereço que não existe' },
  ];
  const preview = await w.core.admin.importVenues(A, { rows, dryRun: true, fileName: 'locais.xlsx' });
  assert.deepEqual(preview.lines.map((l) => [l.line, l.status]), [[2, 'OK'], [3, 'OK'], [4, 'ERROR'], [5, 'DUPLICATE'], [6, 'DUPLICATE'], [7, 'ERROR']]);
  assert.equal(preview.lines[0]!.located, 'FREE');
  assert.deepEqual([preview.lines[1]!.lat, preview.lines[1]!.lng, preview.lines[1]!.located], [-23.51, -46.61, 'SHEET']);
  assert.ok(preview.lines[2]!.problems['name']);
  assert.equal(preview.lines[3]!.duplicateOf?.id, 'v1');
  assert.equal(preview.lines[4]!.duplicateOf?.line, 2);
  assert.ok(preview.lines[5]!.problems['address']);
  assert.deepEqual(preview.counts, { ok: 2, errors: 2, duplicates: 2, created: 0 });
  assert.equal((await w.core.admin.audit(A, {})).items.length, 0, 'a prévia não grava nada');

  const done = await w.core.admin.importVenues(A, { rows, dryRun: false, fileName: 'locais.xlsx' });
  assert.equal(done.counts.created, 2);
  const created = done.lines.filter((l) => l.status === 'CREATED');
  const um = await w.core.admin.venueDetail(A, created[0]!.venueId);
  assert.deepEqual([um.name, um.category, um.isSample], ['Balada Um', 'balada', true]);
  const logs = (await w.core.admin.audit(A, {})).items.map((l) => l.action);
  assert.deepEqual(logs.filter((a) => a === 'VENUE_CREATED').length, 2);
  assert.ok(logs.includes('VENUES_IMPORTED'));
  // De novo: tudo duplicado, nada a importar.
  await rejectsWith(w.core.admin.importVenues(A, { rows: rows.slice(0, 2), dryRun: false }), 'CONFLICT');
});

test('cadastrar local a partir do Google: sugestões, detalhe só com campos grátis, vínculo e duplicados', async () => {
  const calls: string[] = [];
  const googlePicker = {
    async suggest(text: string, session: string) {
      calls.push(`suggest:${text}:${session}`);
      return { available: true, items: [{ placeId: 'ChIJabc', name: 'Bar Augusta', address: 'Rua Augusta, 1500 - São Paulo' }] };
    },
    async essentials(placeId: string, session?: string) {
      calls.push(`essentials:${placeId}:${session}`);
      return placeId === 'ChIJabc' ? { placeId, address: 'Rua Augusta, 1500 - Consolação, São Paulo - SP', lat: -23.5558, lng: -46.6623, types: ['bar', 'restaurant', 'food'] } : undefined;
    },
  };
  const w = makeWorld({ googlePicker });
  const u = await w.signUpMany('adm', 'ana');
  w.users.users.set(u['adm']!, { ...w.users.users.get(u['adm']!)!, role: 'ADMIN' });
  const A = { userId: u['adm']!, role: 'ADMIN' as const };
  await rejectsWith(w.core.admin.googleSuggest({ userId: u['ana']!, role: 'USER' }, { text: 'bar', sessionToken: 's' }), 'FORBIDDEN');
  const s = await w.core.admin.googleSuggest(A, { text: 'bar augusta', sessionToken: 'sess-1234' });
  assert.equal(s.items[0]!.name, 'Bar Augusta');
  const place = await w.core.admin.googlePlace(A, { placeId: 'ChIJabc', name: 'Bar Augusta', sessionToken: 'sess-1234' });
  assert.deepEqual([place.address, place.lat, place.category, place.linked, place.duplicate], ['Rua Augusta, 1500 - Consolação, São Paulo - SP', -23.5558, 'bar', null, null]);
  assert.deepEqual(calls, ['suggest:bar augusta:sess-1234', 'essentials:ChIJabc:sess-1234'], 'a mesma sessão liga a sugestão ao detalhe');
  await rejectsWith(w.core.admin.googlePlace(A, { placeId: 'nao/valido' }), 'VALIDATION');
  await rejectsWith(w.core.admin.googlePlace(A, { placeId: 'ChIJsumiu' }), 'CONFLICT');

  const d = await w.core.admin.createVenue(A, { name: 'Bar Augusta', address: place.address, category: place.category, lat: place.lat, lng: place.lng, googlePlaceId: 'ChIJabc', instagram: '@baraugusta' });
  assert.deepEqual([d.source, d.extra?.externalKey, d.instagram], ['GOOGLE', 'google:ChIJabc', 'baraugusta']);
  await rejectsWith(w.core.admin.createVenue(A, { name: 'Outro nome', lat: -10, lng: -40, googlePlaceId: 'ChIJabc' }), 'CONFLICT');
  const again = await w.core.admin.googlePlace(A, { placeId: 'ChIJabc', name: 'Bar Augusta' });
  assert.equal(again.linked?.id, d.id);

  const off = makeWorld();
  const ou = await off.signUpMany('adm');
  off.users.users.set(ou['adm']!, { ...off.users.users.get(ou['adm']!)!, role: 'ADMIN' });
  assert.deepEqual(await off.core.admin.googleSuggest({ userId: ou['adm']!, role: 'ADMIN' }, { text: 'bar', sessionToken: 'sess-1234' }), { available: false, items: [] });
});

test('Hunter: busca locais no Google, marca os que já estão no AskouT e grava só os novos', async () => {
  const { w, A } = await setup();
  const g = (id: string, name: string, lat: number, lng: number, category: string | null = 'bar') => ({ externalId: id, source: 'GOOGLE' as const, name, category, lat, lng, address: `${name}, Pinheiros - São Paulo` });
  w.placeSource.premiumSearch = true;
  w.placeSource.premiumOnly = [g('ChIJnovo1', 'Bar Novo Pinheiros', -23.561, -46.69), g('ChIJnovo2', 'Balada Nova Pinheiros', -23.562, -46.691, 'night_club'), g('ChIJvelho', 'Bar Antigo Pinheiros', -23.563, -46.692)];
  await rejectsWith(w.core.admin.googleSearchVenues(A, { text: 'pi' }), 'VALIDATION');
  const old = await w.core.admin.createVenue(A, { name: 'Bar Antigo Pinheiros', lat: -23.5631, lng: -46.6921 });
  const r = await w.core.admin.googleSearchVenues(A, { text: 'pinheiros' });
  assert.equal(r.available, true);
  assert.deepEqual(r.items.map((i) => [i.placeId, i.status, i.category]), [['ChIJnovo1', 'NEW', 'bar'], ['ChIJnovo2', 'NEW', 'balada'], ['ChIJvelho', 'DUPLICATE', 'bar']]);
  assert.equal(r.items[2]!.existing?.id, old.id);

  const saved = await w.core.admin.googleSaveVenues(A, { places: [...r.items, r.items[0]] });
  assert.deepEqual(saved.results.map((x) => x.status), ['CREATED', 'CREATED', 'SKIPPED', 'SKIPPED'], 'pula o que já existe e o repetido no próprio lote');
  assert.deepEqual([saved.created, saved.skipped], [2, 2]);
  const d = await w.core.admin.venueDetail(A, saved.results[1]!.venueId!);
  assert.deepEqual([d.name, d.category, d.source, d.extra?.externalKey], ['Balada Nova Pinheiros', 'balada', 'GOOGLE', 'google:ChIJnovo2']);
  const again = await w.core.admin.googleSearchVenues(A, { text: 'pinheiros' });
  assert.deepEqual(again.items.map((i) => i.status), ['LINKED', 'LINKED', 'DUPLICATE']);

  w.placeSource.premiumSearch = false;
  assert.deepEqual(await w.core.admin.googleSearchVenues(A, { text: 'pinheiros' }), { available: false, items: [] });
});

test('painel do Hunter: busca no Google e cria o local sem duplicar (auditoria como sistema)', async () => {
  const { w, A } = await setup();
  w.placeSource.premiumSearch = true;
  w.placeSource.premiumOnly = [{ externalId: 'ChIJbrahma', source: 'GOOGLE', name: 'Bar Brahma', category: 'bar', lat: -23.5412, lng: -46.6417, address: 'Av. São João, 677 - Centro, São Paulo' }];
  const r = await w.core.admin.hunterGoogleSearch({ text: 'brahma', lat: '-23.55', lng: '-46.63' });
  assert.deepEqual(r.items.map((i) => [i.placeId, i.status]), [['ChIJbrahma', 'NEW']]);
  const hit = r.items[0]!;
  const first = await w.core.admin.hunterGoogleCreate(hit);
  assert.equal(first.created, true);
  const again = await w.core.admin.hunterGoogleCreate(hit);
  assert.deepEqual(again, { created: false, venue: first.venue }, 'mesmo lugar do Google: devolve o existente');
  const twin = await w.core.admin.hunterGoogleCreate({ ...hit, placeId: 'ChIJoutro' });
  assert.deepEqual([twin.created, twin.venue.id], [false, first.venue.id], 'mesmo nome a menos de 250 m: não duplica');
  const log = (await w.core.admin.audit(A, {})).items.find((l) => l.action === 'VENUE_CREATED');
  assert.ok(log && log.note?.includes('painel do Hunter'));
  await rejectsWith(w.core.admin.hunterGoogleCreate({ placeId: 'nao/valido' }), 'VALIDATION');
});

test('gestão: endereço que a busca gratuita não acha com o Google sem cota hoje diz o motivo', async () => {
  const { w, A } = await setup();
  w.placeSource.premiumSearch = false;
  w.placeSource.premiumPaused = true;
  assert.deepEqual(await w.core.admin.geocodeAddress(A, 'Av. Sem Mapa, 9'), { items: [], googlePaused: true });
  const err = await w.core.admin.createVenue(A, { name: 'Casa Nova', address: 'Av. Sem Mapa, 9' }).then(() => undefined, (e: unknown) => e);
  assert.match(JSON.stringify(err), /limite de hoje/);
  assert.equal(w.placeSource.premiumCalls, 0);
  w.placeSource.premiumPaused = false;
  assert.deepEqual(await w.core.admin.geocodeAddress(A, 'Av. Sem Mapa, 9'), { items: [] });
});
