import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';
import { VENUE_STORY_HOURS, VENUE_STORY_MAX_LIVE, VENUE_STORY_SUSPEND_REPORTERS } from './venue-story.ts';

const HOUR = 3_600_000;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(10).fill(1)]);

/** Dono verificado de dois locais (um café e um bar); Ana segue os dois, Bia é amiga de Ana, Mia é uma conta antiga de menor. */
async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('dono', 'ana', 'bia', 'caio', 'dani', 'eva');
  const mia = await w.signUp('mia', { minor: true });
  const [dono, ana, bia, caio, dani, eva] = [u['dono']!, u['ana']!, u['bia']!, u['caio']!, u['dani']!, u['eva']!];
  await w.places.createVenue({ id: 'cafe', name: 'Café do Zé', address: 'Rua A', category: 'Café', lat: -23.55, lng: -46.63, isSample: true });
  await w.places.createVenue({ id: 'bar', name: 'Bar do Zé', address: 'Rua B', category: 'Bar', lat: -23.551, lng: -46.631, isSample: true });
  await w.places.createVenue({ id: 'livre', name: 'Praça Livre', address: null, category: 'Parque', lat: -23.552, lng: -46.632, isSample: true });
  await w.places.setVenueOwner('cafe', dono);
  await w.places.setVenueOwner('bar', dono);
  await w.places.followVenue(ana, 'cafe', w.clock.now());
  await w.places.followVenue(ana, 'bar', w.clock.now());
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, ana);
  return { w, dono, ana, bia, caio, dani, eva, mia: mia.user.id };
}

test('só o responsável publica, e só em local verificado; a mídia some em 24 h', async () => {
  const { w, dono, ana } = await setup();
  const item = await w.core.venueStories.publish(dono, 'cafe', 'image/jpeg', JPEG);
  assert.equal(item.kind, 'IMAGE');
  assert.equal(Date.parse(item.expiresAt) - Date.parse(item.createdAt), VENUE_STORY_HOURS * HOUR);
  assert.ok(await w.core.venueStories.media(item.id));
  await rejectsWith(w.core.venueStories.publish(ana, 'cafe', 'image/jpeg', JPEG), 'NOT_FOUND');
  await rejectsWith(w.core.venueStories.publish(dono, 'livre', 'image/jpeg', JPEG), 'NOT_FOUND');
  await rejectsWith(w.core.venueStories.publish(dono, 'cafe', 'text/html', JPEG), 'VALIDATION');
  w.clock.tick(VENUE_STORY_HOURS * HOUR + 1);
  assert.equal(await w.core.venueStories.media(item.id), undefined);
  assert.deepEqual(await w.core.venueStories.home(ana), []);
});

test('o responsável tem limite de stories no ar e pode apagar os seus', async () => {
  const { w, dono, ana } = await setup();
  let last = '';
  for (let i = 0; i < VENUE_STORY_MAX_LIVE; i++) last = (await w.core.venueStories.publish(dono, 'cafe', 'image/jpeg', JPEG)).id;
  await rejectsWith(w.core.venueStories.publish(dono, 'cafe', 'image/jpeg', JPEG), 'VALIDATION');
  await rejectsWith(w.core.venueStories.remove(ana, 'cafe', last), 'NOT_FOUND');
  await rejectsWith(w.core.venueStories.remove(dono, 'bar', last), 'NOT_FOUND');
  await w.core.venueStories.remove(dono, 'cafe', last);
  assert.equal((await w.core.venueStories.ownerList(dono, 'cafe')).items.length, VENUE_STORY_MAX_LIVE - 1);
  await rejectsWith(w.core.venueStories.ownerList(ana, 'cafe'), 'NOT_FOUND');
});

test('Home: quem segue o local vê os stories; quem não segue não vê', async () => {
  const { w, dono, ana, caio } = await setup();
  await w.core.venueStories.publish(dono, 'cafe', 'image/jpeg', JPEG);
  w.clock.tick(1000);
  await w.core.venueStories.publish(dono, 'bar', 'image/jpeg', JPEG);
  const groups = await w.core.venueStories.home(ana);
  assert.deepEqual(groups.map((g) => g.venue.id), ['bar', 'cafe'], 'o local com story mais novo primeiro');
  assert.equal(groups[0]?.items.length, 1);
  assert.deepEqual(await w.core.venueStories.home(caio), []);
});

