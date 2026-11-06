import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const JPEG = (n = 10) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'duda');
  const ana = u['ana']!, bia = u['bia']!, caio = u['caio']!, duda = u['duda']!;
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, ana);
  await w.core.follows.follow(caio, ana);
  await w.core.follows.follow(ana, caio);
  await w.places.createVenue({ id: 'v1', name: 'Parque Ibirapuera', address: 'Av. Pedro Álvares Cabral', category: 'park', lat: -23.58, lng: -46.65, isSample: true });
  await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Piquenique', description: 'Traga uma manta', kind: 'OUTDOOR', isFree: true, imageUrl: 'https://img.exemplo/capa.jpg', tags: ['parque'], startsAt: new Date(w.clock.now().getTime() + 2 * H), endsAt: new Date(w.clock.now().getTime() + 4 * H), isSample: true });
  const start = new Date(w.clock.now().getTime() + 24 * H).toISOString();
  const ev = await w.core.posts.create(ana, { images: [JPEG()], caption: 'Vem!', placeName: 'Praça Roosevelt', placeAddress: 'Centro', event: { title: 'Corrida', startsAt: start, kind: 'SPORT' } });
  return { w, ana, bia, caio, duda, ev };
}

test('tipo do evento criado: padrão OTHER, SPORT quando informado, inválido é recusado e a edição mantém', async () => {
  const { w, ana, ev } = await setup();
  assert.equal(ev.event?.kind, 'SPORT');
  const start = new Date(w.clock.now().getTime() + 24 * H).toISOString();
  const plain = await w.core.posts.create(ana, { images: [JPEG()], placeName: 'Bar', event: { title: 'Sem tipo', startsAt: start } });
  assert.equal(plain.event?.kind, 'OTHER');
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG()], placeName: 'Bar', event: { title: 'X', startsAt: start, kind: 'NADA' } }), 'VALIDATION');
  const kept = await w.core.posts.update(ana, ev.id, { caption: 'novo texto' });
  assert.equal(kept.event?.kind, 'SPORT', 'editar só o texto mantém o tipo');
  const changed = await w.core.posts.update(ana, ev.id, { event: { title: 'Corrida', startsAt: ev.event!.startsAt, kind: 'OUTDOOR' } });
  assert.equal(changed.event?.kind, 'OUTDOOR');
});

test('evento do local: capa, tipo e confirmados', async () => {
  const { w, ana, bia } = await setup();
  const page = await w.core.eventPages.get(ana, 'e1', { lat: -23.58, lng: -46.65 });
  assert.deepEqual([page.source, page.kind, page.cover, page.venue.name, page.distanceM, page.sample], ['PLACE', 'OUTDOOR', { kind: 'URL', url: 'https://img.exemplo/capa.jpg' }, 'Parque Ibirapuera', 0, true]);
  assert.equal(page.confirmedCount, 0);
  assert.equal(page.owner, null);
  const after = await w.core.eventPages.go(bia, 'e1');
  assert.deepEqual([after.going, after.confirmedCount, after.attendees.map((a) => a.username)], [true, 1, ['bia']]);
  assert.equal((await w.core.eventPages.get(ana, 'e1')).going, false);
  w.clock.tick(1000);
  await w.core.eventPages.go(ana, 'e1');
  await w.core.eventPages.go(ana, 'e1');
  assert.deepEqual((await w.core.eventPages.get(ana, 'e1')).attendees.map((a) => a.username), ['bia', 'ana'], 'em ordem, sem repetir');
  const left = await w.core.eventPages.cancel(bia, 'e1');
  assert.deepEqual([left.going, left.confirmedCount], [false, 1]);
  await rejectsWith(w.core.eventPages.get(ana, 'nao-existe'), 'NOT_FOUND');
});

test('evento de pessoa: o dono conta como confirmado, capa vem da primeira foto e não cancela', async () => {
  const { w, ana, bia, ev } = await setup();
  const page = await w.core.eventPages.get(bia, ev.id);
  assert.deepEqual([page.source, page.kind, page.title, page.description, page.venue.name, page.venue.address, page.isOwner], ['USER', 'SPORT', 'Corrida', 'Vem!', 'Praça Roosevelt', 'Centro', false]);
  assert.deepEqual(page.cover, { kind: 'UPLOAD', imageId: ev.images[0]!.id });
  assert.deepEqual([page.confirmedCount, page.attendees.map((a) => a.username), page.owner?.username, page.going], [1, ['ana'], 'ana', false]);
  const own = await w.core.eventPages.get(ana, ev.id);
  assert.deepEqual([own.isOwner, own.going], [true, true]);
  await rejectsWith(w.core.eventPages.cancel(ana, ev.id), 'FORBIDDEN');
  assert.equal((await w.core.eventPages.go(ana, ev.id)).confirmedCount, 1, 'o dono confirmar não duplica');
  assert.equal((await w.core.eventPages.go(bia, ev.id)).confirmedCount, 2);
});

