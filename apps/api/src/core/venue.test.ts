import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const JPEG = (n = 10) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]).toString('base64')}`;
const PDF = (n = 10) => `data:application/pdf;base64,${Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(n, 65)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'adm');
  const ana = u['ana']!, bia = u['bia']!, adm = u['adm']!;
  const admin = w.users.users.get(adm)!;
  w.users.users.set(adm, { ...admin, role: 'ADMIN' });
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: -23.58, lng: -46.65, isSample: false });
  await w.places.createVenue({ id: 'v2', name: 'Bar do Zé Dois', address: null, category: 'bar', lat: -23.59, lng: -46.65, isSample: false });
  const start = () => new Date(w.clock.now().getTime() + 24 * H).toISOString();
  return { w, ana, bia, adm, start };
}

test('busca de locais para reivindicar mostra o estado de cada um', async () => {
  const { w, ana, bia, adm } = await setup();
  assert.deepEqual(await w.core.venues.searchClaimable(ana, 'z'), [], 'busca curta não retorna nada');
  assert.deepEqual((await w.core.venues.searchClaimable(ana, 'zé')).map((v) => v.state), ['FREE', 'FREE']);
  const claim = await w.core.venues.requestClaim(ana, 'v1', { document: JPEG() });
  assert.equal((await w.core.venues.searchClaimable(ana, 'zé')).find((v) => v.id === 'v1')?.state, 'PENDING');
  assert.equal((await w.core.venues.searchClaimable(bia, 'zé')).find((v) => v.id === 'v1')?.state, 'FREE', 'o pedido de outra pessoa não trava');
  await w.core.venues.reviewClaim(adm, claim.id, 'APPROVED');
  assert.equal((await w.core.venues.searchClaimable(ana, 'zé')).find((v) => v.id === 'v1')?.state, 'MINE');
  assert.equal((await w.core.venues.searchClaimable(bia, 'zé')).find((v) => v.id === 'v1')?.state, 'TAKEN');
});

test('pedido de reivindicação: documento obrigatório e válido, sem duplicar, com limite', async () => {
  const { w, ana, bia } = await setup();
  await rejectsWith(w.core.venues.requestClaim(ana, 'v1', {}), 'VALIDATION');
  await rejectsWith(w.core.venues.requestClaim(ana, 'v1', { document: 'data:text/html;base64,PGI+' }), 'VALIDATION');
  await rejectsWith(w.core.venues.requestClaim(ana, 'v1', { document: `data:application/pdf;base64,${Buffer.from('nao e pdf').toString('base64')}` }), 'VALIDATION');
  await rejectsWith(w.core.venues.requestClaim(ana, 'v1', { document: JPEG(3 * 1024 * 1024) }), 'VALIDATION');
  await rejectsWith(w.core.venues.requestClaim(ana, 'v1', { document: JPEG(), note: 'x'.repeat(301) }), 'VALIDATION');
  await rejectsWith(w.core.venues.requestClaim(ana, 'nao-existe', { document: JPEG() }), 'NOT_FOUND');
  const ok = await w.core.venues.requestClaim(ana, 'v1', { document: PDF(), note: ' Sou o dono ' });
  assert.equal(ok.status, 'PENDING');
  assert.equal(w.claims.claims.get(ok.id)?.note, 'Sou o dono');
  assert.equal(w.claims.claims.get(ok.id)?.documentMime, 'application/pdf');
  await rejectsWith(w.core.venues.requestClaim(ana, 'v1', { document: JPEG() }), 'CONFLICT');
  await w.core.venues.requestClaim(bia, 'v1', { document: JPEG() });
  for (let i = 0; i < 4; i += 1) {
    await w.places.createVenue({ id: `x${i}`, name: `Extra ${i}`, address: null, category: null, lat: 0, lng: 0, isSample: false });
    await w.core.venues.requestClaim(ana, `x${i}`, { document: JPEG() });
  }
  await w.places.createVenue({ id: 'x9', name: 'Extra 9', address: null, category: null, lat: 0, lng: 0, isSample: false });
  await rejectsWith(w.core.venues.requestClaim(ana, 'x9', { document: JPEG() }), 'CONFLICT');
});

