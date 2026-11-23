import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

type World = ReturnType<typeof makeWorld>;

const messageNotices = async (w: World, u: string) => (await w.core.notifications.list(u, 'messages')).items.filter((n) => n.type === 'MESSAGE');

/** Ana segue a Bia, a Bia não segue a Ana: o que a Ana escreve vira solicitação para a Bia. */
async function oneWay() {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await w.core.follows.follow(ana!, bia!);
  return { w, ana: ana!, bia: bia!, caio: caio! };
}

test('solicitação: quem segue sem ser seguido de volta escreve, e a conversa vai para as solicitações de quem recebe', async () => {
  const { w, ana, bia } = await oneWay();
  const opened = await w.core.conversations.open(ana, bia);
  assert.equal(opened.request, 'OUTGOING');
  assert.deepEqual(await w.core.conversations.requests(bia), [], 'conversa vazia não aparece como solicitação');

  await w.core.conversations.send(ana, opened.id, { body: 'oi, vi seu evento!' });
  assert.equal((await messageNotices(w, bia)).length, 0, 'solicitação não gera aviso de mensagem');

  const inbox = await w.core.conversations.inbox(bia);
  assert.equal(inbox.items.length, 0, 'fora da caixa de conversas');
  assert.equal(inbox.requestCount, 1);
  assert.equal(inbox.requestUnread, 1);
  const [request] = await w.core.conversations.requests(bia);
  assert.equal(request!.request, 'INCOMING');
  assert.equal(request!.canSend, false);
  assert.equal(request!.lastMessage!.body, 'oi, vi seu evento!');

  const mine = await w.core.conversations.list(ana);
  assert.equal(mine.length, 1, 'quem enviou vê a conversa na própria caixa');
  assert.equal(mine[0]!.request, 'OUTGOING');
  assert.equal(mine[0]!.canSend, true);
  await w.core.conversations.send(ana, opened.id, { body: 'pode mandar mais de uma' });

  // Quem recebeu lê, mas não responde antes de aceitar, e quem enviou não fica sabendo que foi lida.
  const view = await w.core.conversations.messages(bia, opened.id);
  assert.equal(view.request, 'INCOMING');
  assert.equal(view.canSend, false);
  await rejectsWith(w.core.conversations.send(bia, opened.id, { body: 'oi' }), 'FORBIDDEN');
  await rejectsWith(w.core.conversations.react(bia, opened.id, view.messages[0]!.id, '❤️'), 'FORBIDDEN');
  const anaView = await w.core.conversations.messages(ana, opened.id);
  assert.equal(anaView.members[0]!.readAt, null, 'sem confirmação de leitura até aceitar');
});

test('aceitar: a conversa vai para a caixa normal dos dois, liberada nos dois sentidos, com avisos e leitura', async () => {
  const { w, ana, bia } = await oneWay();
  const { id } = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, id, { body: 'oi' });
  await rejectsWith(w.core.conversations.acceptRequest(ana, id), 'NOT_FOUND');
  await w.core.conversations.acceptRequest(bia, id);

  assert.equal((await w.core.conversations.requests(bia)).length, 0);
  const [item] = await w.core.conversations.list(bia);
  assert.equal(item!.request, null);
  assert.equal(item!.canSend, true);
  await w.core.conversations.send(bia, id, { body: 'oi, tudo bem?' });
  await w.core.conversations.messages(bia, id);
  assert.notEqual((await w.core.conversations.messages(ana, id)).members[0]!.readAt, null, 'com a solicitação aceita, o "Visto" aparece');

  w.clock.tick(1000);
  await w.core.conversations.send(ana, id, { body: 'tudo!' });
  assert.equal((await messageNotices(w, bia)).length, 1, 'depois de aceitar, chegam os avisos');

  // Aceita, continua aberta mesmo que ninguém siga ninguém.
  await w.core.follows.unfollow(ana, bia);
  assert.equal((await w.core.conversations.messages(ana, id)).canSend, true);
  await w.core.conversations.send(ana, id, { body: 'ainda dá' });
});

test('recusar: some das solicitações sem avisar; se a pessoa escrever de novo, volta só com as mensagens novas', async () => {
  const { w, ana, bia } = await oneWay();
  const { id } = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, id, { body: 'primeira' });
  w.clock.tick(1000);
  await w.core.conversations.declineRequest(bia, id);
  assert.equal((await w.core.conversations.inbox(bia)).requestCount, 0);
  assert.equal((await w.core.conversations.list(bia)).length, 0);
  assert.equal((await w.core.conversations.list(ana))[0]!.request, 'OUTGOING', 'quem enviou não fica sabendo');

  w.clock.tick(1000);
  await w.core.conversations.send(ana, id, { body: 'segunda' });
  const [again] = await w.core.conversations.requests(bia);
  assert.equal(again!.lastMessage!.body, 'segunda');
  assert.deepEqual((await w.core.conversations.messages(bia, id)).messages.map((m) => m.body), ['segunda']);
});

