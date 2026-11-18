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
  // ana e bia são amigas; caio está no grupo com elas; duda não conhece ninguém.
  for (const [a, b] of [[ana, bia], [ana, caio], [bia, caio]] as const) {
    await w.core.follows.follow(a, b);
    await w.core.follows.follow(b, a);
  }
  await w.places.createVenue({ id: 'v1', name: 'Parque', address: 'Av.', category: 'park', lat: -23.58, lng: -46.65, isSample: true });
  const at = (h: number) => new Date(w.clock.now().getTime() + h * H);
  await w.places.createEvent({ id: 'show', venueId: 'v1', title: 'Show', description: null, kind: 'OUTDOOR', isFree: true, imageUrl: null, tags: [], startsAt: at(2), endsAt: at(4), isSample: true });
  await w.places.createEvent({ id: 'futuro', venueId: 'v1', title: 'Futuro', description: null, kind: 'OUTDOOR', isFree: true, imageUrl: null, tags: [], startsAt: at(200), endsAt: at(202), isSample: true });
  const make = (priv: boolean, title: string) => w.core.posts.create(ana, { images: [JPEG], placeName: 'Praça', event: { title, startsAt: at(5).toISOString(), private: priv } });
  const aberto = await make(false, 'Corrida');
  const secreto = await make(true, 'Festa secreta');
  // bia vai a tudo: show do local, evento aberto e o privado da ana (recebido no grupo), e no futuro.
  const group = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, group.id, { eventId: secreto.id });
  for (const id of ['show', 'futuro', aberto.id, secreto.id]) await w.core.eventPages.go(bia, id);
  w.clock.tick(30 * H); // tudo acabou, menos o "futuro"
  return { w, ana, bia, caio, duda, aberto, secreto, group };
}

const titles = (page: { items: { title: string }[] }) => page.items.map((e) => e.title).sort();

test('a dona sempre vê os eventos que já participou, sem os que ainda não acabaram', async () => {
  const { w, bia } = await setup();
  const page = await w.core.eventPages.listAttended(bia, 'bia');
  assert.deepEqual(titles(page), ['Corrida', 'Festa secreta', 'Show']);
  assert.equal(page.total, 3);
});

test('eventos criados pela pessoa também contam como participação', async () => {
  const { w, ana } = await setup();
  assert.deepEqual(titles(await w.core.eventPages.listAttended(ana, 'ana')), ['Corrida', 'Festa secreta']);
});

test('aba privada (padrão): só a dona vê', async () => {
  const { w, bia, ana, duda } = await setup();
  await rejectsWith(w.core.eventPages.listAttended(ana, 'bia'), 'FORBIDDEN');
  await rejectsWith(w.core.eventPages.listAttended(duda, 'bia'), 'FORBIDDEN');
  assert.equal((await w.core.profiles.getByUsername(ana, 'bia')).profile.attendedEventsPublic ?? false, false);
});

test('aba pública: evento público aparece para todos e o privado só para quem tem acesso a ele', async () => {
  const { w, bia, ana, caio, duda } = await setup();
  assert.deepEqual(await w.core.profiles.setAttendedVisibility(bia, true), { attendedEventsPublic: true });
  assert.equal((await w.core.profiles.getByUsername(duda, 'bia')).profile.attendedEventsPublic, true);
  assert.deepEqual(titles(await w.core.eventPages.listAttended(ana, 'bia')), ['Corrida', 'Festa secreta', 'Show'], 'a dona do evento privado vê');
  assert.deepEqual(titles(await w.core.eventPages.listAttended(caio, 'bia')), ['Corrida', 'Show'], 'amigo sem acesso ao privado não vê o privado');
  assert.deepEqual(titles(await w.core.eventPages.listAttended(duda, 'bia')), ['Corrida', 'Show'], 'evento aberto de perfil público aparece');
  await w.core.profiles.setAttendedVisibility(bia, false);
  await rejectsWith(w.core.eventPages.listAttended(caio, 'bia'), 'FORBIDDEN');
  await rejectsWith(w.core.profiles.setAttendedVisibility(bia, 'sim'), 'VALIDATION');
});

test('aba pública em conta privada: quem não segue não vê; bloqueio esconde', async () => {
  const { w, bia, caio, duda, ana } = await setup();
  await w.core.profiles.setAttendedVisibility(bia, true);
  await w.core.profiles.setPrivacy(bia, true);
  await rejectsWith(w.core.eventPages.listAttended(duda, 'bia'), 'FORBIDDEN');
  assert.deepEqual(titles(await w.core.eventPages.listAttended(caio, 'bia')), ['Corrida', 'Show']);
  await w.core.profiles.setPrivacy(bia, false);
  await w.core.blocks.block(duda, ana);
  assert.deepEqual(titles(await w.core.eventPages.listAttended(duda, 'bia')), ['Show'], 'evento de quem tem bloqueio com o visitante some');
});

test('paginação', async () => {
  const { w, bia } = await setup();
  const first = await w.core.eventPages.listAttended(bia, 'bia', { limit: 2, offset: 0 });
  const rest = await w.core.eventPages.listAttended(bia, 'bia', { limit: 2, offset: 2 });
  assert.equal(first.items.length, 2);
  assert.equal(rest.items.length, 1);
  assert.equal(first.total, 3);
});
