import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

type World = ReturnType<typeof makeWorld>;
const notices = async (w: World, u: string) => (await w.core.notifications.list(u, 'messages')).items.filter((n) => n.type === 'MESSAGE');

/** Ana é dona do Bar do Zé; Bia não segue a Ana nem é seguida por ela. */
async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'duda');
  const ana = u['ana']!, bia = u['bia']!, caio = u['caio']!, duda = u['duda']!;
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: -23.58, lng: -46.65, isSample: false, ownerId: ana });
  await w.places.createVenue({ id: 'v2', name: 'Bar sem dono', address: 'Rua B, 2', category: 'bar', lat: -23.58, lng: -46.65, isSample: false, ownerId: null });
  return { w, ana, bia, caio, duda };
}

test('local com dono: qualquer pessoa manda mensagem pela página e chega direto para o dono, com aviso', async () => {
  const { w, ana, bia } = await setup();
  const { id } = await w.core.conversations.openVenue(bia, 'v1');
  assert.equal((await w.core.conversations.openVenue(bia, 'v1')).id, id, 'idempotente');
  await w.core.conversations.send(bia, id, { body: 'Vocês abrem no feriado?' });

  const [forOwner] = await w.core.conversations.list(ana);
  assert.equal(forOwner!.id, id);
  assert.equal(forOwner!.request, null, 'não vira solicitação');
  assert.deepEqual(forOwner!.venue, { id: 'v1', name: 'Bar do Zé', logoUrl: null, role: 'OWNER' });
  assert.equal(forOwner!.other!.username, 'bia');
  assert.equal(forOwner!.canSend, true);
  const [notice] = await notices(w, ana);
  assert.equal(notice!.title, 'bia · Bar do Zé');

  // O dono responde direto, e quem escreveu vê a conversa como sendo com o local.
  await w.core.conversations.send(ana, id, { body: 'Abrimos sim, das 18h às 2h!' });
  const [forCustomer] = await w.core.conversations.list(bia);
  assert.equal(forCustomer!.venue!.role, 'CUSTOMER');
  assert.equal((await notices(w, bia))[0]!.title, 'Bar do Zé');
  assert.equal((await w.core.conversations.messages(bia, id)).venue!.name, 'Bar do Zé');
});

test('conversa do local fica separada da conversa pessoal entre as duas pessoas', async () => {
  const { w, ana, bia } = await setup();
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, ana);
  const personal = await w.core.conversations.open(bia, ana);
  const venue = await w.core.conversations.openVenue(bia, 'v1');
  assert.notEqual(personal.id, venue.id);
  await w.core.conversations.send(bia, personal.id, { body: 'oi amiga' });
  await w.core.conversations.send(bia, venue.id, { body: 'tem mesa sábado?' });
  const list = await w.core.conversations.list(ana);
  assert.equal(list.length, 2);
  assert.equal(list.find((c) => c.id === personal.id)!.venue, null);
});

test('local sem dono, quem administra e bloqueio: não abre', async () => {
  const { w, ana, bia, caio } = await setup();
  await rejectsWith(w.core.conversations.openVenue(bia, 'v2'), 'FORBIDDEN');
  await rejectsWith(w.core.conversations.openVenue(bia, 'nao-existe'), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.openVenue(ana, 'v1'), 'FORBIDDEN');
  await w.core.venues.inviteManager(ana, 'v1', 'caio');
  await w.core.venues.respondInvite(caio, 'v1', true);
  await rejectsWith(w.core.conversations.openVenue(caio, 'v1'), 'FORBIDDEN');

  const { id } = await w.core.conversations.openVenue(bia, 'v1');
  await w.core.blocks.block(ana, bia);
  await rejectsWith(w.core.conversations.openVenue(bia, 'v1'), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.send(bia, id, { body: 'oi' }), 'NOT_FOUND');
});

test('local troca de dono: a conversa passa para o dono novo, e o antigo deixa de ver', async () => {
  const { w, ana, bia, duda } = await setup();
  const { id } = await w.core.conversations.openVenue(bia, 'v1');
  await w.core.conversations.send(bia, id, { body: 'oi' });
  await w.places.setVenueOwner('v1', duda);
  await rejectsWith(w.core.conversations.messages(ana, id), 'NOT_FOUND');
  await w.core.conversations.send(bia, id, { body: 'alguém aí?' });
  const [forNew] = await w.core.conversations.list(duda);
  assert.equal(forNew!.id, id);
  assert.equal(forNew!.venue!.role, 'OWNER');
  assert.equal((await w.core.conversations.list(ana)).length, 0);
});
