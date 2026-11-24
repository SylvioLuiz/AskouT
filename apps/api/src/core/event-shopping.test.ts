import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeSplit } from './event-shopping-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]);
const PDF = Buffer.from('%PDF-1.4 nota');

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'zeca');
  const ana = u['ana']!;
  const bia = u['bia']!;
  const caio = u['caio']!;
  const zeca = u['zeca']!;
  for (const id of [bia, caio, zeca]) {
    await w.core.follows.follow(ana, id);
    await w.core.follows.follow(id, ana);
  }
  const post = await w.core.posts.create(ana, { images: [`data:image/jpeg;base64,${JPEG.toString('base64')}`], caption: 'Bora', event: { title: 'Churras', startsAt: '2026-12-20T20:00:00.000Z', endsAt: '2026-12-20T23:00:00.000Z', private: true } });
  for (const id of [bia, caio]) {
    const c = await w.core.conversations.open(ana, id);
    await w.core.conversations.send(ana, c.id, { eventId: post.id });
    // Aceitou o convite: entra no grupo do evento.
    await w.core.eventPages.go(id, post.id);
  }
  const group = await w.core.conversations.createEventGroup(ana, post.id);
  return { w, ana, bia, caio, zeca, eventId: post.id, groupId: group.id };
}

test('lista de compras: só existe em evento de pessoa e só quem criou liga', async () => {
  const { w, ana, bia, eventId } = await setup();
  let view = await w.core.eventShopping.get(bia, eventId);
  assert.equal(view.supported, true);
  assert.equal(view.enabled, false);
  assert.equal(view.isMember, true);
  await rejectsWith(w.core.eventShopping.configure(bia, eventId, { enabled: true }), 'FORBIDDEN');
  await rejectsWith(w.core.eventShopping.addItem(ana, eventId, { title: 'Carvão' }), 'NOT_FOUND');
  view = await w.core.eventShopping.configure(ana, eventId, { enabled: true });
  assert.deepEqual([view.enabled, view.isOwner, view.isAdmin, view.settings], [true, true, true, { membersCanAdd: true, membersCanCheck: true }]);

  // Evento de local nunca tem lista.
  const venue = await w.places.createVenue({ id: 'v1', name: 'Bar', address: null, category: 'bar', lat: 0, lng: 0, isSample: true });
  void venue;
  const placeEvent = { id: '00000000-0000-4000-8000-00000000e001', venueId: 'v1', title: 'Show', description: null, kind: 'SHOW' as const, isFree: true, imageUrl: null, tags: [], startsAt: new Date('2026-12-20T20:00:00Z'), endsAt: new Date('2026-12-20T23:00:00Z'), isSample: true };
  await w.places.createEvent(placeEvent);
  assert.equal((await w.core.eventShopping.get(ana, placeEvent.id)).supported, false);
  await rejectsWith(w.core.eventShopping.configure(ana, placeEvent.id, { enabled: true }), 'NOT_FOUND');
});

test('lista de compras: quem não está no grupo não vê nem usa', async () => {
  const { w, ana, zeca, eventId } = await setup();
  await w.core.eventShopping.configure(ana, eventId, { enabled: true });
  await w.core.eventShopping.addItem(ana, eventId, { title: 'Carvão' });
  // zeca é amigo, mas não foi convidado: o evento privado nem abre.
  await rejectsWith(w.core.eventShopping.get(zeca, eventId), 'NOT_FOUND');
});

