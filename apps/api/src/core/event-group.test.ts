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

test('grupo do evento: quem criou cria pela página; convidado só entra quando aceita; quem está no grupo acessa pela página', async () => {
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
  assert.equal((await w.core.eventPages.get(bia, post.id)).group, null, 'convidada que não respondeu não entra');
  assert.deepEqual(await w.conversations.participantIds(created.id), [ana]);

  // Aceitou ("Eu vou"): entra sozinha no grupo, com aviso no grupo.
  await w.core.eventPages.go(bia, post.id);
  assert.deepEqual((await w.core.eventPages.get(bia, post.id)).group, { conversationId: created.id, name: 'Aniversário' }, 'aceitou: entra e vê o grupo');
  assert.ok((await w.core.conversations.messages(ana, created.id)).messages.some((m) => /entrou no grupo/.test(m.body ?? '')));
  // Confirmar de novo não muda nada.
  await w.core.eventPages.go(bia, post.id);
  assert.deepEqual((await w.conversations.participantIds(created.id))?.sort(), [ana, bia].sort());

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

test('grupo do evento: em evento público, quem marca "Eu vou" sozinho também entra; desmarcando, sai', async () => {
  const { w, ana, bia, caio, zeca } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG], caption: 'Bora', event: { title: 'Show', startsAt: '2026-12-20T20:00:00.000Z', endsAt: '2026-12-20T23:00:00.000Z' } });
  // zeca (não é amigo nem convidado) confirma presença num evento público antes de o grupo existir.
  await w.core.follows.follow(zeca, ana);
  await w.core.eventPages.go(zeca, post.id, false);
  const { id } = await w.core.conversations.createEventGroup(ana, post.id);
  assert.deepEqual((await w.conversations.participantIds(id))?.sort(), [ana, zeca].sort(), 'quem já confirmou entra junto');
  assert.equal((await w.core.eventPages.get(zeca, post.id)).group?.conversationId, id);

  // Com o grupo criado, quem marca "Eu vou" entra na hora.
  await w.core.eventPages.go(bia, post.id);
  assert.ok((await w.conversations.participantIds(id))?.includes(bia));
  // Quem só vê o evento não está no grupo e não vê o atalho.
  const forCaio = await w.core.eventPages.get(caio, post.id);
  assert.equal(forCaio.group, null);
  assert.equal(forCaio.canCreateGroup, false);

  // Desmarcou "Eu vou": sai do grupo, com aviso.
  await w.core.eventPages.cancel(zeca, post.id);
  assert.equal((await w.conversations.participantIds(id))?.includes(zeca), false);
  assert.equal((await w.core.eventPages.get(zeca, post.id)).group, null);
  assert.ok((await w.core.conversations.messages(ana, id)).messages.some((m) => /não vai mais ao evento/.test(m.body ?? '')));
});

test('grupo do evento: cheio, não recebe mais ninguém (a presença continua valendo)', async () => {
  const w = makeWorld();
  const names = Array.from({ length: 18 }, (_, i) => `pessoa${i}`);
  const u = await w.signUpMany('ana', ...names);
  const ana = u['ana']!;
  const post = await w.core.posts.create(ana, { images: [JPEG], caption: 'Bora', event: { title: 'Show', startsAt: '2026-12-20T20:00:00.000Z', endsAt: '2026-12-20T23:00:00.000Z' } });
  const { id } = await w.core.conversations.createEventGroup(ana, post.id);
  for (const n of names) {
    await w.core.follows.follow(u[n]!, ana);
    await w.core.eventPages.go(u[n]!, post.id);
  }
  assert.equal((await w.conversations.participantIds(id))?.length, 16, 'para no limite do grupo');
});

test('grupo do evento: votação da data aberta depois usa o grupo que já existe', async () => {
  const { w, ana, bia } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG], caption: 'Bora', event: { title: 'Churras', dateByPoll: true } });
  const withBia = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, withBia.id, { eventId: post.id });
  const { id } = await w.core.conversations.createEventGroup(ana, post.id);
  const poll = await w.core.scheduling.create(ana, undefined, { title: 'Churras', rangeStart: '2026-12-20', rangeEnd: '2026-12-22', eventPostId: post.id });
  assert.equal(poll.conversationId, id);
  assert.ok(poll.participants.some((p) => p.profile.userId === bia), 'a convidada vota mesmo fora do grupo');
  assert.equal((await w.core.eventPages.get(bia, post.id)).group, null);
  await w.core.eventPages.go(bia, post.id);
  assert.equal((await w.core.eventPages.get(bia, post.id)).group?.conversationId, id);
});

test('grupo do evento: quem sai ou é removido do grupo sai da votação aberta, com os votos', async () => {
  const { w, ana, bia, caio } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG], caption: 'Bora', event: { title: 'Churras', dateByPoll: true } });
  const withBia = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, withBia.id, { eventId: post.id });
  await w.core.eventPages.go(bia, post.id);
  const { id } = await w.core.conversations.createEventGroup(ana, post.id);
  await w.core.conversations.addMembers(ana, id, [caio]);
  const poll = await w.core.scheduling.create(ana, undefined, { title: 'Churras', rangeStart: '2026-12-20', rangeEnd: '2026-12-22', eventPostId: post.id });
  const inPoll = async () => (await w.scheduling.listParticipants(poll.id)).map((p) => p.userId).sort();
  assert.deepEqual(await inPoll(), [ana, bia, caio].sort());
  await w.core.scheduling.vote(bia, poll.id, { dates: ['2026-12-20'], status: 'YES' });
  await w.core.conversations.leave(bia, id);
  assert.deepEqual(await inPoll(), [ana, caio].sort());
  assert.equal((await w.scheduling.listVotes(poll.id)).some((v) => v.userId === bia), false, 'os votos de quem saiu não contam');
  await w.core.conversations.removeMember(ana, id, caio);
  assert.deepEqual(await inPoll(), [ana]);
  // Volta para o grupo: volta para a votação.
  await w.core.conversations.addMembers(ana, id, [bia]);
  assert.deepEqual(await inPoll(), [ana, bia].sort());
});

test('capa do evento: só quem criou troca; sem foto, a foto enviada vira a capa', async () => {
  const { w, ana, bia } = await setup();
  const post = await w.core.posts.create(ana, { images: [JPEG, JPEG], caption: 'Bora', event: { title: 'Show', startsAt: '2026-12-20T20:00:00.000Z', endsAt: '2026-12-20T23:00:00.000Z' } });
  const before = post.images.map((i) => i.id);
  await rejectsWith(w.core.posts.setCover(bia, post.id, JPEG), 'FORBIDDEN');
  const after = await w.core.posts.setCover(ana, post.id, JPEG);
  assert.equal(after.images.length, 2);
  assert.notEqual(after.images[0]!.id, before[0], 'a capa é outra (endereço novo)');
  assert.equal(after.images[1]!.id, before[1], 'as outras fotos ficam');
  const bare = await w.core.posts.create(ana, { images: [], caption: 'Sem capa', event: { title: 'Jantar', startsAt: '2026-12-20T20:00:00.000Z', endsAt: '2026-12-20T23:00:00.000Z' } });
  assert.equal((await w.core.posts.setCover(ana, bare.id, JPEG)).images.length, 1);
  await rejectsWith(w.core.posts.setCover(ana, bare.id, 'data:text/plain;base64,AAAA'), 'VALIDATION');
});
