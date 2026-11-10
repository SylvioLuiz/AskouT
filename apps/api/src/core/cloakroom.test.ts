import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;

/** Ana administra o Bar do Zé, que tem um evento amanhã. Bia e Caio são participantes. */
async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio');
  const ana = u['ana']!, bia = u['bia']!, caio = u['caio']!;
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: null, category: 'bar', lat: -23.58, lng: -46.65, isSample: false, ownerId: ana });
  await w.places.createVenue({ id: 'v2', name: 'Outro', address: null, category: 'bar', lat: -23.59, lng: -46.65, isSample: false, ownerId: bia });
  const now = w.clock.now().getTime();
  const ev = { venueId: 'v1', description: null, kind: 'OTHER' as const, isFree: true, imageUrl: null, tags: [], isSample: false };
  await w.places.createEvent({ ...ev, id: 'e1', title: 'Festa', startsAt: new Date(now + 24 * H), endsAt: new Date(now + 30 * H) });
  await w.places.createEvent({ ...ev, id: 'e2', title: 'Festa passada', startsAt: new Date(now - 30 * H), endsAt: new Date(now - 24 * H) });
  return { w, ana, bia, caio };
}

test('sem configurar, o evento não tem chapelaria', async () => {
  const { w, bia } = await setup();
  const view = await w.core.cloakroom.publicView(bia, 'e1');
  assert.equal(view.enabled, false);
  assert.equal(view.canRequest, false);
  await rejectsWith(w.core.cloakroom.request(bia, 'e1', { description: 'Casaco' }), 'NOT_FOUND');
});

test('só quem administra o local configura e vê o painel', async () => {
  const { w, ana, bia } = await setup();
  await rejectsWith(w.core.cloakroom.configure(bia, 'v1', 'e1', { enabled: true }), 'NOT_FOUND');
  await rejectsWith(w.core.cloakroom.panel(bia, 'v1', 'e1'), 'NOT_FOUND');
  await rejectsWith(w.core.cloakroom.panel(ana, 'v1', 'nao-existe'), 'NOT_FOUND');
  await rejectsWith(w.core.cloakroom.panel(bia, 'v2', 'e1'), 'NOT_FOUND', );
  await rejectsWith(w.core.cloakroom.panel(ana, 'v2', 'e1'), 'NOT_FOUND');
  const empty = await w.core.cloakroom.panel(ana, 'v1', 'e1');
  assert.equal(empty.setting.enabled, false);
  const panel = await w.core.cloakroom.configure(ana, 'v1', 'e1', { enabled: true, priceCents: 500, capacity: 10, note: ' Só casacos e bolsas ' });
  assert.deepEqual(panel.setting, { enabled: true, priceCents: 500, capacity: 10, note: 'Só casacos e bolsas' });
  const view = await w.core.cloakroom.publicView(bia, 'e1');
  assert.deepEqual([view.enabled, view.priceCents, view.spotsLeft, view.canRequest], [true, 500, 10, true]);
});

test('valida a configuração', async () => {
  const { w, ana } = await setup();
  await rejectsWith(w.core.cloakroom.configure(ana, 'v1', 'e1', {}), 'VALIDATION');
  await rejectsWith(w.core.cloakroom.configure(ana, 'v1', 'e1', { enabled: true, priceCents: -1 }), 'VALIDATION');
  await rejectsWith(w.core.cloakroom.configure(ana, 'v1', 'e1', { enabled: true, priceCents: 1.5 }), 'VALIDATION');
  await rejectsWith(w.core.cloakroom.configure(ana, 'v1', 'e1', { enabled: true, capacity: 0 }), 'VALIDATION');
  await rejectsWith(w.core.cloakroom.configure(ana, 'v1', 'e1', { enabled: true, note: 'x'.repeat(201) }), 'VALIDATION');
  const free = await w.core.cloakroom.configure(ana, 'v1', 'e1', { enabled: true, priceCents: 0 });
  assert.equal(free.setting.priceCents, null, 'zero vira grátis');
  assert.equal(free.setting.capacity, null);
});

