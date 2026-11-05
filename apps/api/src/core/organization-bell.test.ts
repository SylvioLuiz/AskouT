import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const JPEG = (n = 10) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('pres', 'ana', 'bia', 'adm');
  const pres = u['pres']!, ana = u['ana']!, bia = u['bia']!, adm = u['adm']!;
  const admin = w.users.users.get(adm)!;
  w.users.users.set(adm, { ...admin, role: 'ADMIN' });
  const start = () => new Date(w.clock.now().getTime() + 24 * H).toISOString();
  const request = { name: 'Bateria Furiosa', type: 'Bateria', campus: 'UFMG - Campus Pampulha', description: 'A bateria da engenharia', lat: -19.87, lng: -43.96, document: JPEG() };
  return { w, pres, ana, bia, adm, start, request };
}

async function approvedOrganization() {
  const s = await setup();
  const claim = await s.w.core.venues.requestOrganization(s.pres, s.request);
  await s.w.core.venues.reviewClaim(s.adm, claim.id, 'APPROVED');
  return { ...s, orgId: claim.venue.id };
}

test('pedido de organização: dados obrigatórios, nasce sem dono e fora da busca até o admin aprovar', async () => {
  const { w, pres, ana, adm, request } = await setup();
  await rejectsWith(w.core.venues.requestOrganization(pres, { ...request, name: '' }), 'VALIDATION');
  await rejectsWith(w.core.venues.requestOrganization(pres, { ...request, campus: undefined }), 'VALIDATION');
  await rejectsWith(w.core.venues.requestOrganization(pres, { ...request, lat: undefined }), 'VALIDATION');
  await rejectsWith(w.core.venues.requestOrganization(pres, { ...request, document: undefined }), 'VALIDATION');

  const claim = await w.core.venues.requestOrganization(pres, request);
  assert.equal(claim.status, 'PENDING');
  assert.equal(claim.venue.organization, true);
  assert.equal(claim.venue.category, 'Bateria');
  assert.equal(claim.venue.address, 'UFMG - Campus Pampulha');
  assert.deepEqual(await w.core.venues.searchClaimable(ana, 'furiosa'), [], 'organização sem dono não aparece na busca');

  await w.core.venues.reviewClaim(adm, claim.id, 'APPROVED');
  const page = await w.core.venues.profile(ana, claim.venue.id);
  assert.equal(page.organization, true);
  assert.equal(page.claimed, true);
  assert.equal((await w.core.venues.profile(pres, claim.venue.id)).isOwner, true);
  assert.equal((await w.core.venues.searchClaimable(ana, 'furiosa'))[0]?.state, 'TAKEN', 'aprovada, aparece na busca');
  const note = (await w.notifications.listForUser(pres, 10)).find((n) => n.type === 'VENUE_CLAIM');
  assert.match(note?.body ?? '', /sininho/);
});

test('sininho: ligar já segue, desligar mantém seguindo, deixar de seguir apaga o sininho', async () => {
  const { w, ana, orgId } = await approvedOrganization();
  assert.equal((await w.core.venues.profile(ana, orgId)).notify, false);
  await rejectsWith(w.core.venues.setNotify(ana, orgId, 'sim'), 'VALIDATION');
  await rejectsWith(w.core.venues.setNotify(ana, 'nao-existe', true), 'NOT_FOUND');

  assert.deepEqual(await w.core.venues.setNotify(ana, orgId, true), { following: true, notify: true, followerCount: 2 });
  assert.equal((await w.core.venues.profile(ana, orgId)).notify, true);
  assert.deepEqual(await w.core.venues.setNotify(ana, orgId, false), { following: true, notify: false, followerCount: 2 });

  await w.core.venues.setNotify(ana, orgId, true);
  await w.core.venues.unfollow(ana, orgId);
  const again = await w.core.venues.follow(ana, orgId);
  assert.equal(again.notify, false, 'seguir de novo começa com o sininho desligado');
});

test('evento novo avisa só quem ligou o sininho (e nunca quem criou)', async () => {
  const { w, pres, ana, bia, orgId, start } = await approvedOrganization();
  await w.core.venues.setNotify(ana, orgId, true);
  await w.core.venues.follow(bia, orgId); // segue, mas sem sininho
  await w.core.venues.setNotify(pres, orgId, true);

  const event = await w.core.venues.createEvent(pres, orgId, { title: 'Ensaio aberto', kind: 'SHOW', startsAt: start() });

  const anaNotes = (await w.notifications.listForUser(ana, 10)).filter((n) => n.type === 'VENUE_EVENT');
  assert.equal(anaNotes.length, 1);
  assert.equal(anaNotes[0]?.url, `/eventos/${event.id}`);
  assert.match(anaNotes[0]?.title ?? '', /Bateria Furiosa tem evento novo/);
  assert.match(anaNotes[0]?.body ?? '', /Ensaio aberto/);
  assert.equal((await w.notifications.listForUser(bia, 10)).filter((n) => n.type === 'VENUE_EVENT').length, 0, 'sem sininho, sem aviso');
  assert.equal((await w.notifications.listForUser(pres, 10)).filter((n) => n.type === 'VENUE_EVENT').length, 0, 'quem criou não recebe');

  await w.core.venues.setNotify(ana, orgId, false);
  await w.core.venues.createEvent(pres, orgId, { title: 'Calourada', kind: 'NIGHT', startsAt: start() });
  assert.equal((await w.notifications.listForUser(ana, 10)).filter((n) => n.type === 'VENUE_EVENT').length, 1, 'desligou, parou de receber');
});

test('o sininho também vale para estabelecimentos comuns', async () => {
  const { w, pres, ana, adm, start } = await setup();
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: -23.58, lng: -46.65, isSample: false });
  const claim = await w.core.venues.requestClaim(pres, 'v1', { document: JPEG() });
  await w.core.venues.reviewClaim(adm, claim.id, 'APPROVED');
  await w.core.venues.setNotify(ana, 'v1', true);
  await w.core.venues.createEvent(pres, 'v1', { title: 'Samba', kind: 'SHOW', startsAt: start() });
  assert.equal((await w.notifications.listForUser(ana, 10)).filter((n) => n.type === 'VENUE_EVENT').length, 1);
});