test('privacidade: conta privada e bloqueio escondem o evento e quem confirmou', async () => {
  const { w, ana, bia, duda, ev } = await setup();
  await w.core.profiles.setPrivacy(ana, true);
  await rejectsWith(w.core.eventPages.get(duda, ev.id), 'NOT_FOUND');
  assert.equal((await w.core.eventPages.get(bia, ev.id)).title, 'Corrida', 'amigo vê');
  await w.core.profiles.setPrivacy(ana, false);
  await w.core.eventPages.go(bia, 'e1');
  await w.core.eventPages.go(duda, 'e1');
  await w.core.blocks.block(duda, bia);
  assert.deepEqual((await w.core.eventPages.get(duda, 'e1')).attendees.map((a) => a.username), ['duda'], 'bloqueado não aparece');
  assert.equal((await w.core.eventPages.get(duda, 'e1')).confirmedCount, 2, 'a contagem segue real');
  await w.core.blocks.block(duda, ana);
  await rejectsWith(w.core.eventPages.get(duda, ev.id), 'NOT_FOUND');
});

test('apagar o evento leva presença e feed; arquivado some para os outros', async () => {
  const { w, ana, bia, ev } = await setup();
  await w.core.eventPages.go(bia, ev.id);
  await w.core.feed.create(ana, 'event', ev.id, { body: 'oi' });
  await w.core.posts.archive(ana, ev.id);
  await rejectsWith(w.core.eventPages.get(bia, ev.id), 'NOT_FOUND');
  assert.equal((await w.core.eventPages.get(ana, ev.id)).title, 'Corrida');
  await w.core.posts.delete(ana, ev.id);
  await rejectsWith(w.core.eventPages.get(ana, ev.id), 'NOT_FOUND');
  await rejectsWith(w.core.eventPages.go(bia, ev.id), 'NOT_FOUND');
});

test('meus eventos confirmados: só os que ainda vão acontecer, do mais próximo ao mais distante', async () => {
  const { w, ana, bia, ev } = await setup();
  assert.deepEqual(await w.core.eventPages.listMyGoing(bia), [], 'sem confirmação, lista vazia');
  await w.core.eventPages.go(bia, 'e1');
  await w.core.eventPages.go(bia, ev.id);
  const mine = await w.core.eventPages.listMyGoing(bia);
  assert.equal(mine.length, 2);
  assert.ok(Date.parse(mine[0]!.startsAt) <= Date.parse(mine[1]!.startsAt), 'ordem por início');
  assert.deepEqual(mine.map((e) => e.id).sort(), ['e1', ev.id].sort());
  assert.equal(mine.find((e) => e.id === 'e1')?.venueName, 'Parque Ibirapuera');
  assert.deepEqual((await w.core.eventPages.listMyGoing(ana)).map((e) => e.id), [ev.id], 'o dono vê o evento que criou, sem confirmar presença');
  await w.core.eventPages.go(ana, ev.id);
  assert.equal((await w.core.eventPages.listMyGoing(ana)).length, 1, 'dono que também confirma não duplica');
  await w.core.eventPages.cancel(bia, 'e1');
  assert.deepEqual((await w.core.eventPages.listMyGoing(bia)).map((e) => e.id), [ev.id], 'cancelar tira da lista');
  await w.core.posts.archive(ana, ev.id);
  assert.deepEqual(await w.core.eventPages.listMyGoing(ana), [], 'evento arquivado sai da lista do dono');
  w.clock.tick(400 * 24 * H);
  assert.deepEqual(await w.core.eventPages.listMyGoing(bia), [], 'evento que já acabou sai da lista');
});

const JPG_BYTES = (n = 20) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(n).fill(1)]);
const MP4_BYTES = (n = 40) => new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, ...new Array(n).fill(2)]);