test('lista de compras: permissões de acrescentar e marcar', async () => {
  const { w, ana, bia, caio, eventId, groupId } = await setup();
  await w.core.eventShopping.configure(ana, eventId, { enabled: true, membersCanAdd: false, membersCanCheck: false });
  let view = await w.core.eventShopping.get(bia, eventId);
  assert.deepEqual([view.canAdd, view.canCheck, view.isAdmin], [false, false, false]);
  await rejectsWith(w.core.eventShopping.addItem(bia, eventId, { title: 'Gelo' }), 'FORBIDDEN');
  view = await w.core.eventShopping.addItem(ana, eventId, { title: '  Carvão ', quantity: '2 sacos' });
  const carvao = view.items[0]!;
  assert.deepEqual([carvao.title, carvao.quantity, carvao.createdBy?.userId], ['Carvão', '2 sacos', ana]);
  await rejectsWith(w.core.eventShopping.updateItem(bia, eventId, carvao.id, { bought: true }), 'FORBIDDEN');
  await rejectsWith(w.core.eventShopping.configure(bia, eventId, { membersCanAdd: true }), 'FORBIDDEN');

  // Administrador do grupo também administra a lista (mas não desliga).
  await w.core.conversations.setAdmin(ana, groupId, caio, true);
  view = await w.core.eventShopping.configure(caio, eventId, { membersCanAdd: true, membersCanCheck: true });
  assert.deepEqual(view.settings, { membersCanAdd: true, membersCanCheck: true });
  await rejectsWith(w.core.eventShopping.configure(caio, eventId, { enabled: false }), 'FORBIDDEN');

  view = await w.core.eventShopping.addItem(bia, eventId, { title: 'Gelo' });
  const gelo = view.items.find((i) => i.title === 'Gelo')!;
  assert.equal(gelo.canEdit, true, 'quem criou edita o próprio item');
  assert.equal(view.items.find((i) => i.id === carvao.id)!.canEdit, false);
  await rejectsWith(w.core.eventShopping.deleteItem(bia, eventId, carvao.id), 'FORBIDDEN');
  view = await w.core.eventShopping.updateItem(bia, eventId, carvao.id, { bought: true });
  assert.equal(view.items.find((i) => i.id === carvao.id)!.boughtBy?.userId, bia);
  view = await w.core.eventShopping.updateItem(bia, eventId, gelo.id, { title: 'Gelo (2 sacos)' });
  assert.equal(view.items.find((i) => i.id === gelo.id)!.title, 'Gelo (2 sacos)');
  view = await w.core.eventShopping.deleteItem(ana, eventId, gelo.id);
  assert.deepEqual(view.items.map((i) => i.title), ['Carvão']);
  await rejectsWith(w.core.eventShopping.addItem(bia, eventId, { title: '   ' }), 'VALIDATION');
});