test('ciclo completo: pede o ticket, entrega, retira', async () => {
  const { w, ana, bia } = await setup();
  await w.core.cloakroom.configure(ana, 'v1', 'e1', { enabled: true });
  const ticket = await w.core.cloakroom.request(bia, 'e1', { description: ' Casaco preto ', itemCount: 2 });
  assert.equal(ticket.status, 'ISSUED');
  assert.equal(ticket.number, 1);
  assert.equal(ticket.description, 'Casaco preto');
  assert.match(ticket.code, /^[A-Z0-9]{6}$/);

  // O participante vê o ticket; a equipe ainda não recebeu nada.
  assert.deepEqual((await w.core.cloakroom.publicView(bia, 'e1')).mine.map((t) => t.status), ['ISSUED']);
  await rejectsWith(w.core.cloakroom.giveBack(ana, 'v1', 'e1', ticket.code), 'CONFLICT');

  // A equipe confere (aceita minúsculas e espaços) e guarda.
  const found = await w.core.cloakroom.lookup(ana, 'v1', 'e1', ` ${ticket.code.toLowerCase()} `);
  assert.equal(found.owner?.username, 'bia');
  assert.equal(found.status, 'ISSUED');
  w.clock.tick(1000);
  const stored = await w.core.cloakroom.receive(ana, 'v1', 'e1', ticket.code);
  assert.equal(stored.status, 'STORED');
  assert.ok(stored.storedAt);
  await rejectsWith(w.core.cloakroom.receive(ana, 'v1', 'e1', ticket.code), 'CONFLICT');
  await rejectsWith(w.core.cloakroom.cancel(bia, ticket.id), 'CONFLICT');
  assert.equal((await w.core.cloakroom.panel(ana, 'v1', 'e1')).stats.stored, 1);

  w.clock.tick(1000);
  const back = await w.core.cloakroom.giveBack(ana, 'v1', 'e1', ticket.code);
  assert.equal(back.status, 'RETURNED');
  assert.ok(back.returnedAt);
  await rejectsWith(w.core.cloakroom.giveBack(ana, 'v1', 'e1', ticket.code), 'CONFLICT');
  assert.equal((await w.core.cloakroom.publicView(bia, 'e1')).mine[0]!.status, 'RETURNED');

  const panel = await w.core.cloakroom.panel(ana, 'v1', 'e1');
  assert.deepEqual([panel.stats.waiting, panel.stats.stored, panel.stats.returned, panel.stats.itemsInUse], [0, 0, 1, 0]);
});

test('código errado ou de outro evento não acha ticket; outro responsável não mexe', async () => {
  const { w, ana, bia } = await setup();
  await w.core.cloakroom.configure(ana, 'v1', 'e1', { enabled: true });
  const ticket = await w.core.cloakroom.request(bia, 'e1', { description: 'Mochila' });
  await rejectsWith(w.core.cloakroom.receive(ana, 'v1', 'e1', 'ZZZZZZ'), 'NOT_FOUND');
  await rejectsWith(w.core.cloakroom.receive(ana, 'v1', 'e1', ''), 'VALIDATION');
  await rejectsWith(w.core.cloakroom.receive(bia, 'v1', 'e1', ticket.code), 'NOT_FOUND');
});

test('limite de itens: lota, libera ao retirar ou cancelar', async () => {
  const { w, ana, bia, caio } = await setup();
  await w.core.cloakroom.configure(ana, 'v1', 'e1', { enabled: true, capacity: 3 });
  const a = await w.core.cloakroom.request(bia, 'e1', { description: 'Casacos', itemCount: 2 });
  await rejectsWith(w.core.cloakroom.request(caio, 'e1', { description: 'Casacos', itemCount: 2 }), 'CONFLICT');
  const b = await w.core.cloakroom.request(caio, 'e1', { description: 'Bolsa' });
  const view = await w.core.cloakroom.publicView(caio, 'e1');
  assert.equal(view.full, true);
  assert.equal(view.canRequest, false);
  assert.equal(view.spotsLeft, 0);

  // Cancelar libera a vaga; entregue e depois retirado também.
  const canceled = await w.core.cloakroom.cancel(caio, b.id);
  assert.equal(canceled.status, 'CANCELED');
  await rejectsWith(w.core.cloakroom.receive(ana, 'v1', 'e1', b.code), 'CONFLICT');
  assert.equal((await w.core.cloakroom.publicView(caio, 'e1')).spotsLeft, 1);
  await w.core.cloakroom.receive(ana, 'v1', 'e1', a.code);
  await w.core.cloakroom.giveBack(ana, 'v1', 'e1', a.code);
  assert.equal((await w.core.cloakroom.publicView(caio, 'e1')).spotsLeft, 3);
  const c = await w.core.cloakroom.request(caio, 'e1', { description: 'Casacos', itemCount: 3 });
  assert.equal(c.number, 3, 'a numeração segue a ordem de emissão no evento');
});

