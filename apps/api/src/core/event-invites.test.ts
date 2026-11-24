import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'duda');
  const [ana, bia, caio, duda] = [u['ana']!, u['bia']!, u['caio']!, u['duda']!];
  // ana é amiga de bia, caio e duda; bia é amiga de duda.
  for (const f of [bia, caio, duda]) {
    await w.core.follows.follow(ana, f);
    await w.core.follows.follow(f, ana);
  }
  await w.core.follows.follow(bia, duda);
  await w.core.follows.follow(duda, bia);
  const start = new Date(w.clock.now().getTime() + 24 * H).toISOString();
  const make = (priv: boolean, tagUserIds: string[] = []) => w.core.posts.create(ana, { placeName: 'Praça', tagUserIds, event: { title: priv ? 'Festa secreta' : 'Corrida', startsAt: start, private: priv } });
  const invitedIds = async (viewer: string, id: string) => (await w.core.eventPages.invites(viewer, id)).invites.map((i) => i.user.username).sort();
  return { w, ana, bia, caio, duda, make, invitedIds };
}

test('marcar no evento já é convidar: aparece como convidado e abre o evento privado', async () => {
  const { w, ana, bia, caio, make, invitedIds } = await setup();
  const post = await make(true, [bia]);
  assert.deepEqual(await invitedIds(ana, post.id), ['bia']);
  const invite = (await w.core.eventPages.invites(ana, post.id)).invites[0]!;
  assert.equal(invite.invitedBy?.username, 'ana');
  assert.equal(invite.tagged, true);
  // Marcada, bia abre o evento privado sem ter recebido o cartão; caio, não.
  assert.equal((await w.core.eventPages.get(bia, post.id)).title, 'Festa secreta');
  assert.equal((await w.core.posts.get(bia, post.id)).id, post.id);
  await rejectsWith(w.core.eventPages.get(caio, post.id), 'NOT_FOUND');
});

test('evento privado: convidar cria a marcação; dá para convidar mais gente depois', async () => {
  const { w, ana, bia, caio, duda, make, invitedIds } = await setup();
  const post = await make(true);
  await w.core.conversations.send(ana, (await w.core.conversations.open(ana, bia)).id, { eventId: post.id });
  assert.deepEqual(await invitedIds(ana, post.id), ['bia']);
  assert.deepEqual((await w.core.posts.get(bia, post.id)).myTag, 'PENDING', 'o convite virou marcação');

  // Convidar mais: um grupo com caio e duda (bia de novo não duplica).
  const group = await w.core.conversations.createGroup(ana, { name: 'Rolê', memberIds: [bia, caio, duda] });
  await w.core.conversations.send(ana, group.id, { eventId: post.id });
  assert.deepEqual(await invitedIds(ana, post.id), ['bia', 'caio', 'duda']);
  const tags = (await w.core.posts.get(ana, post.id)).tags.map((t) => t.user.username).sort();
  assert.deepEqual(tags, ['bia', 'caio', 'duda']);
});

test('recusar a marcação não tira o convite e convidar de novo não remarca', async () => {
  const { w, ana, bia, make } = await setup();
  const post = await make(true, [bia]);
  await w.core.posts.respondTag(bia, post.id, 'decline');
  await w.core.conversations.send(ana, (await w.core.conversations.open(ana, bia)).id, { eventId: post.id });
  const invite = (await w.core.eventPages.invites(ana, post.id)).invites[0]!;
  assert.equal(invite.tagged, false);
  assert.equal((await w.core.posts.get(bia, post.id)).myTag, 'DECLINED');
  assert.equal((await w.core.eventPages.get(bia, post.id)).title, 'Festa secreta');
});