test('divisão: anexos de várias pessoas, admin informa valor e quem pagou, total dividido por todos', async () => {
  const { w, ana, bia, caio, eventId } = await setup();
  await w.core.eventShopping.configure(ana, eventId, { enabled: true });
  // bia e caio anexam notas; quem não administra não informa valor.
  let view = await w.core.eventShopping.attach(bia, eventId, { mime: 'application/pdf', data: new Uint8Array(PDF), name: 'mercado.pdf' }, { note: 'Mercado' });
  await rejectsWith(w.core.eventShopping.attach(caio, eventId, { mime: 'image/jpeg', data: new Uint8Array(JPEG) }, { amountCents: 100 }), 'FORBIDDEN');
  view = await w.core.eventShopping.attach(caio, eventId, { mime: 'image/jpeg', data: new Uint8Array(JPEG) });
  await rejectsWith(w.core.eventShopping.attach(caio, eventId, { mime: 'text/html', data: new Uint8Array(Buffer.from('<p>')) }), 'VALIDATION');
  assert.equal(view.expenses.length, 2);
  assert.equal(view.split?.pendingCount, 2);
  assert.equal(view.split?.totalCents, 0);
  const [mercado, foto] = view.expenses;
  assert.equal(mercado!.fileName, 'mercado.pdf');
  assert.equal(foto!.fileName, 'foto.jpg');

  // Qualquer participante baixa o anexo.
  const file = await w.core.eventShopping.expenseFile(caio, eventId, mercado!.id);
  assert.equal(Buffer.from(file.data).toString(), PDF.toString());

  await rejectsWith(w.core.eventShopping.updateExpense(bia, eventId, mercado!.id, { amountCents: 100 }), 'FORBIDDEN');
  await w.core.eventShopping.updateExpense(ana, eventId, mercado!.id, { amountCents: 20000, payerId: bia });
  view = await w.core.eventShopping.updateExpense(ana, eventId, foto!.id, { amountCents: 10001, payerId: caio });
  // Gasto sem anexo (pago em dinheiro).
  view = await w.core.eventShopping.addExpense(ana, eventId, { amountCents: 2999, payerId: ana, note: 'Gelo' });
  const split = view.split!;
  assert.equal(split.totalCents, 33000);
  assert.equal(split.pendingCount, 0);
  const by = new Map(split.people.map((p) => [p.user.userId, p]));
  assert.deepEqual([ana, bia, caio].map((id) => by.get(id)!.shareCents), [11000, 11000, 11000]);
  assert.deepEqual([ana, bia, caio].map((id) => by.get(id)!.balanceCents), [-8001, 9000, -999]);
  assert.deepEqual(split.transfers.map((t) => [t.from.userId, t.to.userId, t.amountCents]), [[ana, bia, 8001], [caio, bia, 999]]);

  // Tirar alguém da divisão: o total se divide pelos outros.
  await rejectsWith(w.core.eventShopping.setSplitMember(bia, eventId, caio, false), 'FORBIDDEN');
  view = await w.core.eventShopping.setSplitMember(ana, eventId, caio, false);
  const caioRow = view.split!.people.find((p) => p.user.userId === caio)!;
  assert.deepEqual([caioRow.included, caioRow.shareCents, caioRow.balanceCents], [false, 0, 10001]);

  // Quem anexou apaga o próprio anexo só enquanto não tem valor; o admin sempre.
  await rejectsWith(w.core.eventShopping.deleteExpense(bia, eventId, mercado!.id), 'FORBIDDEN');
  view = await w.core.eventShopping.deleteExpense(ana, eventId, mercado!.id);
  assert.equal(view.expenses.length, 2);

  // Desligar apaga tudo.
  view = await w.core.eventShopping.configure(ana, eventId, { enabled: false });
  assert.equal(view.enabled, false);
  view = await w.core.eventShopping.configure(ana, eventId, { enabled: true });
  assert.deepEqual([view.items.length, view.expenses.length], [0, 0]);
});

test('divisão: quem pagou precisa estar no grupo; quem sai continua na conta do que pagou', async () => {
  const { w, ana, bia, zeca, eventId, groupId } = await setup();
  await w.core.eventShopping.configure(ana, eventId, { enabled: true });
  await rejectsWith(w.core.eventShopping.addExpense(ana, eventId, { amountCents: 1000, payerId: zeca }), 'VALIDATION');
  await w.core.eventShopping.addExpense(ana, eventId, { amountCents: 3000, payerId: bia });
  await w.core.conversations.leave(bia, groupId);
  const view = await w.core.eventShopping.get(ana, eventId);
  const biaRow = view.split!.people.find((p) => p.user.userId === bia)!;
  assert.deepEqual([biaRow.included, biaRow.paidCents, biaRow.balanceCents], [false, 3000, 3000]);
  assert.equal(view.split!.people.filter((p) => p.included).length, 2, 'ana e caio dividem');
});

test('computeSplit: centavos que sobram vão para os primeiros; sem ninguém pagar não há transferências', () => {
  const r = computeSplit(['a', 'b', 'c'], [{ amountCents: 100, payerId: 'a' }, { amountCents: null, payerId: 'b' }]);
  assert.equal(r.totalCents, 100);
  assert.deepEqual([...r.share.values()], [34, 33, 33]);
  assert.deepEqual(r.transfers, [{ from: 'b', to: 'a', amountCents: 33 }, { from: 'c', to: 'a', amountCents: 33 }]);
  assert.deepEqual(computeSplit(['a'], []).transfers, []);
});