test('privacidade: silenciar o local, desligar tudo e bloqueio fazem o local sumir', async () => {
  const { w, dono, ana } = await setup();
  await w.core.venueStories.publish(dono, 'cafe', 'image/jpeg', JPEG);
  await w.core.venueStories.publish(dono, 'bar', 'image/jpeg', JPEG);
  await w.core.venueStories.setMuted(ana, 'cafe', true);
  assert.deepEqual((await w.core.venueStories.home(ana)).map((g) => g.venue.id), ['bar']);
  assert.deepEqual((await w.core.venueStories.settings(ana)).mutedVenues, [{ id: 'cafe', name: 'Café do Zé' }]);
  await w.core.venueStories.setMuted(ana, 'cafe', false);
  assert.equal((await w.core.venueStories.home(ana)).length, 2);

  const off = await w.core.venueStories.setSettings(ana, { hideVenueStories: true });
  assert.equal(off.hideVenueStories, true);
  assert.deepEqual(await w.core.venueStories.home(ana), []);
  await w.core.venueStories.setSettings(ana, { hideVenueStories: false });
  assert.equal((await w.core.venueStories.home(ana)).length, 2);

  await w.core.blocks.block(ana, dono);
  assert.deepEqual(await w.core.venueStories.home(ana), [], 'local bloqueado some');
  await rejectsWith(w.core.venueStories.setSettings(ana, { hideVenueStories: 'sim' }), 'VALIDATION');
  await rejectsWith(w.core.venueStories.setMuted(ana, 'nao-existe', true), 'NOT_FOUND');
});

test('menor de idade não vê local de bebida alcoólica, mas vê os demais', async () => {
  const { w, dono, mia } = await setup();
  await w.places.followVenue(mia, 'cafe', w.clock.now());
  await w.places.followVenue(mia, 'bar', w.clock.now());
  await w.core.venueStories.publish(dono, 'cafe', 'image/jpeg', JPEG);
  await w.core.venueStories.publish(dono, 'bar', 'image/jpeg', JPEG);
  assert.deepEqual((await w.core.venueStories.home(mia)).map((g) => g.venue.id), ['cafe']);
});

test('denúncia: some para quem denunciou, não vale para o próprio local e o motivo é conferido', async () => {
  const { w, dono, ana, bia } = await setup();
  const item = await w.core.venueStories.publish(dono, 'cafe', 'image/jpeg', JPEG);
  await rejectsWith(w.core.venueStories.report(ana, item.id, 'NADA'), 'VALIDATION');
  await rejectsWith(w.core.venueStories.report(dono, item.id, 'SPAM'), 'FORBIDDEN');
  await rejectsWith(w.core.venueStories.report(ana, 'nao-existe', 'SPAM'), 'NOT_FOUND');
  assert.deepEqual(await w.core.venueStories.report(ana, item.id, 'SPAM', ' propaganda '), { reported: true });
  await w.core.venueStories.report(ana, item.id, 'SPAM');
  assert.deepEqual(await w.core.venueStories.home(ana), []);
  await w.places.followVenue(bia, 'cafe', w.clock.now());
  assert.equal((await w.core.venueStories.home(bia)).length, 1, 'quem não denunciou continua vendo');
  const [report] = (await w.venueStories.listReports(true, { limit: 5, offset: 0 }));
  assert.equal(report?.details, 'propaganda');
});

test('muitas denúncias de pessoas diferentes suspendem a publicação até a gestão decidir', async () => {
  const { w, dono, ana, bia, caio, dani, eva } = await setup();
  const admin = await w.signUp('gestora');
  w.users.users.set(admin.user.id, { ...w.users.users.get(admin.user.id)!, role: 'ADMIN' });
  const actor = { userId: admin.user.id, role: 'ADMIN' as const };
  const item = await w.core.venueStories.publish(dono, 'cafe', 'image/jpeg', JPEG);
  const reporters = [ana, bia, caio, dani, eva].slice(0, VENUE_STORY_SUSPEND_REPORTERS);
  for (const [i, r] of reporters.entries()) {
    assert.equal((await w.core.venueStories.ownerList(dono, 'cafe')).suspended, false, `${i} denúncias ainda não suspendem`);
    await w.core.venueStories.report(r, item.id, 'OFFENSIVE');
  }
  assert.equal((await w.core.venueStories.ownerList(dono, 'cafe')).suspended, true);
  await rejectsWith(w.core.venueStories.publish(dono, 'cafe', 'image/jpeg', JPEG), 'FORBIDDEN');
  assert.equal((await w.core.venueStories.publish(dono, 'bar', 'image/jpeg', JPEG)).kind, 'IMAGE', 'outro local não é afetado');

  await rejectsWith(w.core.venueStories.adminReports({ userId: ana, role: 'USER' }, {}), 'FORBIDDEN');
  const page = await w.core.venueStories.adminReports(actor, {});
  assert.equal(page.items.length, VENUE_STORY_SUSPEND_REPORTERS);
  assert.deepEqual([page.items[0]?.story.venueName, page.items[0]?.venueOpenReporters], ['Café do Zé', VENUE_STORY_SUSPEND_REPORTERS]);
  assert.ok(await w.core.venueStories.adminMedia(actor, item.id));
  for (const row of page.items) await w.core.venueStories.adminResolve(actor, row.id, 'DISMISSED', null);
  await rejectsWith(w.core.venueStories.adminResolve(actor, page.items[0]!.id, 'DISMISSED', null), 'CONFLICT');
  assert.equal((await w.core.venueStories.ownerList(dono, 'cafe')).suspended, false, 'denúncia decidida libera a publicação');
  assert.equal((await w.core.venueStories.adminReports(actor, { status: 'resolved' })).items.length, VENUE_STORY_SUSPEND_REPORTERS);

  await rejectsWith(w.core.venueStories.adminRemove(actor, item.id, ''), 'VALIDATION');
  await w.core.venueStories.adminRemove(actor, item.id, 'Conteúdo impróprio');
  assert.equal((await w.core.venueStories.ownerList(dono, 'cafe')).items.length, 0);
  await rejectsWith(w.core.venueStories.adminRemove(actor, item.id, 'de novo'), 'NOT_FOUND');
});