test('evento público: convidar não marca, só registra quem convidou (o primeiro convite vale)', async () => {
  const { w, ana, bia, duda, make, invitedIds } = await setup();
  const post = await make(false);
  await w.core.conversations.send(ana, (await w.core.conversations.open(ana, bia)).id, { eventId: post.id });
  assert.equal((await w.core.posts.get(bia, post.id)).myTag, null, 'evento público não vira marcação');
  // bia encaminha para duda: duda fica como convidada por bia.
  await w.core.conversations.send(bia, (await w.core.conversations.open(bia, duda)).id, { eventId: post.id });
  const all = (await w.core.eventPages.invites(ana, post.id)).invites;
  assert.deepEqual(all.map((i) => [i.user.username, i.invitedBy?.username]), [['bia', 'ana'], ['duda', 'bia']]);
  // ana manda depois para duda: continua registrado que quem convidou foi bia.
  await w.core.conversations.send(ana, (await w.core.conversations.open(ana, duda)).id, { eventId: post.id });
  assert.equal((await w.core.eventPages.invites(ana, post.id)).invites.find((i) => i.user.username === 'duda')?.invitedBy?.username, 'bia');
  // Quem não é dono vê só quem convidou.
  assert.deepEqual(await invitedIds(bia, post.id), ['duda']);
  // O fluxo normal segue: quem recebeu marca "Eu vou".
  assert.equal((await w.core.eventPages.get(duda, post.id)).going, false);
});

test('marcados entram na votação da data de um evento sem data', async () => {
  const { w, ana, bia, caio } = await setup();
  const post = await w.core.posts.create(ana, { placeName: 'Praça', tagUserIds: [bia, caio], event: { title: 'Churrasco', dateByPoll: true } });
  assert.deepEqual((await w.core.eventPages.invites(ana, post.id)).invites.map((i) => i.user.username).sort(), ['bia', 'caio']);
});

test('editar o evento privado convida gente nova: convite, marcação e aviso, sem duplicar quem já foi convidado', async () => {
  const { w, ana, bia, caio, duda, make, invitedIds } = await setup();
  const post = await make(true, [bia]);
  const before = (await w.core.notifications.list(bia)).items.length;
  // bia já foi convidada na criação; caio e duda são novos.
  const edited = await w.core.posts.update(ana, post.id, { caption: 'Traga bebida', inviteUserIds: [bia, caio, duda] });
  assert.equal(edited.caption, 'Traga bebida');
  assert.deepEqual(await invitedIds(ana, post.id), ['bia', 'caio', 'duda']);
  const tags = (await w.core.posts.get(ana, post.id)).tags.map((t) => t.user.username).sort();
  assert.deepEqual(tags, ['bia', 'caio', 'duda']);
  // Convidados agora abrem o evento privado e recebem o aviso; bia não recebe outro.
  assert.equal((await w.core.eventPages.get(caio, post.id)).title, 'Festa secreta');
  assert.equal((await w.core.posts.get(duda, post.id)).myTag, 'PENDING');
  assert.ok((await w.core.notifications.list(caio)).items.some((n) => n.type === 'POST_TAG'));
  assert.equal((await w.core.notifications.list(bia)).items.length, before);
  // Quem convidou continua registrado como a dona.
  assert.ok((await w.core.eventPages.invites(ana, post.id)).invites.every((i) => i.invitedBy?.username === 'ana'));
});

test('convidar mais pela lista do evento: só a dona, só amigos; quem tem convite pendente não é reconvidado, quem recusou é', async () => {
  const { w, ana, bia, caio, duda, make, invitedIds } = await setup();
  const post = await make(true, [bia]);
  // Pendente: não é convidado de novo.
  assert.deepEqual((await w.core.posts.inviteToEvent(ana, post.id, [bia])).invited, []);
  await w.core.posts.respondTag(bia, post.id, 'decline');
  const status = async () => Object.fromEntries((await w.core.eventPages.invites(ana, post.id)).invites.map((i) => [i.user.username, i.status]));
  assert.deepEqual(await status(), { bia: 'DECLINED' });
  // Recusou: pode ser convidada de novo e o convite volta a ficar pendente.
  assert.deepEqual((await w.core.posts.inviteToEvent(ana, post.id, [bia, caio])).invited, [caio, bia]);
  assert.deepEqual(await invitedIds(ana, post.id), ['bia', 'caio']);
  assert.equal((await w.core.posts.get(bia, post.id)).myTag, 'PENDING');
  assert.deepEqual(await status(), { bia: 'PENDING', caio: 'PENDING' });
  assert.equal((await w.core.posts.get(ana, post.id)).edited, false, 'convidar não marca o evento como editado');
  // De novo: ninguém novo.
  assert.deepEqual((await w.core.posts.inviteToEvent(ana, post.id, [caio])).invited, []);
  // Só a dona convida por aqui, e só amigos dela.
  await rejectsWith(w.core.posts.inviteToEvent(bia, post.id, [duda]), 'FORBIDDEN');
  const eva = (await w.signUpMany('eva'))['eva']!;
  await rejectsWith(w.core.posts.inviteToEvent(ana, post.id, [eva]), 'VALIDATION');
  await rejectsWith(w.core.posts.update(ana, post.id, { inviteUserIds: [eva] }), 'VALIDATION');
  assert.deepEqual(await invitedIds(ana, post.id), ['bia', 'caio']);
});