test('o admin decide: aprovar dá o local, recusa exige motivo, só admin decide e vê o documento', async () => {
  const { w, ana, bia, adm } = await setup();
  const a = await w.core.venues.requestClaim(ana, 'v1', { document: JPEG() });
  const b = await w.core.venues.requestClaim(bia, 'v1', { document: JPEG() });
  await rejectsWith(w.core.venues.reviewClaim(ana, a.id, 'APPROVED'), 'FORBIDDEN');
  await rejectsWith(w.core.venues.claimDocument(ana, a.id), 'FORBIDDEN');
  assert.equal((await w.core.venues.claimDocument(adm, a.id))?.mime, 'image/jpeg');
  await rejectsWith(w.core.venues.reviewClaim(adm, a.id, 'TALVEZ'), 'VALIDATION');
  await rejectsWith(w.core.venues.reviewClaim(adm, a.id, 'REJECTED'), 'VALIDATION');
  await rejectsWith(w.core.venues.reviewClaim(adm, 'nao-existe', 'APPROVED'), 'NOT_FOUND');
  const done = await w.core.venues.reviewClaim(adm, a.id, 'APPROVED');
  assert.equal(done.status, 'APPROVED');
  assert.equal((await w.places.findVenue('v1'))?.ownerId, ana);
  assert.equal(w.claims.claims.get(b.id)?.status, 'REJECTED', 'o outro pedido pendente do local é recusado');
  await rejectsWith(w.core.venues.reviewClaim(adm, a.id, 'APPROVED'), 'CONFLICT');
  await w.core.flushNotifications();
  const notes = await w.notifications.listForUser(ana, 10);
  assert.ok(notes.some((n) => n.type === 'VENUE_CLAIM' && n.title.includes('Bar do Zé')));
  const c = await w.core.venues.requestClaim(bia, 'v2', { document: JPEG() });
  const rej = await w.core.venues.reviewClaim(adm, c.id, 'REJECTED', 'Documento ilegível');
  assert.equal(rej.reviewNote, 'Documento ilegível');
  assert.equal((await w.places.findVenue('v2'))?.ownerId ?? null, null);
  const mine = await w.core.venues.mine(bia);
  assert.deepEqual(mine.venues, []);
  assert.equal(mine.claims.length, 2);
  assert.ok(mine.claims.every((m) => m.status === 'REJECTED'));
  await rejectsWith(w.core.venues.requestClaim(bia, 'v1', { document: JPEG() }), 'CONFLICT');
});

test('desistir do pedido', async () => {
  const { w, ana, bia } = await setup();
  const a = await w.core.venues.requestClaim(ana, 'v1', { document: JPEG() });
  await rejectsWith(w.core.venues.cancelClaim(bia, a.id), 'NOT_FOUND');
  await w.core.venues.cancelClaim(ana, a.id);
  await rejectsWith(w.core.venues.cancelClaim(ana, a.id), 'CONFLICT');
  await w.core.venues.requestClaim(ana, 'v1', { document: JPEG() });
});