test('bloquear: a solicitação some e quem enviou não consegue mais escrever', async () => {
  const { w, ana, bia } = await oneWay();
  const { id } = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, id, { body: 'oi' });
  await w.core.blocks.block(bia, ana);
  assert.equal((await w.core.conversations.inbox(bia)).requestCount, 0);
  await rejectsWith(w.core.conversations.send(ana, id, { body: 'oi?' }), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.open(ana, bia), 'NOT_FOUND');
});

test('seguir de volta: a solicitação pendente vira conversa normal', async () => {
  const { w, ana, bia } = await oneWay();
  const { id } = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, id, { body: 'oi' });
  await w.core.follows.follow(bia, ana);
  const [item] = await w.core.conversations.list(bia);
  assert.equal(item!.id, id);
  assert.equal(item!.request, null);
  assert.equal(item!.canSend, true);
});

test('quem recebe segue quem escreve: vai direto; sem seguir nenhum lado, não dá para escrever', async () => {
  const { w, ana, bia, caio } = await oneWay();
  // A Bia não segue a Ana, mas a Ana segue a Bia: o que a Bia escreve chega direto para a Ana.
  const { id, request } = await w.core.conversations.open(bia, ana);
  assert.equal(request, null);
  await w.core.conversations.send(bia, id, { body: 'oi' });
  assert.equal((await w.core.conversations.list(ana))[0]!.request, null);
  assert.equal((await messageNotices(w, ana)).length, 1);

  await rejectsWith(w.core.conversations.open(caio, ana), 'FORBIDDEN');
  assert.equal((await w.core.conversations.list(ana)).length, 1, 'tentar abrir sem poder não cria conversa vazia');
  assert.deepEqual(await w.core.conversations.list(caio), []);
});

test('perfil privado: só depois do pedido aprovado dá para mandar solicitação', async () => {
  const { w, ana, bia } = await oneWay();
  const { duda: caio } = await w.signUpMany('duda');
  await w.core.profiles.setPrivacy(bia, true);
  await w.core.follows.follow(caio!, bia);
  await rejectsWith(w.core.conversations.open(caio!, bia), 'FORBIDDEN');
  await w.core.follows.approve(bia, caio!);
  assert.equal((await w.core.conversations.open(caio!, bia)).request, 'OUTGOING');
  assert.equal((await w.core.conversations.open(ana, bia)).request, 'OUTGOING');
});

test('perfil público que aceita mensagens de qualquer pessoa: chegam direto na caixa, até de quem não segue', async () => {
  const { w, ana, bia, caio } = await oneWay();
  assert.deepEqual(await w.core.conversations.messageSettings(bia), { openDms: false, isPrivate: false });
  await rejectsWith(w.core.conversations.setMessageSettings(bia, { openDms: 'sim' }), 'VALIDATION');
  // Solicitação que já estava esperando passa para a caixa quando a pessoa abre as mensagens.
  const pending = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, pending.id, { body: 'oi' });
  assert.deepEqual(await w.core.conversations.setMessageSettings(bia, { openDms: true }), { openDms: true, isPrivate: false });
  assert.equal((await w.core.conversations.inbox(bia)).requestCount, 0);
  assert.equal((await w.core.conversations.list(bia)).length, 1);

  const { id, request } = await w.core.conversations.open(caio, bia);
  assert.equal(request, null);
  await w.core.conversations.send(caio, id, { body: 'vocês abrem sábado?' });
  assert.equal((await messageNotices(w, bia)).length, 1);

  // Perfil privado: a opção não vale.
  await w.core.profiles.setPrivacy(bia, true);
  const { dani } = await w.signUpMany('dani');
  await rejectsWith(w.core.conversations.open(dani!, bia), 'FORBIDDEN');
});

test('perfil: diz se a mensagem vai direto, vira solicitação ou precisa seguir', async () => {
  const { w, ana, bia, caio } = await oneWay();
  assert.equal((await w.core.profiles.getByUsername(ana, 'bia')).relationship.message, 'REQUEST');
  assert.equal((await w.core.profiles.getByUsername(bia, 'ana')).relationship.message, 'DIRECT');
  assert.equal((await w.core.profiles.getByUsername(caio, 'bia')).relationship.message, 'NONE');
  await w.core.conversations.setMessageSettings(bia, { openDms: true });
  assert.equal((await w.core.profiles.getByUsername(caio, 'bia')).relationship.message, 'DIRECT');
});

test('amigos: conversas continuam normais, sem solicitação', async () => {
  const { w, ana, bia } = await oneWay();
  await w.core.follows.follow(bia, ana);
  const { id, request } = await w.core.conversations.open(ana, bia);
  assert.equal(request, null);
  await w.core.conversations.send(ana, id, { body: 'oi' });
  assert.equal((await w.core.conversations.list(bia))[0]!.request, null);
  assert.equal((await messageNotices(w, bia)).length, 1);
});
