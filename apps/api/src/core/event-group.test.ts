import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'zeca');
  const ana = u['ana']!;
  const bia = u['bia']!;
  const caio = u['caio']!;
  const zeca = u['zeca']!;
  for (const id of [bia, caio]) {
    await w.core.follows.follow(ana, id);
    await w.core.follows.follow(id, ana);
  }
  return { w, ana, bia, caio, zeca };
}

test('grupo do evento: quem criou cria pela página, com os amigos convidados; quem está no grupo acessa pela página', async () => {
  const { w, ana, bia, caio } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG], caption: 'Bora', event: { title: 'Aniversário', startsAt: '2026-12-20T20:00:00.000Z', endsAt: '2026-12-20T23:00:00.000Z', private: true } });
  const withBia = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, withBia.id, { eventId: post.id });

  let page = await w.core.eventPages.get(ana, post.id);
  assert.equal(page.group, null);
  assert.equal(page.canCreateGroup, true, 'quem criou pode criar o grupo');
  const forBia = await w.core.eventPages.get(bia, post.id);
  assert.equal(forBia.canCreateGroup, false, 'convidado não cria');
  await rejectsWith(w.core.conversations.createEventGroup(bia, post.id), 'FORBIDDEN');

  const created = await w.core.conversations.createEventGroup(ana, post.id);
  assert.equal(created.created, true);
  page = await w.core.eventPages.get(ana, post.id);
  assert.deepEqual(page.group, { conversationId: created.id, name: 'Aniversário' });
  assert.equal(page.canCreateGroup, false);
  assert.deepEqual((await w.core.eventPages.get(bia, post.id)).group, { conversationId: created.id, name: 'Aniversário' }, 'convidada amiga entra e vê o grupo');

  // Criar de novo devolve o mesmo grupo.
  assert.deepEqual(await w.core.conversations.createEventGroup(ana, post.id), { id: created.id, created: false });

  // Quem não foi convidado não está no grupo: não vê o grupo (e o evento privado nem abre).
  await rejectsWith(w.core.eventPages.get(caio, post.id), 'NOT_FOUND');
  // Adicionado pelo grupo: passa a ver o evento e o grupo nele.
  await w.core.conversations.addMembers(ana, created.id, [caio]);
  assert.equal((await w.core.eventPages.get(caio, post.id)).group?.conversationId, created.id);
  const details = await w.core.conversations.group(ana, created.id);
  assert.equal(details.event?.id, post.id, 'o grupo sabe de que evento é');
});

test('grupo do evento: só entra amigo; quem não está no grupo não vê o atalho', async () => {
  const { w, ana, bia, zeca } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG], caption: 'Bora', event: { title: 'Show', startsAt: '2026-12-20T20:00:00.000Z', endsAt: '2026-12-20T23:00:00.000Z' } });
  // zeca (não é amigo da ana) confirma presença num evento público.
  await w.core.follows.follow(zeca, ana);
  await w.core.eventPages.go(zeca, post.id, false);
  const { id } = await w.core.conversations.createEventGroup(ana, post.id);
  assert.deepEqual(await w.conversations.participantIds(id), [ana], 'quem confirmou mas não é amigo não entra');
  const forZeca = await w.core.eventPages.get(zeca, post.id);
  assert.equal(forZeca.group, null);
  assert.equal(forZeca.canCreateGroup, false);
  void bia;
});

test('grupo do evento: votação da data aberta depois usa o grupo que já existe', async () => {
  const { w, ana, bia } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG], caption: 'Bora', event: { title: 'Churras', dateByPoll: true } });
  const withBia = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, withBia.id, { eventId: post.id });
  const { id } = await w.core.conversations.createEventGroup(ana, post.id);
  const poll = await w.core.scheduling.create(ana, undefined, { title: 'Churras', rangeStart: '2026-12-20', rangeEnd: '2026-12-22', eventPostId: post.id });
  assert.equal(poll.conversationId, id);
  assert.equal((await w.core.eventPages.get(bia, post.id)).group?.conversationId, id);
});