test('painel: só o responsável vê e mexe; cria, edita e apaga eventos reais', async () => {
  const { w, ana, bia, adm, start } = await setup();
  const claim = await w.core.venues.requestClaim(ana, 'v1', { document: JPEG() });
  await rejectsWith(w.core.venues.panel(ana, 'v1'), 'NOT_FOUND');
  await w.core.venues.reviewClaim(adm, claim.id, 'APPROVED');
  await rejectsWith(w.core.venues.panel(bia, 'v1'), 'NOT_FOUND');
  await rejectsWith(w.core.venues.createEvent(bia, 'v1', { title: 'X', startsAt: start() }), 'NOT_FOUND');
  const created = await w.core.venues.createEvent(ana, 'v1', { title: ' Samba ', description: 'Ao vivo', kind: 'SHOW', startsAt: start(), isFree: true, tags: ['#Samba', 'música', 'samba'], imageUrl: 'https://img.exemplo/a.jpg' });
  assert.equal(created.title, 'Samba');
  assert.equal(created.sample, false);
  assert.deepEqual(created.tags, ['samba', 'musica']);
  assert.equal(created.phase, 'UPCOMING');
  assert.equal(new Date(created.endsAt).getTime() - new Date(created.startsAt).getTime(), 3 * H, 'fim padrão: 3 h');
  const page = await w.core.eventPages.get(bia, created.id, {});
  assert.equal(page.title, 'Samba', 'o evento aparece para todo mundo na página do evento');
  const found = await w.core.explore.search(bia, { q: 'samba' });
  assert.ok(found.events.some((e) => e.id === created.id), 'e no Explorar');
  const edited = await w.core.venues.updateEvent(ana, 'v1', created.id, { title: 'Samba de roda', startsAt: created.startsAt, kind: 'SHOW' });
  assert.equal(edited.title, 'Samba de roda');
  assert.equal(edited.isFree, false);
  await rejectsWith(w.core.venues.updateEvent(bia, 'v1', created.id, { title: 'X', startsAt: start() }), 'NOT_FOUND');
  await rejectsWith(w.core.venues.updateEvent(ana, 'v1', 'nao-existe', { title: 'X', startsAt: start() }), 'NOT_FOUND');
  assert.equal((await w.core.venues.panel(ana, 'v1')).events.length, 1);
  await rejectsWith(w.core.venues.deleteEvent(bia, 'v1', created.id), 'NOT_FOUND');
  await w.core.venues.deleteEvent(ana, 'v1', created.id);
  assert.equal((await w.core.venues.panel(ana, 'v1')).events.length, 0);
  await rejectsWith(w.core.venues.deleteEvent(ana, 'v1', created.id), 'NOT_FOUND');
});

test('validação do evento do local', async () => {
  const { w, ana, adm, start } = await setup();
  const claim = await w.core.venues.requestClaim(ana, 'v1', { document: JPEG() });
  await w.core.venues.reviewClaim(adm, claim.id, 'APPROVED');
  const bad = (input: Record<string, unknown>) => rejectsWith(w.core.venues.createEvent(ana, 'v1', { title: 'Ok', startsAt: start(), ...input }), 'VALIDATION');
  await bad({ title: '' });
  await bad({ title: 'x'.repeat(81) });
  await bad({ startsAt: 'ontem' });
  await bad({ startsAt: new Date(w.clock.now().getTime() - 24 * H).toISOString() });
  await bad({ startsAt: new Date(w.clock.now().getTime() + 3 * 365 * 24 * H).toISOString() });
  await bad({ endsAt: new Date(w.clock.now().getTime() + 23 * H).toISOString() });
  await bad({ endsAt: new Date(w.clock.now().getTime() + 40 * 24 * H).toISOString() });
  await bad({ kind: 'NADA' });
  await bad({ isFree: 'sim' });
  await bad({ imageUrl: 'http://inseguro.com/a.jpg' });
  await bad({ imageUrl: 'javascript:alert(1)' });
  await bad({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] });
  await bad({ description: 'x'.repeat(1001) });
});

test('evento já começado pode ser editado sem mexer no início', async () => {
  const { w, ana, adm, start } = await setup();
  const claim = await w.core.venues.requestClaim(ana, 'v1', { document: JPEG() });
  await w.core.venues.reviewClaim(adm, claim.id, 'APPROVED');
  const created = await w.core.venues.createEvent(ana, 'v1', { title: 'Noite', startsAt: start() });
  w.clock.tick(25 * H);
  assert.equal((await w.core.venues.panel(ana, 'v1')).events[0]?.phase, 'LIVE');
  const edited = await w.core.venues.updateEvent(ana, 'v1', created.id, { title: 'Noite longa', startsAt: created.startsAt });
  assert.equal(edited.title, 'Noite longa');
  await rejectsWith(w.core.venues.updateEvent(ana, 'v1', created.id, { title: 'Noite', startsAt: new Date(w.clock.now().getTime() - 30 * H).toISOString() }), 'VALIDATION');
  w.clock.tick(5 * H);
  assert.equal((await w.core.venues.panel(ana, 'v1')).events[0]?.phase, 'PAST');
});