test('story de evento: só quem confirmou presença publica; foto ou vídeo; página mostra quem tem story', async () => {
  const { w, ana, bia, caio } = await setup();
  await rejectsWith(w.core.eventPages.createStory(bia, 'e1', 'image/jpeg', JPG_BYTES()), 'FORBIDDEN');
  assert.equal((await w.core.eventPages.get(bia, 'e1')).canStory, false);
  await w.core.eventPages.go(bia, 'e1');
  await w.core.eventPages.go(caio, 'e1');
  assert.equal((await w.core.eventPages.get(bia, 'e1')).canStory, true);
  const photo = await w.core.eventPages.createStory(bia, 'e1', 'image/jpeg', JPG_BYTES());
  assert.equal(photo.items[0]!.kind, 'IMAGE');
  w.clock.tick(1000);
  await w.core.eventPages.createStory(bia, 'e1', 'video/mp4', MP4_BYTES());
  w.clock.tick(1000);
  await w.core.eventPages.createStory(caio, 'e1', 'image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
  await rejectsWith(w.core.eventPages.createStory(bia, 'e1', 'application/pdf', JPG_BYTES()), 'VALIDATION');
  await rejectsWith(w.core.eventPages.createStory(bia, 'e1', 'image/jpeg', new Uint8Array([1, 2, 3])), 'VALIDATION');
  await rejectsWith(w.core.eventPages.createStory(bia, 'e1', 'image/jpeg', new Uint8Array(0)), 'VALIDATION');
  const groups = await w.core.eventPages.stories(bia, 'e1');
  assert.deepEqual(groups.map((g) => [g.author.username, g.mine, g.items.map((i) => i.kind)]), [['bia', true, ['IMAGE', 'VIDEO']], ['caio', false, ['IMAGE']]], 'os seus primeiro; fotos e vídeos em ordem');
  assert.deepEqual((await w.core.eventPages.stories(ana, 'e1')).map((g) => g.author.username), ['caio', 'bia'], 'quem postou por último vem antes');
  assert.deepEqual([...(await w.core.eventPages.get(ana, 'e1')).storyUserIds].sort(), [bia, caio].sort());
  const media = await w.core.eventPages.storyMedia(photo.items[0]!.id);
  assert.equal(media?.mime, 'image/jpeg');
});

test('story de evento: 24 h ou o fim do evento, o que vier primeiro, e some com o evento', async () => {
  const { w, ana, bia, ev } = await setup();
  await w.core.eventPages.go(bia, 'e1');
  await w.core.eventPages.go(bia, ev.id);
  const short = await w.core.eventPages.createStory(bia, 'e1', 'image/jpeg', JPG_BYTES());
  const long = await w.core.eventPages.createStory(bia, ev.id, 'image/jpeg', JPG_BYTES());
  assert.equal(Date.parse(short.items[0]!.expiresAt) - w.clock.now().getTime(), 4 * H, 'o evento acaba em 4 h: o story acaba junto');
  assert.equal(Date.parse(long.items[0]!.expiresAt) - w.clock.now().getTime(), 24 * H, 'evento longe: vale 24 h');
  w.clock.tick(5 * H);
  assert.deepEqual(await w.core.eventPages.stories(ana, 'e1'), []);
  assert.equal(await w.core.eventPages.storyMedia(short.items[0]!.id), undefined, 'a mídia também sai do ar');
  assert.equal((await w.core.eventPages.get(ana, 'e1')).storyUserIds.length, 0);
  assert.equal((await w.core.eventPages.stories(ana, ev.id)).length, 1);
  await w.core.posts.delete(ana, ev.id);
  assert.equal(await w.core.eventPages.storyMedia(long.items[0]!.id), undefined, 'apagou o evento, o story vai junto');
  await rejectsWith(w.core.eventPages.stories(ana, ev.id), 'NOT_FOUND');
});

test('story de evento: depois do fim não publica; apagar é do autor ou do dono; bloqueio esconde; limite por pessoa', async () => {
  const { w, ana, bia, caio, ev } = await setup();
  await w.core.eventPages.go(bia, ev.id);
  await w.core.eventPages.go(caio, ev.id);
  const mine = await w.core.eventPages.createStory(bia, ev.id, 'image/jpeg', JPG_BYTES());
  await rejectsWith(w.core.eventPages.deleteStory(caio, ev.id, mine.items[0]!.id), 'FORBIDDEN');
  await rejectsWith(w.core.eventPages.deleteStory(bia, ev.id, 'nao-existe'), 'NOT_FOUND');
  await w.core.eventPages.deleteStory(ana, ev.id, mine.items[0]!.id); // dono do evento
  assert.deepEqual(await w.core.eventPages.stories(ana, ev.id), []);
  const second = await w.core.eventPages.createStory(bia, ev.id, 'image/jpeg', JPG_BYTES());
  await w.core.eventPages.deleteStory(bia, ev.id, second.items[0]!.id); // o próprio autor
  for (let i = 0; i < 10; i += 1) await w.core.eventPages.createStory(caio, ev.id, 'image/jpeg', JPG_BYTES());
  await rejectsWith(w.core.eventPages.createStory(caio, ev.id, 'image/jpeg', JPG_BYTES()), 'VALIDATION');
  assert.equal((await w.core.eventPages.stories(ana, ev.id))[0]!.items.length, 10);
  await w.core.blocks.block(ana, caio);
  assert.deepEqual(await w.core.eventPages.stories(ana, ev.id), [], 'quem tem bloqueio não aparece');
  w.clock.tick(40 * H);
  await rejectsWith(w.core.eventPages.createStory(bia, ev.id, 'image/jpeg', JPG_BYTES()), 'FORBIDDEN');
});

test('denunciar story: uma vez por pessoa, não o próprio, e quem denunciou deixa de vê-lo', async () => {
  const { w, ana, bia, caio } = await setup();
  await w.core.eventPages.go(bia, 'e1');
  await w.core.eventPages.go(caio, 'e1');
  const story = await w.core.eventPages.createStory(bia, 'e1', 'image/jpeg', JPG_BYTES());
  const id = story.items[0]!.id;
  await rejectsWith(w.core.eventPages.reportStory(bia, 'e1', id, 'SPAM'), 'FORBIDDEN');
  await rejectsWith(w.core.eventPages.reportStory(caio, 'e1', id, 'NADA'), 'VALIDATION');
  await rejectsWith(w.core.eventPages.reportStory(caio, 'e1', id, 'SPAM', 'x'.repeat(301)), 'VALIDATION');
  await rejectsWith(w.core.eventPages.reportStory(caio, 'e1', 'nao-existe', 'SPAM'), 'NOT_FOUND');
  assert.deepEqual(await w.core.eventPages.reportStory(caio, 'e1', id, 'OFFENSIVE', '  ofensivo  '), { reported: true });
  assert.deepEqual(await w.core.eventPages.reportStory(caio, 'e1', id, 'OFFENSIVE'), { reported: true }, 'denunciar de novo não dá erro nem duplica');
  assert.equal(w.eventRoom.storyReports.size, 1);
  assert.deepEqual(await w.core.eventPages.stories(caio, 'e1'), [], 'quem denunciou não vê mais');
  assert.deepEqual((await w.core.eventPages.get(caio, 'e1')).storyUserIds, []);
  assert.equal((await w.core.eventPages.stories(ana, 'e1')).length, 1, 'os outros continuam vendo');
  await w.core.eventPages.deleteStory(bia, 'e1', id);
  assert.equal(w.eventRoom.storyReports.size, 0, 'apagou o story, a denúncia some junto (como o cascade do banco)');
});

test('story também no perfil: aparece na página inicial dos amigos; sem a opção, fica só no evento', async () => {
  const { w, ana, bia, caio, duda } = await setup();
  for (const who of [ana, bia, caio, duda]) await w.core.eventPages.go(who, 'e1');
  const shared = await w.core.eventPages.createStory(bia, 'e1', 'image/jpeg', JPG_BYTES(), true);
  w.clock.tick(1000);
  await w.core.eventPages.createStory(bia, 'e1', 'image/jpeg', JPG_BYTES());
  w.clock.tick(1000);
  await w.core.eventPages.createStory(duda, 'e1', 'image/jpeg', JPG_BYTES(), true);
  assert.equal((await w.core.eventPages.stories(caio, 'e1')).flatMap((g) => g.items).length, 3, 'no evento, todos aparecem como antes');

  const forAna = await w.core.eventPages.profileStories(ana);
  assert.deepEqual(forAna.map((g) => [g.author.username, g.mine, g.items.map((i) => i.id)]), [['bia', false, [shared.items[0]!.id]]], 'amiga: só o story publicado no perfil; duda não é amiga');
  const where = forAna[0]!.items[0]!.event!;
  assert.deepEqual([where.id, where.title, where.place, where.kind, where.confirmedCount, where.going, where.cover], ['e1', 'Piquenique', 'Parque Ibirapuera', 'OUTDOOR', 4, true, { kind: 'URL', url: 'https://img.exemplo/capa.jpg' }], 'mostra onde a pessoa está');
  assert.equal(forAna[0]!.items[0]!.canDelete, false);
  assert.deepEqual(await w.core.eventPages.profileStories(caio), [], 'caio e bia não são amigos');
  const own = await w.core.eventPages.profileStories(bia);
  assert.deepEqual(own.map((g) => [g.author.username, g.mine, g.items[0]!.canDelete]), [['bia', true, true]], 'a própria pessoa vê o seu');

  await rejectsWith(w.core.eventPages.reportProfileStory(caio, shared.items[0]!.id, 'SPAM'), 'NOT_FOUND');
  await rejectsWith(w.core.eventPages.deleteProfileStory(ana, shared.items[0]!.id), 'FORBIDDEN');
  assert.deepEqual(await w.core.eventPages.reportProfileStory(ana, shared.items[0]!.id, 'SPAM'), { reported: true });
  assert.deepEqual(await w.core.eventPages.profileStories(ana), [], 'quem denunciou não vê mais');

  await w.core.blocks.block(bia, ana);
  assert.deepEqual(await w.core.eventPages.profileStories(ana), []);
  await w.core.eventPages.deleteProfileStory(bia, shared.items[0]!.id);
  assert.deepEqual(await w.core.eventPages.profileStories(bia), [], 'apagado some da página inicial');
  assert.equal((await w.core.eventPages.stories(bia, 'e1')).find((g) => g.mine)?.items.length, 1, 'e do evento também');
  w.clock.tick(25 * H);
  assert.deepEqual(await w.core.eventPages.profileStories(duda), [], 'depois de 24 h some');
});

test('ocultar stories entre amigos: não ver os dela e não deixar ela ver os meus, na página inicial e no evento', async () => {
  const { w, ana, bia, caio } = await setup();
  for (const who of [ana, bia, caio]) await w.core.eventPages.go(who, 'e1');
  const fromBia = await w.core.eventPages.createStory(bia, 'e1', 'image/jpeg', JPG_BYTES(), true);
  w.clock.tick(1000);
  await w.core.eventPages.createStory(ana, 'e1', 'image/jpeg', JPG_BYTES(), true);
  const storiesOf = async (viewer: string) => (await w.core.eventPages.profileStories(viewer)).map((g) => g.author.username);
  const inEvent = async (viewer: string) => (await w.core.eventPages.stories(viewer, 'e1')).map((g) => g.author.username).sort();
  assert.deepEqual(await storiesOf(ana), ['ana', 'bia']);
  assert.deepEqual(await w.core.eventPages.storyVisibility(ana, bia), { hideTheirs: false, hideMine: false });

  // ana deixa de ver os stories da bia; a bia continua vendo os da ana
  assert.deepEqual(await w.core.eventPages.setStoryVisibility(ana, bia, { hideTheirs: true }), { hideTheirs: true, hideMine: false });
  assert.deepEqual(await storiesOf(ana), ['ana']);
  assert.deepEqual(await inEvent(ana), ['ana'],'no evento também some');
  assert.deepEqual(await storiesOf(bia), ['bia', 'ana']);
  assert.ok(!(await w.core.eventPages.get(ana, 'e1')).storyUserIds.includes(bia), 'sem o círculo no avatar');
  await rejectsWith(w.core.eventPages.reportProfileStory(ana, fromBia.items[0]!.id, 'SPAM'), 'NOT_FOUND');

  // ana esconde os dela da caio; a bia não é afetada
  await w.core.eventPages.setStoryVisibility(ana, caio, { hideMine: true });
  assert.deepEqual(await storiesOf(caio), []);
  assert.deepEqual(await inEvent(caio), ['bia'], 'no evento, só a ana some para a caio');
  assert.deepEqual(await w.core.eventPages.storyVisibility(caio, ana), { hideTheirs: false, hideMine: false }, 'quem foi ocultado não vê a escolha');
  assert.deepEqual(await w.core.eventPages.storyVisibility(ana, caio), { hideTheirs: false, hideMine: true });

  // só o que vem no pedido muda; desligar tudo volta ao normal
  assert.deepEqual(await w.core.eventPages.setStoryVisibility(ana, bia, { hideMine: true }), { hideTheirs: true, hideMine: true });
  assert.deepEqual(await storiesOf(bia), ['bia']);
  await w.core.eventPages.setStoryVisibility(ana, bia, { hideTheirs: false, hideMine: false });
  assert.deepEqual(await storiesOf(ana), ['ana', 'bia']);
  assert.deepEqual(await storiesOf(bia), ['bia', 'ana']);

  await rejectsWith(w.core.eventPages.setStoryVisibility(ana, ana, { hideMine: true }), 'VALIDATION');
  await rejectsWith(w.core.eventPages.setStoryVisibility(ana, bia, { hideMine: 'sim' }), 'VALIDATION');
  await rejectsWith(w.core.eventPages.setStoryVisibility(ana, '00000000-0000-4000-8000-000000000000', { hideMine: true }), 'NOT_FOUND');
});
