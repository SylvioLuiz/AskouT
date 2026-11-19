import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALBUM_PHOTOS_PER_USER } from './album-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;

/** Evento do local às 14:00 UTC (11:00 em São Paulo); Bia e Caio confirmaram, Dani não. */
async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'dani');
  const ana = u['ana']!, bia = u['bia']!, caio = u['caio']!, dani = u['dani']!;
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A', category: 'bar', lat: -23.58, lng: -46.65, isSample: true });
  const t0 = w.clock.now().getTime();
  await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Noite de samba', description: null, kind: 'SHOW', isFree: true, imageUrl: null, tags: [], startsAt: new Date(t0 + 2 * HOUR), endsAt: new Date(t0 + 6 * HOUR), isSample: true });
  await w.core.eventPages.go(bia, 'e1');
  await w.core.eventPages.go(caio, 'e1');
  return { w, ana, bia, caio, dani, t0 };
}

async function openedAlbum() {
  const s = await setup();
  s.w.clock.tick(3 * HOUR);
  assert.equal(await s.w.core.albums.syncEvents(), 1);
  const [album] = await s.w.core.albums.list(s.bia);
  assert.ok(album);
  return { ...s, albumId: album.id };
}

test('evento: o álbum só abre depois que o evento começa e só para quem confirmou presença', async () => {
  const { w, bia, caio, dani } = await setup();
  assert.equal(await w.core.albums.syncEvents(), 0, 'o evento ainda não começou');
  assert.deepEqual(await w.core.albums.list(bia), []);
  w.clock.tick(3 * HOUR);
  assert.equal(await w.core.albums.syncEvents(), 1);
  assert.equal(await w.core.albums.syncEvents(), 1, 'rodar de novo não duplica');
  const albums = await w.core.albums.list(bia);
  assert.equal(albums.length, 1);
  assert.deepEqual([albums[0]?.title, albums[0]?.placeName, albums[0]?.friendCount, albums[0]?.kind], ['Noite de samba', 'Bar do Zé', 1, 'EVENT']);
  assert.equal((await w.core.albums.list(caio)).length, 1);
  assert.deepEqual(await w.core.albums.list(dani), [], 'quem não foi não vê');
  await rejectsWith(w.core.albums.get(dani, albums[0]!.id), 'NOT_FOUND');
  await rejectsWith(w.core.albums.addPhoto(dani, albums[0]!.id, JPEG), 'NOT_FOUND');
});

test('quem confirma presença depois que o evento começou também entra', async () => {
  const { w, dani } = await setup();
  w.clock.tick(3 * HOUR);
  await w.core.albums.syncEvents();
  await w.core.eventPages.go(dani, 'e1');
  await w.core.albums.syncEvents();
  assert.equal((await w.core.albums.list(dani)).length, 1);
});

test('evento de pessoa: o dono também faz parte do álbum', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  const start = new Date(w.clock.now().getTime() + 60 * MIN).toISOString();
  const ev = await w.core.posts.create(ana!, { images: [JPEG], placeName: 'Praça', event: { title: 'Corrida', startsAt: start, kind: 'SPORT' } });
  await w.core.eventPages.go(bia!, ev.id);
  w.clock.tick(2 * HOUR);
  await w.core.albums.syncEvents();
  assert.equal((await w.core.albums.list(ana!)).length, 1);
  assert.equal((await w.core.albums.list(bia!))[0]?.friendCount, 1);
});

test('fotos: quem foi envia, vê e apaga a própria; foto inválida e excesso são recusados', async () => {
  const { w, bia, caio, albumId } = await openedAlbum();
  const photo = await w.core.albums.addPhoto(bia, albumId, JPEG);
  assert.equal(photo.mine, true);
  const seen = await w.core.albums.get(caio, albumId);
  assert.equal(seen.photos.length, 1);
  assert.equal(seen.photos[0]?.mine, false);
  assert.equal(seen.photos[0]?.author.userId, bia);
  assert.equal(seen.coverPhotoId, photo.id);
  assert.equal((await w.core.albums.photoMedia(caio, albumId, photo.id)).mime, 'image/jpeg');
  await rejectsWith(w.core.albums.addPhoto(bia, albumId, 'data:text/plain;base64,AAAA'), 'VALIDATION');
  await rejectsWith(w.core.albums.deletePhoto(caio, albumId, photo.id), 'NOT_FOUND');
  await w.core.albums.deletePhoto(bia, albumId, photo.id);
  assert.equal((await w.core.albums.get(bia, albumId)).photos.length, 0);
  for (let i = 0; i < ALBUM_PHOTOS_PER_USER; i += 1) await w.core.albums.addPhoto(bia, albumId, JPEG);
  await rejectsWith(w.core.albums.addPhoto(bia, albumId, JPEG), 'VALIDATION');
  await w.core.albums.addPhoto(caio, albumId, JPEG);
});

test('bloqueio: não vê as fotos nem a presença de quem tem bloqueio, em nenhum sentido', async () => {
  const { w, bia, caio, albumId } = await openedAlbum();
  const photo = await w.core.albums.addPhoto(caio, albumId, JPEG);
  await w.core.blocks.block(bia, caio);
  const view = await w.core.albums.get(bia, albumId);
  assert.equal(view.photos.length, 0);
  assert.deepEqual(view.members.map((m) => m.userId), [bia]);
  assert.equal(view.friendCount, 0);
  await rejectsWith(w.core.albums.photoMedia(bia, albumId, photo.id), 'NOT_FOUND');
  const fromCaio = await w.core.albums.get(caio, albumId);
  assert.deepEqual(fromCaio.members.map((m) => m.userId), [caio], 'quem foi bloqueado também não vê quem bloqueou');
});