test('Rolando agora: junta stories e eventos em andamento, com amigos e interesses no topo, e respeita a privacidade', async () => {
  const { w, dono, ana, bia, mia } = await setup();
  const now = w.clock.now().getTime();
  const live = (id: string, venueId: string, tags: string[]) => ({ id, venueId, title: `Evento ${id}`, description: null, kind: 'SHOW' as const, isFree: true, imageUrl: null, tags, startsAt: new Date(now - HOUR), endsAt: new Date(now + HOUR), isSample: true });
  await w.places.createEvent(live('e-cafe', 'cafe', []));
  await w.places.createEvent(live('e-bar', 'bar', []));
  await w.places.createEvent(live('e-livre', 'livre', []));
  await w.places.createEvent({ ...live('e-futuro', 'cafe', []), startsAt: new Date(now + 5 * HOUR), endsAt: new Date(now + 6 * HOUR) });
  await w.core.venueStories.publish(dono, 'cafe', 'image/jpeg', JPEG);
  await w.core.eventPages.go(bia, 'e-bar');

  const near = { lat: -23.55123, lng: -46.63456 };
  const items = await w.core.venueStories.rollingNow(ana, near);
  assert.deepEqual(items.map((i) => i.venue.id).sort(), ['bar', 'cafe', 'livre']);
  assert.equal(items[0]?.venue.id, 'bar', 'amiga confirmada sobe');
  assert.deepEqual([items[0]?.friendsGoingCount, items[0]?.friendsGoing[0]?.userId], [1, bia]);
  const cafe = items.find((i) => i.venue.id === 'cafe')!;
  assert.deepEqual([cafe.stories.length, cafe.event?.id], [1, 'e-cafe']);
  const livre = items.find((i) => i.venue.id === 'livre')!;
  assert.deepEqual([livre.stories.length, livre.event?.id], [0, 'e-livre'], 'local sem dono não tem story, mas o evento aparece');
  assert.equal(items.every((i) => i.distanceM !== null && i.distanceM % 100 === 0), true, 'distância em passos de 100 m');
  assert.equal(await w.regions.find(ana), undefined, 'a posição não é gravada');

  await w.core.venueStories.setMuted(ana, 'bar', true);
  assert.equal((await w.core.venueStories.rollingNow(ana, near)).some((i) => i.venue.id === 'bar'), false);
  await w.core.venueStories.setSettings(ana, { hideVenueStories: true });
  assert.equal((await w.core.venueStories.rollingNow(ana, near)).find((i) => i.venue.id === 'cafe')?.stories.length, 0, 'sem stories, o evento continua');

  const mine = await w.core.venueStories.rollingNow(mia, near);
  assert.equal(mine.some((i) => i.venue.id === 'bar'), false, 'menor não vê bar');
  assert.equal(mine.some((i) => i.venue.id === 'cafe'), true);

  await w.core.blocks.block(ana, dono);
  assert.deepEqual((await w.core.venueStories.rollingNow(ana, near)).map((i) => i.venue.id), ['livre'], 'bloqueio some com os locais do responsável');

  await rejectsWith(w.core.venueStories.rollingNow(ana, { lat: 95, lng: 0 }), 'VALIDATION');
  await rejectsWith(w.core.venueStories.rollingNow(ana, { lat: 1 }), 'VALIDATION');
});