test('cancelar convite pendente: só a dona, e quem já aceitou não sai', async () => {
  const { w, ana, bia, caio, make, invitedIds } = await setup();
  const post = await make(true, [bia, caio]);
  await w.core.posts.respondTag(caio, post.id, 'accept');
  await rejectsWith(w.core.posts.cancelInvite(bia, post.id, caio), 'FORBIDDEN');
  await rejectsWith(w.core.posts.cancelInvite(ana, post.id, caio), 'CONFLICT');
  assert.deepEqual(await w.core.posts.cancelInvite(ana, post.id, bia), { cancelled: true });
  assert.deepEqual(await invitedIds(ana, post.id), ['caio']);
  assert.equal((await w.core.posts.get(ana, post.id)).tags.some((t) => t.user.username === 'bia'), false);
  await rejectsWith(w.core.posts.cancelInvite(ana, post.id, bia), 'NOT_FOUND');
  // Cancelado, pode ser convidada de novo.
  assert.deepEqual((await w.core.posts.inviteToEvent(ana, post.id, [bia])).invited, [bia]);
});

test('cancelar convite: quem mandou o convite também cancela, e o aviso some do sino de quem foi convidado', async () => {
  const { w, ana, bia, caio, duda, make, invitedIds } = await setup();
  const post = await make(false);
  // bia encaminha o evento público da ana para duda: duda fica convidada por bia.
  await w.core.conversations.send(bia, (await w.core.conversations.open(bia, duda)).id, { eventId: post.id });
  await w.core.conversations.send(ana, (await w.core.conversations.open(ana, caio)).id, { eventId: post.id });
  // Quem não mandou o convite nem organiza não cancela.
  await rejectsWith(w.core.posts.cancelInvite(caio, post.id, duda), 'FORBIDDEN');
  await rejectsWith(w.core.posts.cancelInvite(bia, post.id, caio), 'FORBIDDEN');
  assert.deepEqual(await w.core.posts.cancelInvite(bia, post.id, duda), { cancelled: true });
  assert.deepEqual(await invitedIds(ana, post.id), ['caio']);
  // Quem já confirmou "Eu vou" não sai por aqui, e aparece como quem aceitou.
  await w.core.eventPages.go(caio, post.id);
  assert.equal((await w.core.eventPages.invites(ana, post.id)).invites[0]?.status, 'ACCEPTED');
  await rejectsWith(w.core.posts.cancelInvite(ana, post.id, caio), 'CONFLICT');
});

test('cancelar convite de evento privado tira a marcação e o aviso do sino', async () => {
  const { w, ana, bia, make } = await setup();
  const post = await make(true, [bia]);
  const tagNotes = async () => (await w.core.notifications.list(bia)).items.filter((n) => n.type === 'POST_TAG' && n.postId === post.id);
  assert.equal((await tagNotes()).length, 1);
  await w.core.posts.cancelInvite(ana, post.id, bia);
  assert.equal((await tagNotes()).length, 0, 'o aviso do convite sai do sino');
  assert.equal((await w.core.posts.pendingTags(bia)).items.length, 0);
  await rejectsWith(w.core.eventPages.get(bia, post.id), 'NOT_FOUND');
});