test('só o dono do ticket cancela; limites de entrada e de tickets abertos', async () => {
  const { w, ana, bia, caio } = await setup();
  await w.core.cloakroom.configure(ana, 'v1', 'e1', { enabled: true });
  const t = await w.core.cloakroom.request(bia, 'e1', { description: 'Casaco' });
  await rejectsWith(w.core.cloakroom.cancel(caio, t.id), 'NOT_FOUND');
  await rejectsWith(w.core.cloakroom.cancel(bia, 'nada'), 'NOT_FOUND');
  await rejectsWith(w.core.cloakroom.request(bia, 'e1', { description: '' }), 'VALIDATION');
  await rejectsWith(w.core.cloakroom.request(bia, 'e1', { description: 'x'.repeat(81) }), 'VALIDATION');
  await rejectsWith(w.core.cloakroom.request(bia, 'e1', { description: 'Casaco', itemCount: 0 }), 'VALIDATION');
  await rejectsWith(w.core.cloakroom.request(bia, 'e1', { description: 'Casaco', itemCount: 11 }), 'VALIDATION');
  await rejectsWith(w.core.cloakroom.request(bia, 'nao-existe', { description: 'Casaco' }), 'NOT_FOUND');
  await w.core.cloakroom.request(bia, 'e1', { description: 'Bolsa' });
  await w.core.cloakroom.request(bia, 'e1', { description: 'Capacete' });
  await rejectsWith(w.core.cloakroom.request(bia, 'e1', { description: 'Mais um' }), 'CONFLICT');
  // Cancelar libera um dos três; os códigos nunca se repetem.
  await w.core.cloakroom.cancel(bia, t.id);
  const again = await w.core.cloakroom.request(bia, 'e1', { description: 'Casaco' });
  const codes = (await w.core.cloakroom.panel(ana, 'v1', 'e1')).tickets.map((x) => x.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(again.number > 3);
});

test('desligar a chapelaria bloqueia novos pedidos; evento que terminou não aceita ticket', async () => {
  const { w, ana, bia } = await setup();
  await w.core.cloakroom.configure(ana, 'v1', 'e1', { enabled: true });
  const t = await w.core.cloakroom.request(bia, 'e1', { description: 'Casaco' });
  await w.core.cloakroom.configure(ana, 'v1', 'e1', { enabled: false });
  await rejectsWith(w.core.cloakroom.request(bia, 'e1', { description: 'Outro' }), 'NOT_FOUND');
  // A equipe ainda consegue atender quem já tinha ticket.
  assert.equal((await w.core.cloakroom.receive(ana, 'v1', 'e1', t.code)).status, 'STORED');

  await w.core.cloakroom.configure(ana, 'v1', 'e2', { enabled: true });
  assert.equal((await w.core.cloakroom.publicView(bia, 'e2')).canRequest, false);
  await rejectsWith(w.core.cloakroom.request(bia, 'e2', { description: 'Casaco' }), 'CONFLICT');
});

test('"meus tickets" lista tudo da pessoa com o nome do evento', async () => {
  const { w, ana, bia, caio } = await setup();
  await w.core.cloakroom.configure(ana, 'v1', 'e1', { enabled: true });
  await w.core.cloakroom.request(bia, 'e1', { description: 'Casaco' });
  w.clock.tick(1000);
  await w.core.cloakroom.request(bia, 'e1', { description: 'Bolsa' });
  await w.core.cloakroom.request(caio, 'e1', { description: 'Capacete' });
  const mine = await w.core.cloakroom.mine(bia);
  assert.deepEqual(mine.map((t) => [t.description, t.event.title]), [['Bolsa', 'Festa'], ['Casaco', 'Festa']]);
});
