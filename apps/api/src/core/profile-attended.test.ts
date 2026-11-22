import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'duda');
  const [ana, bia, caio, duda] = [u['ana']!, u['bia']!, u['caio']!, u['duda']!];
  // ana, bia e caio são amigos; duda não conhece ninguém.
  for (const [a, b] of [[ana, bia], [ana, caio], [bia, caio]] as const) {
    await w.core.follows.follow(a, b);
    await w.core.follows.follow(b, a);
  }
  await w.places.createVenue({ id: 'v1', name: 'Parque', address: 'Av.', category: 'park', lat: -23.58, lng: -46.65, isSample: true });
  const at = (h: number) => new Date(w.clock.now().getTime() + h * H);
  await w.places.createEvent({ id: 'show', venueId: 'v1', title: 'Show', description: null, kind: 'OUTDOOR', isFree: true, imageUrl: null, tags: [], startsAt: at(2), endsAt: at(4), isSample: true });
  await w.places.createEvent({ id: 'feira', venueId: 'v1', title: 'Feira', description: null, kind: 'OUTDOOR', isFree: true, imageUrl: null, tags: [], startsAt: at(6), endsAt: at(8), isSample: true });
  const make = (priv: boolean, title: string) => w.core.posts.create(ana, { images: [JPEG], placeName: 'Praça', event: { title, startsAt: at(5).toISOString(), private: priv } });
  const aberto = await make(false, 'Corrida');
  const secreto = await make(true, 'Festa secreta');
  const dm = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, dm.id, { eventId: secreto.id });
  return { w, ana, bia, caio, duda, aberto, secreto };
}

const titles = (page: { items: { title: string }[] }) => page.items.map((e) => e.title).sort();

test('"Eu vou" guarda a escolha: mostrar na aba Eventos ou só na aba Participou (padrão)', async () => {
  const { w, bia, aberto, secreto } = await setup();
  assert.equal((await w.core.eventPages.go(bia, 'show', true)).goingOnProfile, true);
  assert.equal((await w.core.eventPages.go(bia, 'feira')).goingOnProfile, false, 'sem escolha: fica fora do perfil');
  await w.core.eventPages.go(bia, aberto.id, false);
  await w.core.eventPages.go(bia, secreto.id, true);
  assert.deepEqual(titles(await w.core.eventPages.listShownGoing(bia, 'bia')), ['Festa secreta', 'Show']);
  assert.deepEqual(titles(await w.core.eventPages.listAttended(bia, 'bia')), ['Corrida', 'Feira']);
  await rejectsWith(w.core.eventPages.go(bia, 'show', 'sim'), 'VALIDATION');
});

test('a aba Participou é só da própria pessoa', async () => {
  const { w, bia, ana, duda } = await setup();
  await w.core.eventPages.go(bia, 'feira');
  await rejectsWith(w.core.eventPages.listAttended(ana, 'bia'), 'FORBIDDEN');
  await rejectsWith(w.core.eventPages.listAttended(duda, 'bia'), 'FORBIDDEN');
});

test('na aba Eventos, evento privado só aparece para quem tem acesso a ele', async () => {
  const { w, bia, ana, caio, duda, aberto, secreto } = await setup();
  for (const id of ['show', aberto.id, secreto.id]) await w.core.eventPages.go(bia, id, true);
  assert.deepEqual(titles(await w.core.eventPages.listShownGoing(ana, 'bia')), ['Corrida', 'Festa secreta', 'Show'], 'a dona do evento privado vê');
  assert.deepEqual(titles(await w.core.eventPages.listShownGoing(caio, 'bia')), ['Corrida', 'Show'], 'amigo sem convite não vê o privado');
  assert.deepEqual(titles(await w.core.eventPages.listShownGoing(duda, 'bia')), ['Corrida', 'Show']);
  await w.core.profiles.setPrivacy(bia, true);
  await rejectsWith(w.core.eventPages.listShownGoing(duda, 'bia'), 'FORBIDDEN');
  await w.core.profiles.setPrivacy(bia, false);
  await w.core.blocks.block(duda, ana);
  assert.deepEqual(titles(await w.core.eventPages.listShownGoing(duda, 'bia')), ['Show'], 'evento de quem tem bloqueio com o visitante some');
});

test('dá para mudar depois, e eventos que já acabaram continuam nas abas', async () => {
  const { w, bia, caio } = await setup();
  await w.core.eventPages.go(bia, 'show', false);
  assert.equal((await w.core.eventPages.setGoingOnProfile(bia, 'show', true)).goingOnProfile, true);
  w.clock.tick(30 * H);
  assert.deepEqual(titles(await w.core.eventPages.listShownGoing(caio, 'bia')), ['Show']);
  await w.core.eventPages.setGoingOnProfile(bia, 'show', false);
  assert.deepEqual(titles(await w.core.eventPages.listAttended(bia, 'bia')), ['Show']);
  assert.equal((await w.core.eventPages.listShownGoing(caio, 'bia')).total, 0);
  await rejectsWith(w.core.eventPages.setGoingOnProfile(bia, 'feira', true), 'CONFLICT');
});

test('confirmar de novo só troca a escolha; eventos criados pela pessoa não entram nas presenças', async () => {
  const { w, bia, ana, aberto } = await setup();
  await w.core.eventPages.go(bia, 'show', false);
  await w.core.eventPages.go(bia, 'show', true);
  assert.equal((await w.core.eventPages.listShownGoing(bia, 'bia')).total, 1);
  await w.core.eventPages.go(ana, aberto.id, true);
  assert.equal((await w.core.eventPages.listShownGoing(ana, 'ana')).total, 0);
  assert.equal((await w.core.eventPages.listAttended(ana, 'ana')).total, 0);
});

test('quem criou o evento pode tirá-lo da aba Eventos e deixar só no Participou (e trazer de volta)', async () => {
  const { w, ana, bia, aberto } = await setup();
  const eventTitles = async (viewer: string) => (await w.core.posts.listByUsername(viewer, 'ana', { kind: 'event' })).items.map((p) => p.event?.title).sort();
  assert.deepEqual(await eventTitles(bia), ['Corrida']);
  const before = (await w.core.eventPages.get(bia, aberto.id)).confirmedCount;

  await w.core.eventPages.setGoingOnProfile(ana, aberto.id, false);
  assert.deepEqual(await eventTitles(bia), [], 'some da aba Eventos para quem visita');
  assert.equal((await w.core.posts.listByUsername(ana, 'ana', { kind: 'event' })).total, 1, 'só o evento privado (que só ela vê) continua');
  assert.deepEqual(titles(await w.core.eventPages.listAttended(ana, 'ana')), ['Corrida'], 'fica no Participou');
  assert.equal((await w.core.eventPages.get(bia, aberto.id)).confirmedCount, before, 'o dono não conta duas vezes');

  await w.core.eventPages.setGoingOnProfile(ana, aberto.id, true);
  assert.deepEqual(await eventTitles(bia), ['Corrida']);
  assert.deepEqual(titles(await w.core.eventPages.listAttended(ana, 'ana')), []);
});