test('postar no próprio perfil: só a foto que a pessoa enviou, e o post aparece no perfil', async () => {
  const { w, bia, caio, albumId } = await openedAlbum();
  const mine = await w.core.albums.addPhoto(bia, albumId, JPEG);
  const theirs = await w.core.albums.addPhoto(caio, albumId, JPEG);
  await rejectsWith(w.core.albums.postToProfile(bia, albumId, theirs.id, 'foto do Caio'), 'NOT_FOUND');
  const post = await w.core.albums.postToProfile(bia, albumId, mine.id, 'Que noite!');
  assert.equal(post.caption, 'Que noite!');
  assert.equal(post.placeName, 'Bar do Zé');
  assert.equal(post.images.length, 1);
  assert.equal(post.author.userId, bia);
});

test('aviso do dia seguinte: uma vez, a partir das 10 h, só para quem foi, contando só os amigos sem bloqueio', async () => {
  const { w, ana, bia, caio, dani } = await openedAlbum();
  const dayNote = async (id: string) => (await w.core.notifications.list(id)).items.filter((n) => n.type === 'ALBUM_SUMMARY');
  assert.equal(await w.core.albums.sendSummaries(), 0, 'no mesmo dia, nada');
  // 14:00 UTC do dia 13 é a hora do evento (11:00 em SP); aqui são 15:00 UTC (12:00 em SP) do mesmo dia.
  w.clock.tick(18 * HOUR); // 09:00 UTC (06:00 em SP) do dia 14
  assert.equal(await w.core.albums.sendSummaries(), 0, 'antes das 10 h de SP, nada');
  w.clock.tick(4 * HOUR); // 13:00 UTC = 10:00 em SP
  assert.equal(await w.core.albums.sendSummaries(), 2);
  assert.equal(await w.core.albums.sendSummaries(), 0, 'não repete');
  const [n] = await dayNote(bia);
  assert.deepEqual([n?.title, n?.body, n?.url.startsWith('/albuns/')], ['Ontem: Bar do Zé com 1 amigo', 'Veja o álbum e adicione suas fotos', true]);
  assert.equal((await dayNote(caio)).length, 1);
  assert.equal((await dayNote(dani)).length, 0);
  assert.equal((await dayNote(ana)).length, 0);
});

test('aviso do dia seguinte: bloqueio tira o outro da conta e o texto vai no plural', async () => {
  const s = await setup();
  const { w, ana, bia, caio, dani } = s;
  await w.core.eventPages.go(dani, 'e1');
  await w.core.eventPages.go(ana, 'e1');
  w.clock.tick(3 * HOUR);
  await w.core.albums.syncEvents();
  await w.core.blocks.block(caio, dani);
  w.clock.tick(23 * HOUR); // 14:00 UTC do dia seguinte (11:00 em SP)
  assert.equal(await w.core.albums.sendSummaries(), 4);
  const title = async (id: string) => (await w.core.notifications.list(id)).items.find((n) => n.type === 'ALBUM_SUMMARY')?.title;
  assert.equal(await title(bia), 'Ontem: Bar do Zé com 3 amigos');
  assert.equal(await title(caio), 'Ontem: Bar do Zé com 2 amigos');
  assert.equal(await title(dani), 'Ontem: Bar do Zé com 2 amigos');
});

test('depois de dois dias o aviso não sai mais', async () => {
  const { w } = await openedAlbum();
  w.clock.tick(60 * HOUR);
  assert.equal(await w.core.albums.sendSummaries(), 0);
});

test('NOW: o álbum nasce quando o encontro é aceito e é só dos dois', async () => {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await w.core.follows.follow(ana!, bia!);
  await w.core.follows.follow(bia!, ana!);
  await w.core.flash.turnOn(ana!, { hours: 3 });
  await w.core.flash.turnOn(bia!, { hours: 3 });
  const invite = await w.core.flash.invite(ana!, bia!);
  assert.deepEqual(await w.core.albums.list(ana!), [], 'antes de aceitar não há álbum');
  await w.core.flash.respond(bia!, invite.id, 'accept');
  const [album] = await w.core.albums.list(ana!);
  assert.deepEqual([album?.kind, album?.friendCount], ['FLASH', 1]);
  assert.equal((await w.core.albums.list(bia!)).length, 1);
  assert.deepEqual(await w.core.albums.list(caio!), []);
  await w.core.albums.addPhoto(bia!, album!.id, JPEG);
  await rejectsWith(w.core.albums.get(caio!, album!.id), 'NOT_FOUND');
  // O convite do NOW some do banco em 24 h; o álbum continua.
  w.clock.tick(27 * HOUR);
  assert.equal((await w.core.albums.get(ana!, album!.id)).photos.length, 1);
  assert.equal(await w.core.albums.sendSummaries(), 2);
  const note = (await w.core.notifications.list(ana!)).items.find((n) => n.type === 'ALBUM_SUMMARY');
  assert.equal(note?.title, 'Ontem: um encontro do NOW com 1 amigo');
});
