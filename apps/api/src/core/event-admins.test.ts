import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'duda');
  const [ana, bia, caio, duda] = [u['ana']!, u['bia']!, u['caio']!, u['duda']!];
  // ana é amiga de bia e caio; bia é amiga de duda (ana não conhece duda).
  for (const f of [bia, caio]) {
    await w.core.follows.follow(ana, f);
    await w.core.follows.follow(f, ana);
  }
  await w.core.follows.follow(bia, duda);
  await w.core.follows.follow(duda, bia);
  const start = new Date(w.clock.now().getTime() + 24 * H).toISOString();
  // Evento privado de ana; bia e caio convidados, só bia aceitou.
  const post = await w.core.posts.create(ana, { placeName: 'Praça', tagUserIds: [bia, caio], event: { title: 'Festa secreta', startsAt: start, private: true } });
  await w.core.posts.respondTag(bia, post.id, 'accept');
  return { w, ana, bia, caio, duda, post };
}

test('o dono torna admin quem aceitou o convite; quem não aceitou não pode', async () => {
  const { w, ana, bia, caio, post } = await setup();
  await rejectsWith(w.core.posts.addEventAdmin(ana, post.id, caio), 'CONFLICT');
  const { admins } = await w.core.posts.addEventAdmin(ana, post.id, bia);
  assert.deepEqual(admins.map((a) => a.username), ['bia']);
  const page = await w.core.eventPages.get(bia, post.id);
  assert.equal(page.isAdmin, true);
  assert.equal(page.isOwner, false);
  assert.equal(page.owner?.username, 'ana', 'o dono continua dono');
  assert.deepEqual((await w.core.eventPages.get(ana, post.id)).admins.map((a) => a.username), ['bia']);
  // bia recebeu o aviso.
  const notes = await w.notifications.listForUser(bia, 20);
  assert.ok(notes.some((n) => n.type === 'EVENT_ADMIN'));
  // Admin não escolhe admins; o dono não vira admin de si mesmo.
  await w.core.eventPages.go(caio, post.id);
  await rejectsWith(w.core.posts.addEventAdmin(bia, post.id, caio), 'FORBIDDEN');
  await rejectsWith(w.core.posts.addEventAdmin(ana, post.id, ana), 'CONFLICT');
  // Quem marcou "Eu vou" também pode ser admin.
  assert.deepEqual((await w.core.posts.addEventAdmin(ana, post.id, caio)).admins.map((a) => a.username), ['bia', 'caio']);
});

test('admin convida no evento privado (pela folha ou pelo cartão) e cancela só os convites que mandou', async () => {
  const { w, ana, bia, caio, duda, post } = await setup();
  // Sem ser admin, bia não convida nem manda o cartão do evento privado.
  await rejectsWith(w.core.posts.inviteToEvent(bia, post.id, [duda]), 'FORBIDDEN');
  await rejectsWith(w.core.conversations.send(bia, (await w.core.conversations.open(bia, duda)).id, { eventId: post.id }), 'FORBIDDEN');

  await w.core.posts.addEventAdmin(ana, post.id, bia);
  assert.deepEqual((await w.core.posts.inviteToEvent(bia, post.id, [duda])).invited, [duda]);
  const invite = (await w.core.eventPages.invites(ana, post.id)).invites.find((i) => i.user.username === 'duda');
  assert.equal(invite?.invitedBy?.username, 'bia');
  assert.equal(invite?.tagged, true, 'no evento privado o convite do admin vira marcação');
  assert.equal((await w.core.eventPages.get(duda, post.id)).title, 'Festa secreta');
  // O admin vê só os convites que mandou.
  assert.deepEqual((await w.core.eventPages.invites(bia, post.id)).invites.map((i) => i.user.username), ['duda']);

  // Cancela o convite que mandou, mas não o do dono.
  await rejectsWith(w.core.posts.cancelInvite(bia, post.id, caio), 'FORBIDDEN');
  await w.core.posts.cancelInvite(bia, post.id, duda);
  await rejectsWith(w.core.eventPages.get(duda, post.id), 'NOT_FOUND');

  // Pelo cartão numa conversa: duda vira convidada e marcada.
  await w.core.conversations.send(bia, (await w.core.conversations.open(bia, duda)).id, { eventId: post.id });
  assert.equal((await w.core.posts.get(duda, post.id)).myTag, 'PENDING');
});

test('admin edita o evento, mas não muda quem vê, não arquiva nem apaga', async () => {
  const { w, ana, bia, post } = await setup();
  await rejectsWith(w.core.posts.update(bia, post.id, { event: { title: 'Festa da bia', startsAt: post.event?.startsAt } }), 'FORBIDDEN');
  await w.core.posts.addEventAdmin(ana, post.id, bia);
  const edited = await w.core.posts.update(bia, post.id, { event: { title: 'Festa nova', startsAt: post.event?.startsAt, private: false } });
  assert.equal(edited.event?.title, 'Festa nova');
  assert.equal(edited.event?.private, true, 'quem vê continua escolha do dono');
  assert.equal(edited.author.username, 'ana');
  await rejectsWith(w.core.posts.update(bia, post.id, { event: null }), 'FORBIDDEN');
  await rejectsWith(w.core.posts.archive(bia, post.id), 'FORBIDDEN');
  await rejectsWith(w.core.posts.delete(bia, post.id), 'NOT_FOUND');
  assert.equal((await w.core.posts.get(ana, post.id)).id, post.id);
});

test('o dono tira o admin (e o admin pode sair sozinho); sem o papel, não convida mais', async () => {
  const { w, ana, bia, caio, duda, post } = await setup();
  await w.core.eventPages.go(caio, post.id);
  await w.core.posts.addEventAdmin(ana, post.id, bia);
  await w.core.posts.addEventAdmin(ana, post.id, caio);
  // Um admin não tira o outro.
  await rejectsWith(w.core.posts.removeEventAdmin(bia, post.id, caio), 'FORBIDDEN');
  assert.deepEqual((await w.core.posts.removeEventAdmin(ana, post.id, bia)).admins.map((a) => a.username), ['caio']);
  assert.equal((await w.core.eventPages.get(bia, post.id)).isAdmin, false);
  await rejectsWith(w.core.posts.inviteToEvent(bia, post.id, [duda]), 'FORBIDDEN');
  // caio sai sozinho.
  assert.deepEqual((await w.core.posts.removeEventAdmin(caio, post.id, caio)).admins, []);
  await rejectsWith(w.core.posts.removeEventAdmin(ana, post.id, caio), 'NOT_FOUND');
});
