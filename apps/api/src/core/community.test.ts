import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const DAY = 86_400_000;

/** ana é amiga de bia, caio e dani; eva não é amiga de ninguém. */
async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'dani', 'eva');
  const [ana, bia, caio, dani, eva] = ['ana', 'bia', 'caio', 'dani', 'eva'].map((n) => u[n]!) as [string, string, string, string, string];
  for (const id of [bia, caio, dani]) {
    await w.core.follows.follow(ana, id);
    await w.core.follows.follow(id, ana);
  }
  return { w, ana, bia, caio, dani, eva };
}

function eventAt(w: ReturnType<typeof makeWorld>, days: number, title = 'Churrasco') {
  const start = new Date(w.clock.now().getTime() + days * DAY);
  return { title, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3 * 3_600_000).toISOString() };
}

test('grupo de amigos: convidado só entra quando aceita; recusar some com o convite; a mesma pessoa em vários grupos', async () => {
  const { w, ana, bia, caio, eva } = await setup();
  const { id, invited } = await w.core.communities.create(ana, { name: 'Turma da faculdade', memberIds: [bia, caio] });
  assert.equal(invited, 2);
  assert.deepEqual(await w.conversations.participantIds(id), [ana], 'ninguém entra sem aceitar');
  await rejectsWith(w.core.conversations.messages(bia, id), 'NOT_FOUND');
  await rejectsWith(w.core.communities.get(bia, id), 'NOT_FOUND');

  const biaInvites = (await w.core.communities.list(bia)).invites;
  assert.equal(biaInvites.length, 1);
  assert.equal(biaInvites[0]!.name, 'Turma da faculdade');
  assert.equal(biaInvites[0]!.invitedBy?.username, 'ana');

  await w.core.communities.accept(bia, id);
  assert.deepEqual((await w.conversations.participantIds(id))?.sort(), [ana, bia].sort());
  assert.equal((await w.core.communities.list(bia)).invites.length, 0);
  assert.equal((await w.core.communities.list(bia)).items[0]?.conversationId, id);
  assert.ok((await w.core.conversations.messages(ana, id)).messages.some((m) => /aceitou o convite/.test(m.body)));

  await w.core.communities.decline(caio, id);
  assert.equal((await w.core.communities.list(caio)).invites.length, 0);
  await rejectsWith(w.core.communities.accept(caio, id), 'NOT_FOUND', 'recusou: o convite não vale mais');

  // Só amigos podem ser convidados.
  await rejectsWith(w.core.communities.invite(ana, id, { userIds: [eva] }), 'FORBIDDEN');
  // Membro comum não convida.
  await rejectsWith(w.core.communities.invite(bia, id, { userIds: [caio] }), 'FORBIDDEN');
  // Grupo de amigos não aceita "adicionar direto".
  await rejectsWith(w.core.conversations.addMembers(ana, id, [caio]), 'CONFLICT');

  // A mesma pessoa pode estar em outro grupo.
  const other = await w.core.communities.create(ana, { name: 'Vôlei', memberIds: [bia] });
  await w.core.communities.accept(bia, other.id);
  assert.deepEqual((await w.core.communities.list(bia)).items.map((g) => g.name).sort(), ['Turma da faculdade', 'Vôlei']);
});

test('grupo de amigos: admin convida, remove e promove; qualquer um sai quando quiser', async () => {
  const { w, ana, bia, caio, dani } = await setup();
  await w.core.follows.follow(bia, caio);
  await w.core.follows.follow(caio, bia);
  const { id } = await w.core.communities.create(ana, { name: 'Turma', memberIds: [bia, caio] });
  await w.core.communities.accept(bia, id);
  await w.core.communities.accept(caio, id);

  await w.core.conversations.setAdmin(ana, id, bia, true);
  assert.equal((await w.core.communities.get(bia, id)).canManage, true);
  // Admin convida amigos dele.
  await w.core.communities.invite(ana, id, { userIds: [dani] });
  assert.deepEqual((await w.core.communities.get(bia, id)).pending.map((p) => p.user.username), ['dani'], 'admin vê os convites pendentes');
  assert.deepEqual((await w.core.communities.get(caio, id)).pending, [], 'membro comum não vê convites pendentes');
  // Admin remove membro.
  await w.core.conversations.removeMember(bia, id, caio);
  await rejectsWith(w.core.communities.get(caio, id), 'NOT_FOUND');
  // Dono tira o admin.
  await w.core.conversations.setAdmin(ana, id, bia, false);
  assert.equal((await w.core.communities.get(bia, id)).canManage, false);
  // Sair a qualquer momento.
  await w.core.conversations.leave(bia, id);
  await rejectsWith(w.core.communities.get(bia, id), 'NOT_FOUND');
  // Cancelar convite pendente.
  await w.core.communities.cancelInvite(ana, id, dani);
  assert.equal((await w.core.communities.list(dani)).invites.length, 0);
});

