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
  // ana é amiga de bia e caio; duda não é de ninguém.
  for (const f of [bia, caio]) {
    await w.core.follows.follow(ana, f);
    await w.core.follows.follow(f, ana);
  }
  await w.core.follows.follow(bia, caio);
  await w.core.follows.follow(caio, bia);
  const group = await w.core.conversations.createGroup(ana, { name: 'Rolê', memberIds: [bia, caio] });
  const start = new Date(w.clock.now().getTime() + 24 * H).toISOString();
  const make = (priv: boolean) => w.core.posts.create(ana, { images: [JPEG], placeName: 'Praça', event: { title: priv ? 'Festa secreta' : 'Corrida', startsAt: start, private: priv } });
  return { w, ana, bia, caio, duda, group, make };
}

test('evento privado: some das listas, abre só por cartão e ninguém reposta', async () => {
  const { w, ana, bia, duda, group, make } = await setup();
  const post = await make(true);
  assert.equal(post.event?.private, true);
  assert.equal((await w.core.posts.listByUsername(ana, 'ana')).items.length, 1);
  assert.equal((await w.core.posts.listByUsername(bia, 'ana')).items.length, 0, 'amigo não vê na lista');
  assert.equal((await w.core.posts.feed(bia)).items.length, 0);
  await rejectsWith(w.core.eventPages.get(bia, post.id), 'NOT_FOUND');

  await w.core.conversations.send(ana, group.id, { eventId: post.id });
  const view = await w.core.eventPages.get(bia, post.id);
  assert.equal(view.isPrivate, true);
  assert.equal(view.title, 'Festa secreta');
  const chat = await w.core.conversations.messages(bia, group.id);
  const card = chat.messages.find((m) => m.kind === 'EVENT')!;
  assert.equal(card.event?.id, post.id);
  assert.equal(card.event?.venueName, 'Praça');

  await rejectsWith(w.core.profileEvents.post(bia, post.id), 'FORBIDDEN');
  await rejectsWith(w.core.eventPages.get(duda, post.id), 'NOT_FOUND');
  // quem recebeu não reencaminha
  const other = await w.core.conversations.open(bia, ana);
  await rejectsWith(w.core.conversations.send(bia, other.id, { eventId: post.id }), 'FORBIDDEN');
});

test('evento aberto: quem está no grupo reposta no próprio perfil e pode tirar', async () => {
  const { w, ana, bia, caio, group, make } = await setup();
  const post = await make(false);
  await w.core.conversations.send(ana, group.id, { eventId: post.id });
  assert.equal((await w.core.eventPages.get(bia, post.id)).postedByMe, false);
  assert.deepEqual(await w.core.profileEvents.post(bia, post.id), { posted: true });
  await w.core.profileEvents.post(bia, post.id);
  assert.equal((await w.core.eventPages.get(bia, post.id)).postedByMe, true);
  const page = await w.core.profileEvents.list(caio, 'bia');
  assert.equal(page.total, 1);
  assert.equal(page.items[0]!.title, 'Corrida');
  assert.equal(page.items[0]!.venueName, 'Praça');
  assert.equal((await w.core.profiles.getByUsername(caio, 'bia')).counts.events, 1);

  await rejectsWith(w.core.profileEvents.post(ana, post.id), 'CONFLICT');
  await w.core.profileEvents.unpost(bia, post.id);
  assert.equal((await w.core.profileEvents.list(caio, 'bia')).total, 0);
});

test('evento aberto: quem não segue o dono mas recebeu o cartão abre; sem cartão, não', async () => {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio');
  const [ana, bia, caio] = [u['ana']!, u['bia']!, u['caio']!];
  await w.core.follows.follow(bia, ana);
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, caio);
  await w.core.follows.follow(caio, bia);
  await w.core.profiles.setPrivacy(ana, true);
  const start = new Date(w.clock.now().getTime() + 24 * H).toISOString();
  const post = await w.core.posts.create(ana, { images: [JPEG], placeName: 'Praça', event: { title: 'Corrida', startsAt: start } });
  await rejectsWith(w.core.eventPages.get(caio, post.id), 'NOT_FOUND');
  const chat = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, chat.id, { eventId: post.id });
  // bia recebeu e encaminha a caio
  const fwd = await w.core.conversations.open(bia, caio);
  await w.core.conversations.send(bia, fwd.id, { eventId: post.id });
  assert.equal((await w.core.eventPages.get(caio, post.id)).title, 'Corrida');
});

test('só o dono envia evento de pessoa sem ter recebido; id inválido é recusado', async () => {
  const { w, bia, ana, make } = await setup();
  const post = await make(false);
  const chat = await w.core.conversations.open(bia, ana);
  // bia é amiga de ana (segue e é seguida): pode
  await w.core.conversations.send(bia, chat.id, { eventId: post.id });
  await rejectsWith(w.core.conversations.send(bia, chat.id, { eventId: 'nao-existe' }), 'NOT_FOUND');
});

test('evento sem lugar vale, e o cartão leva a foto de capa enviada', async () => {
  const { w, ana, bia, group } = await setup();
  const start = new Date(w.clock.now().getTime() + 24 * H).toISOString();
  const post = await w.core.posts.create(ana, { images: [JPEG], event: { title: 'Pizza em casa', startsAt: start } });
  assert.equal(post.placeName, null);
  await w.core.conversations.send(ana, group.id, { eventId: post.id });
  const card = (await w.core.conversations.messages(bia, group.id)).messages.find((m) => m.kind === 'EVENT')!.event!;
  assert.equal(card.venueName, '');
  assert.equal(card.imageUrl, `/posts/images/${post.images[0]!.id}`);
});
