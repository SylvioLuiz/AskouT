import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'dani');
  const ana = u['ana']!, bia = u['bia']!, caio = u['caio']!, dani = u['dani']!;
  for (const other of [bia, caio]) {
    await w.core.follows.follow(ana, other);
    await w.core.follows.follow(other, ana);
  }
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A', category: 'bar', lat: -23.58, lng: -46.65, isSample: true });
  const t0 = w.clock.now().getTime();
  const event = (id: string, inH: number, lenH = 3) =>
    w.places.createEvent({ id, venueId: 'v1', title: `Evento ${id}`, description: null, kind: 'NIGHT', isFree: true, imageUrl: null, tags: [], startsAt: new Date(t0 + inH * H), endsAt: new Date(t0 + (inH + lenH) * H), isSample: true });
  await event('e1', 2);
  await event('e2', 26);
  await event('e3', 50);
  return { w, ana, bia, caio, dani };
}

test('widgets: agenda pessoal por início, encontro confirmado esconde o "Eu vou" do mesmo evento', async () => {
  const { w, ana, bia } = await setup();
  await w.core.eventPages.go(ana, 'e3');
  await w.core.eventPages.go(ana, 'e1');
  const meetup = await w.core.meetups.create(ana, { eventId: 'e1', guestIds: [bia] });
  // Convite que bia ainda não aceitou não entra na agenda dela.
  const pending = await w.core.meetups.create(ana, { eventId: 'e2', guestIds: [bia] });

  const mine = await w.core.widgets.snapshot(ana);
  assert.deepEqual(mine.plans.map((p) => p.key), [`m:${meetup.id}`, `m:${pending.id}`, 'e:e3']);
  const [first] = mine.plans;
  assert.equal(first?.kind, 'MEETUP');
  assert.equal(first?.venueName, 'Bar do Zé');
  assert.equal(first?.url, `/conversas/${meetup.conversationId}`);
  assert.equal(first?.people, 1);
  assert.equal(mine.plans[2]?.url, '/eventos/e3');

  assert.deepEqual((await w.core.widgets.snapshot(bia)).plans, [], 'convite sem resposta não é plano');
  await w.core.meetups.respond(bia, meetup.id, 'accept');
  assert.deepEqual((await w.core.widgets.snapshot(bia)).plans.map((p) => p.key), [`m:${meetup.id}`]);

  w.clock.tick(6 * H);
  assert.equal((await w.core.widgets.snapshot(ana)).plans[0]?.key, `m:${pending.id}`, 'o que acabou sai');
});

test('widgets: encontro do NOW em andamento, amigos com NOW ligado e convites esperando', async () => {
  const { w, ana, bia, caio, dani } = await setup();
  const empty = await w.core.widgets.snapshot(ana);
  assert.deepEqual([empty.flash.on, empty.friendsOnNow.count, empty.matches.length, empty.pendingInvites], [false, 0, 0, 0]);

  await w.core.flash.turnOn(ana, { hours: 2 });
  await w.core.flash.turnOn(bia, { hours: 2 });
  await w.core.flash.turnOn(caio, { hours: 1 });
  await w.core.flash.turnOn(dani, { hours: 1 });
  const on = await w.core.widgets.snapshot(ana);
  assert.equal(on.flash.on, true);
  assert.ok(on.flash.expiresAt);
  assert.equal(on.friendsOnNow.count, 2, 'só amigos; quem não é amigo (dani) não aparece');
  assert.deepEqual(on.friendsOnNow.people.map((p) => p.username).sort(), ['bia', 'caio']);

  const fromCaio = await w.core.flash.invite(caio, ana);
  assert.equal((await w.core.widgets.snapshot(ana)).pendingInvites, 1);
  await w.core.flash.respond(ana, fromCaio.id, 'decline');

  const invite = await w.core.flash.invite(ana, bia);
  await w.core.flash.respond(bia, invite.id, 'accept');
  const matched = await w.core.widgets.snapshot(ana);
  assert.equal(matched.matches.length, 1);
  assert.equal(matched.matches[0]?.url, `/now/encontro/${invite.id}`);
  assert.equal(matched.matches[0]?.placeName, null);
  await w.core.flash.chooseDestination(bia, invite.id, { name: 'Bar do Zé', lat: -23.58, lng: -46.65 });
  assert.equal((await w.core.widgets.snapshot(ana)).matches[0]?.placeName, 'Bar do Zé');
  assert.equal(JSON.stringify(matched).includes('"lat"'), false, 'nunca leva posição');
});
