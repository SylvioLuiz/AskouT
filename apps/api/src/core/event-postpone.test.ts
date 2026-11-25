import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const JPEG = (n = 10) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]).toString('base64')}`;

async function userEvent() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'duda');
  const [ana, bia, caio, duda] = [u['ana']!, u['bia']!, u['caio']!, u['duda']!];
  for (const f of [bia, caio, duda]) {
    await w.core.follows.follow(ana, f);
    await w.core.follows.follow(f, ana);
  }
  const start = new Date(w.clock.now().getTime() + 24 * H);
  const post = await w.core.posts.create(ana, { placeName: 'Praça', tagUserIds: [bia], event: { title: 'Churrasco', startsAt: start.toISOString() } });
  await w.core.posts.respondTag(bia, post.id, 'accept');
  await w.core.eventPages.go(caio, post.id);
  return { w, ana, bia, caio, duda, post, start };
}

const updates = async (w: ReturnType<typeof makeWorld>, userId: string) => (await w.notifications.listForUser(userId, 50)).filter((n) => n.type === 'EVENT_UPDATE');

test('dono adia o evento: fica adiado na página e avisa quem vai e quem aceitou', async () => {
  const { w, ana, bia, caio, duda, post } = await userEvent();
  const view = await w.core.posts.setPostponed(ana, post.id, true);
  assert.equal(view.event?.postponed, true);
  const page = await w.core.eventPages.get(caio, post.id);
  assert.equal(page.postponed, true);
  assert.equal((await updates(w, bia)).length, 1);
  assert.match((await updates(w, caio))[0]!.title, /Churrasco foi adiado/);
  assert.equal((await updates(w, ana)).length, 0, 'quem adiou não recebe');
  assert.equal((await updates(w, duda)).length, 0, 'quem não vai não recebe');
  // Marcar de novo não avisa outra vez.
  await w.core.posts.setPostponed(ana, post.id, true);
  assert.equal((await updates(w, caio)).length, 1);
  // Quem não organiza não adia.
  await rejectsWith(w.core.posts.setPostponed(caio, post.id, false), 'FORBIDDEN');
  await rejectsWith(w.core.posts.setPostponed(ana, post.id, 'sim'), 'VALIDATION');
});

test('nova data na edição tira o adiado e avisa a nova data; admin também pode', async () => {
  const { w, ana, bia, caio, post, start } = await userEvent();
  await w.core.posts.addEventAdmin(ana, post.id, bia);
  await w.core.posts.setPostponed(bia, post.id, true);
  assert.equal((await updates(w, ana)).length, 1, 'o dono fica sabendo quando um admin adia');
  w.clock.tick(1000);
  const next = new Date(start.getTime() + 7 * 24 * H);
  const edited = await w.core.posts.update(bia, post.id, { event: { title: 'Churrasco', startsAt: next.toISOString() } });
  assert.equal(edited.event?.postponed, false);
  assert.equal(edited.event?.startsAt, next.toISOString());
  const caioNotes = await updates(w, caio);
  assert.equal(caioNotes.length, 2);
  assert.ok(caioNotes.some((n) => /mudou de data/.test(n.title)));
  // Editar sem mudar a data não avisa.
  w.clock.tick(1000);
  await w.core.posts.update(ana, post.id, { caption: 'Traga bebida' });
  assert.equal((await updates(w, caio)).length, 2);
});

test('evento adiado não manda lembrete', async () => {
  const { w, ana, post, start } = await userEvent();
  const near = await w.eventRoom.listGoingStartingBetween(new Date(start.getTime() - H), start, 50);
  assert.ok(near.some((g) => g.ref.id === post.id));
  await w.core.posts.setPostponed(ana, post.id, true);
  const after = await w.eventRoom.listGoingStartingBetween(new Date(start.getTime() - H), start, 50);
  assert.ok(!after.some((g) => g.ref.id === post.id));
});

test('evento do local: quem administra adia e muda a data, e quem vai é avisado', async () => {
  const w = makeWorld();
  const u = await w.signUpMany('pres', 'ana', 'adm');
  const [pres, ana, adm] = [u['pres']!, u['ana']!, u['adm']!];
  w.users.users.set(adm, { ...w.users.users.get(adm)!, role: 'ADMIN' });
  const claim = await w.core.venues.requestOrganization(pres, { name: 'Bateria Furiosa', type: 'Bateria', campus: 'UFMG', description: 'x', lat: -19.87, lng: -43.96, document: JPEG() });
  await w.core.venues.reviewClaim(adm, claim.id, 'APPROVED');
  const venueId = claim.venue.id;
  const start = new Date(w.clock.now().getTime() + 24 * H);
  const event = await w.core.venues.createEvent(pres, venueId, { title: 'Ensaio aberto', startsAt: start.toISOString() });
  await w.core.eventPages.go(ana, event.id);

  await rejectsWith(w.core.venues.setEventPostponed(ana, venueId, event.id, true), 'NOT_FOUND');
  const postponed = await w.core.venues.setEventPostponed(pres, venueId, event.id, true);
  assert.equal(postponed.postponed, true);
  assert.equal((await w.core.eventPages.get(ana, event.id)).postponed, true);
  assert.equal((await updates(w, ana)).length, 1);

  w.clock.tick(1000);
  const next = new Date(start.getTime() + 3 * 24 * H);
  const updated = await w.core.venues.updateEvent(pres, venueId, event.id, { title: 'Ensaio aberto', startsAt: next.toISOString() });
  assert.equal(updated.postponed, false);
  assert.equal((await w.core.eventPages.get(ana, event.id)).postponed, false);
  assert.equal((await updates(w, ana)).length, 2);
});