test('histórico: quem convida escolhe se a pessoa vê as mensagens de antes', async () => {
  const { w, ana, bia, caio } = await setup();
  const { id } = await w.core.communities.create(ana, { name: 'Turma', memberIds: [bia], shareHistory: false });
  await w.core.conversations.send(ana, id, { body: 'antes da bia' });
  w.clock.tick(1000);
  await w.core.communities.accept(bia, id);
  w.clock.tick(1000);
  await w.core.conversations.send(ana, id, { body: 'depois da bia' });
  const bodies = (await w.core.conversations.messages(bia, id)).messages.map((m) => m.body);
  assert.ok(!bodies.includes('antes da bia'), 'sem o histórico');
  assert.ok(bodies.includes('depois da bia'));
  assert.ok(bodies.some((b) => /aceitou o convite/.test(b)), 'o aviso de entrada aparece');

  await w.core.communities.invite(ana, id, { userIds: [caio], shareHistory: true });
  await w.core.communities.accept(caio, id);
  assert.ok((await w.core.conversations.messages(caio, id)).messages.some((m) => m.body === 'antes da bia'), 'com o histórico');
});

test('histórico também vale para os grupos de conversa comuns', async () => {
  const { w, ana, bia, caio, dani } = await setup();
  const { id } = await w.core.conversations.createGroup(ana, { name: 'Papo', memberIds: [bia, caio] });
  await w.core.conversations.send(ana, id, { body: 'segredo antigo' });
  w.clock.tick(1000);
  await w.core.conversations.addMembers(ana, id, [dani], false);
  const bodies = (await w.core.conversations.messages(dani, id)).messages.map((m) => m.body);
  assert.ok(!bodies.includes('segredo antigo'));
  assert.ok(bodies.some((b) => /adicionou/.test(b)));
  await rejectsWith(w.core.conversations.addMembers(ana, id, [dani], 'não'), 'VALIDATION');
});

test('evento no grupo: nasce privado, convida todos do grupo; quem entra depois também é convidado', async () => {
  const { w, ana, bia, caio, dani, eva } = await setup();
  const { id } = await w.core.communities.create(ana, { name: 'Turma', memberIds: [bia, caio, dani] });
  await w.core.communities.accept(bia, id);
  await w.core.communities.accept(caio, id);

  const post = await w.core.posts.create(bia, { groupId: id, event: { ...eventAt(w, 3), private: false } });
  assert.equal(post.event?.private, true, 'evento do grupo nasce privado');
  const invites = await w.core.eventPages.invites(bia, post.id);
  assert.deepEqual(invites.invites.map((i) => i.user.username).sort(), ['ana', 'caio'], 'convite para todos do grupo (menos quem criou)');
  // Membros abrem o evento privado; quem está fora, não.
  assert.equal((await w.core.eventPages.get(caio, post.id)).isPrivate, true);
  await rejectsWith(w.core.eventPages.get(eva, post.id), 'NOT_FOUND');
  // Convite não coloca ninguém no grupo de conversa do evento: só quem aceita ("Eu vou").
  assert.equal((await w.core.eventPages.get(caio, post.id)).going, false);
  // O cartão vai para a conversa do grupo.
  assert.ok((await w.core.conversations.messages(ana, id)).messages.some((m) => m.kind === 'EVENT'));
  // O grupo lista o evento.
  assert.deepEqual((await w.core.communities.get(ana, id)).events.map((e) => e.id), [post.id]);
  assert.equal((await w.core.communities.list(ana)).items[0]?.nextEvent?.id, post.id);

  // dani aceita depois: passa a ser convidada do evento que ainda vai acontecer.
  await w.core.communities.accept(dani, id);
  assert.ok((await w.core.eventPages.invites(bia, post.id)).invites.some((i) => i.user.username === 'dani'));

  // Quem está fora do grupo não cria evento nele.
  await rejectsWith(w.core.posts.create(eva, { groupId: id, event: eventAt(w, 2) }), 'NOT_FOUND');
  // Vários eventos no mesmo grupo.
  await w.core.posts.create(ana, { groupId: id, event: eventAt(w, 1, 'Cinema') });
  assert.deepEqual((await w.core.communities.get(caio, id)).events.map((e) => e.title), ['Cinema', 'Churrasco']);
});

test('evento do grupo aberto ao público: o grupo de origem continua protegido', async () => {
  const { w, ana, bia, eva } = await setup();
  const { id } = await w.core.communities.create(ana, { name: 'Turma secreta', memberIds: [bia] });
  await w.core.communities.accept(bia, id);
  const post = await w.core.posts.create(ana, { groupId: id, event: eventAt(w, 2) });
  await w.core.posts.create(ana, { groupId: id, event: eventAt(w, 4, 'Outro rolê') });
  assert.deepEqual((await w.core.eventPages.get(bia, post.id)).originGroup, { conversationId: id, name: 'Turma secreta' });

  const edited = await w.core.posts.update(ana, post.id, { event: { ...eventAt(w, 2), private: false } });
  assert.equal(edited.event?.private, false);
  // eva segue ana e passa a ver o evento público, mas não o grupo.
  await w.core.follows.follow(eva, ana);
  const page = await w.core.eventPages.get(eva, post.id);
  assert.equal(page.isPrivate, false);
  assert.equal(page.originGroup, null, 'quem está fora não vê o grupo de origem');
  assert.equal(page.group, null);
  await rejectsWith(w.core.communities.get(eva, id), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.messages(eva, id), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.group(eva, id), 'NOT_FOUND');
  assert.deepEqual((await w.core.eventPages.invites(eva, post.id)).invites, [], 'não vê a lista de convidados (membros do grupo)');
  // "Eu vou" no evento público não coloca ninguém no grupo de amigos.
  await w.core.eventPages.go(eva, post.id);
  assert.ok(!(await w.conversations.participantIds(id))?.includes(eva));
  assert.equal((await w.core.eventPages.get(eva, post.id)).originGroup, null);
});
