import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio');
  const ana = u['ana']!, bia = u['bia']!, caio = u['caio']!;
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: -23.58, lng: -46.65, isSample: false, ownerId: ana });
  const start = () => new Date(w.clock.now().getTime() + 24 * H).toISOString();
  return { w, ana, bia, caio, start };
}

test('equipe: o convite só vale depois do aceite, e recusar apaga o convite', async () => {
  const { w, ana, bia, start } = await setup();
  const team = await w.core.venues.inviteManager(ana, 'v1', '@Bia');
  assert.deepEqual(team.members.map((m) => [m.role, m.status]), [['OWNER', 'ACCEPTED'], ['MANAGER', 'PENDING']]);
  await rejectsWith(w.core.venues.createEvent(bia, 'v1', { title: 'Noite', startsAt: start() }), 'NOT_FOUND');
  await w.core.flushNotifications();
  assert.ok((await w.notifications.listForUser(bia, 10)).some((n) => n.type === 'VENUE_TEAM'));
  const mine = await w.core.venues.mine(bia);
  assert.equal(mine.invites.length, 1);
  assert.equal(mine.invites[0]?.venue.id, 'v1');
  assert.deepEqual(mine.managed, []);
  assert.deepEqual(await w.core.venues.respondInvite(bia, 'v1', false), { accepted: false });
  assert.equal((await w.core.venues.mine(bia)).invites.length, 0);
  await rejectsWith(w.core.venues.respondInvite(bia, 'v1', true), 'NOT_FOUND');
  await w.core.venues.inviteManager(ana, 'v1', 'bia');
  assert.deepEqual(await w.core.venues.respondInvite(bia, 'v1', true), { accepted: true });
  assert.equal((await w.core.venues.mine(bia)).managed[0]?.id, 'v1');
});

test('equipe: administrador adicional cuida do dia a dia, mas não da equipe nem do impulsionar', async () => {
  const { w, ana, bia, caio, start } = await setup();
  await w.core.venues.inviteManager(ana, 'v1', 'bia');
  await w.core.venues.respondInvite(bia, 'v1', true);
  const event = await w.core.venues.createEvent(bia, 'v1', { title: 'Noite do Samba', startsAt: start() });
  await w.core.venues.updateEvent(bia, 'v1', event.id, { title: 'Samba de Quinta', startsAt: start() });
  assert.equal((await w.core.venues.panel(bia, 'v1')).events.length, 1);
  await w.core.venues.updateProfile(bia, 'v1', { name: 'Bar do Zé', description: 'Feito pela equipe' });
  const profile = await w.core.venues.profile(bia, 'v1');
  assert.equal(profile.canManage, true);
  assert.equal(profile.isOwner, false);
  assert.equal(profile.role, 'MANAGER');
  assert.equal((await w.core.venues.profile(ana, 'v1')).role, 'OWNER');
  assert.equal((await w.core.venues.profile(caio, 'v1')).canManage, false);
  await w.core.venues.deleteEvent(bia, 'v1', event.id);
  await rejectsWith(w.core.venues.rate(bia, 'v1', 5), 'FORBIDDEN');
  // equipe: só o dono mexe
  await rejectsWith(w.core.venues.inviteManager(bia, 'v1', 'caio'), 'NOT_FOUND');
  await rejectsWith(w.core.venues.removeManager(bia, 'v1', ana), 'NOT_FOUND');
  assert.equal((await w.core.venues.team(bia, 'v1')).role, 'MANAGER');
  await rejectsWith(w.core.venues.team(caio, 'v1'), 'NOT_FOUND');
  // impulsionar: só o dono
  await rejectsWith(w.core.boosts.list(bia, 'v1'), 'NOT_FOUND');
  await rejectsWith(w.core.boosts.estimate(bia, 'v1', {}), 'NOT_FOUND');
  assert.deepEqual(await w.core.boosts.list(ana, 'v1'), []);
});

test('equipe: o dono remove, a pessoa pode sair e o convite tem regras', async () => {
  const { w, ana, bia, caio } = await setup();
  await rejectsWith(w.core.venues.inviteManager(ana, 'v1', 'ana'), 'CONFLICT');
  await rejectsWith(w.core.venues.inviteManager(ana, 'v1', 'ninguem'), 'NOT_FOUND');
  await rejectsWith(w.core.venues.inviteManager(ana, 'v1', ''), 'VALIDATION');
  await w.core.venues.inviteManager(ana, 'v1', 'bia');
  await rejectsWith(w.core.venues.inviteManager(ana, 'v1', 'bia'), 'CONFLICT');
  await w.core.venues.respondInvite(bia, 'v1', true);
  await rejectsWith(w.core.venues.inviteManager(ana, 'v1', 'bia'), 'CONFLICT');
  await rejectsWith(w.core.venues.respondInvite(bia, 'v1', 'sim'), 'VALIDATION');
  const afterRemove = await w.core.venues.removeManager(ana, 'v1', bia);
  assert.deepEqual(afterRemove.members.map((m) => m.role), ['OWNER']);
  await rejectsWith(w.core.venues.removeManager(ana, 'v1', bia), 'NOT_FOUND');
  assert.equal((await w.core.venues.profile(bia, 'v1')).canManage, false);
  await w.core.venues.inviteManager(ana, 'v1', 'caio');
  await w.core.venues.respondInvite(caio, 'v1', true);
  assert.deepEqual(await w.core.venues.leaveTeam(caio, 'v1'), { left: true });
  await rejectsWith(w.core.venues.leaveTeam(caio, 'v1'), 'NOT_FOUND');
});
