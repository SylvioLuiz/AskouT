import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DomainError } from './errors.ts';
import { csvCell } from './guest-list-service.ts';
import { makeWorld } from './testing/world.ts';

const MIN = 60_000;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('dono', 'ana', 'bia', 'caio');
  const dono = u['dono']!, ana = u['ana']!, bia = u['bia']!, caio = u['caio']!;
  await w.places.createVenue({ id: 'v1', name: 'Balada Neon', address: 'Rua A, 1', category: 'nightclub', lat: -23.58, lng: -46.65, isSample: false, ownerId: dono });
  const t0 = w.clock.now().getTime();
  await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Noite Neon', description: null, kind: 'OTHER', isFree: false, imageUrl: null, tags: [], startsAt: new Date(t0 + 120 * MIN), endsAt: new Date(t0 + 360 * MIN), isSample: false });
  return { w, dono, ana, bia, caio, t0 };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return 'OK';
}

test('só quem administra o local liga a lista; sem ela, ninguém entra', async () => {
  const { w, dono, ana } = await setup();
  assert.deepEqual((await w.core.guestList.get(ana, 'e1')).enabled, false);
  assert.equal(await code(w.core.guestList.join(ana, 'e1')), 'NOT_FOUND');
  assert.equal(await code(w.core.guestList.configure(ana, 'e1', { enabled: true })), 'FORBIDDEN');
  const view = await w.core.guestList.configure(dono, 'e1', { enabled: true, limit: 10, maxCompanions: 2 });
  assert.deepEqual([view.enabled, view.isOwner, view.config?.limit, view.config?.maxCompanions, view.open, view.spotsLeft], [true, true, 10, 2, true, 10]);
  assert.equal((await w.core.guestList.get(ana, 'e1')).isOwner, false);
});

test('validações da configuração', async () => {
  const { w, dono } = await setup();
  assert.equal(await code(w.core.guestList.configure(dono, 'e1', {})), 'VALIDATION');
  assert.equal(await code(w.core.guestList.configure(dono, 'e1', { enabled: true, limit: 0 })), 'VALIDATION');
  assert.equal(await code(w.core.guestList.configure(dono, 'e1', { enabled: true, maxCompanions: 6 })), 'VALIDATION');
  assert.equal(await code(w.core.guestList.configure(dono, 'e1', { enabled: true, closesAt: 'ontem' })), 'VALIDATION');
  assert.equal(await code(w.core.guestList.configure(dono, 'nao-existe', { enabled: true })), 'NOT_FOUND');
});

test('evento criado por pessoa não tem lista', async () => {
  const { w, ana } = await setup();
  const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;
  const ev = await w.core.posts.create(ana, { images: [JPEG], placeName: 'Casa', event: { title: 'Festa', startsAt: new Date(w.clock.now().getTime() + 60 * MIN).toISOString(), kind: 'OTHER' } });
  assert.equal((await w.core.guestList.get(ana, ev.id)).enabled, false);
  assert.equal(await code(w.core.guestList.configure(ana, ev.id, { enabled: true })), 'NOT_FOUND');
  assert.equal(await code(w.core.guestList.join(ana, ev.id)), 'NOT_FOUND');
});

test('nome na lista com acompanhantes, mudar, sair e confirmação na central de avisos', async () => {
  const { w, dono, ana, bia } = await setup();
  await w.core.guestList.configure(dono, 'e1', { enabled: true, maxCompanions: 2 });
  const joined = await w.core.guestList.join(ana, 'e1', { companions: 2 });
  assert.deepEqual([joined.mine, joined.count], [{ companions: 2, checkedIn: false }, 1]);
  await w.core.flushNotifications();
  const [n] = (await w.core.notifications.list(ana)).items.filter((i) => i.type === 'GUEST_LIST');
  assert.deepEqual([n?.title, n?.body, n?.url], ['Seu nome está na lista', '"Noite Neon" · você + 2', '/eventos/e1']);
  assert.equal(await code(w.core.guestList.join(bia, 'e1', { companions: 3 })), 'VALIDATION', 'acima do que o dono liberou');
  assert.equal(await code(w.core.guestList.join(bia, 'e1', { companions: -1 })), 'VALIDATION');
  // mudar os acompanhantes não repete o aviso
  assert.equal((await w.core.guestList.join(ana, 'e1', { companions: 1 })).mine?.companions, 1);
  await w.core.flushNotifications();
  assert.equal((await w.core.notifications.list(ana)).items.filter((i) => i.type === 'GUEST_LIST').length, 1);
  const left = await w.core.guestList.leave(ana, 'e1');
  assert.deepEqual([left.mine, left.count], [null, 0]);
  assert.equal((await w.core.guestList.leave(ana, 'e1')).count, 0, 'sair de novo não dá erro');
  // quem vê o evento só vê o total, nunca os nomes
  const other = await w.core.guestList.get(bia, 'e1');
  assert.equal('entries' in other, false);
});

test('limite de nomes: lista cheia recusa nome novo, mas quem já está pode mudar', async () => {
  const { w, dono, ana, bia, caio } = await setup();
  await w.core.guestList.configure(dono, 'e1', { enabled: true, limit: 2, maxCompanions: 3 });
  await w.core.guestList.join(ana, 'e1', { companions: 3 });
  await w.core.guestList.join(bia, 'e1');
  const full = await w.core.guestList.get(caio, 'e1');
  assert.deepEqual([full.spotsLeft, full.open], [0, false], 'acompanhantes não contam no limite');
  assert.equal(await code(w.core.guestList.join(caio, 'e1')), 'FORBIDDEN');
  assert.equal((await w.core.guestList.get(ana, 'e1')).open, true, 'quem está pode mudar');
  assert.equal((await w.core.guestList.join(ana, 'e1', { companions: 0 })).mine?.companions, 0);
  await w.core.guestList.leave(bia, 'e1');
  assert.equal((await w.core.guestList.join(caio, 'e1')).count, 2);
});

test('horário de fechamento e fim do evento', async () => {
  const { w, dono, ana, bia, t0 } = await setup();
  await w.core.guestList.configure(dono, 'e1', { enabled: true, closesAt: new Date(t0 + 60 * MIN).toISOString() });
  await w.core.guestList.join(ana, 'e1');
  w.clock.tick(61 * MIN);
  const closed = await w.core.guestList.get(bia, 'e1');
  assert.deepEqual([closed.enabled, closed.open], [true, false]);
  assert.equal(await code(w.core.guestList.join(bia, 'e1')), 'FORBIDDEN');
  assert.equal((await w.core.guestList.leave(ana, 'e1')).mine, null, 'sair continua possível');
  // sem horário: vale até o fim do evento
  await w.core.guestList.configure(dono, 'e1', { enabled: true });
  assert.equal((await w.core.guestList.join(bia, 'e1')).count, 1);
  w.clock.tick(300 * MIN);
  assert.equal(await code(w.core.guestList.join(ana, 'e1')), 'FORBIDDEN', 'o evento acabou');
});

test('bloqueio com o dono do local impede entrar na lista, nos dois sentidos', async () => {
  const { w, dono, ana, bia } = await setup();
  await w.core.guestList.configure(dono, 'e1', { enabled: true });
  await w.core.blocks.block(dono, ana);
  assert.equal(await code(w.core.guestList.join(ana, 'e1')), 'FORBIDDEN');
  await w.core.blocks.block(bia, dono);
  assert.equal(await code(w.core.guestList.join(bia, 'e1')), 'FORBIDDEN');
  assert.equal((await w.core.guestList.entries(dono, 'e1')).count, 0);
});

test('quem entrou e depois foi bloqueado some da lista do dono', async () => {
  const { w, dono, ana, bia } = await setup();
  await w.core.guestList.configure(dono, 'e1', { enabled: true });
  await w.core.guestList.join(ana, 'e1');
  await w.core.guestList.join(bia, 'e1');
  await w.core.blocks.block(dono, ana);
  assert.deepEqual((await w.core.guestList.entries(dono, 'e1')).entries.map((e) => e.user.username), ['bia']);
});

test('o dono vê nome, @usuário e acompanhantes; marca quem entrou; só ele vê', async () => {
  const { w, dono, ana, bia } = await setup();
  await w.core.guestList.configure(dono, 'e1', { enabled: true, maxCompanions: 3 });
  await w.core.guestList.join(ana, 'e1', { companions: 2 });
  w.clock.tick(MIN);
  await w.core.guestList.join(bia, 'e1');
  assert.equal(await code(w.core.guestList.entries(ana, 'e1')), 'FORBIDDEN');
  assert.equal(await code(w.core.guestList.checkIn(ana, 'e1', ana, true)), 'FORBIDDEN');
  assert.equal(await code(w.core.guestList.exportCsv(bia, 'e1')), 'FORBIDDEN');
  const view = await w.core.guestList.entries(dono, 'e1');
  assert.deepEqual(view.entries.map((e) => [e.user.username, e.companions, e.checkedIn]), [['ana', 2, false], ['bia', 0, false]]);
  assert.deepEqual([view.count, view.people, view.checkedInPeople], [2, 4, 0]);
  const after = await w.core.guestList.checkIn(dono, 'e1', ana, true);
  assert.deepEqual([after.checkedInPeople, after.entries[0]?.checkedIn], [3, true]);
  assert.equal((await w.core.guestList.get(ana, 'e1')).mine?.checkedIn, true);
  assert.equal((await w.core.guestList.checkIn(dono, 'e1', ana, false)).checkedInPeople, 0);
  assert.equal(await code(w.core.guestList.checkIn(dono, 'e1', 'ninguem', true)), 'NOT_FOUND');
  assert.equal(await code(w.core.guestList.checkIn(dono, 'e1', ana, 'sim')), 'VALIDATION');
});

test('CSV: cabeçalho, linhas, aspas e proteção contra fórmula de planilha', async () => {
  const { w, dono, ana, bia } = await setup();
  await w.core.guestList.configure(dono, 'e1', { enabled: true, maxCompanions: 1 });
  await w.core.guestList.join(ana, 'e1', { companions: 1 });
  await w.core.guestList.join(bia, 'e1');
  await w.core.guestList.checkIn(dono, 'e1', bia, true);
  const { filename, csv } = await w.core.guestList.exportCsv(dono, 'e1');
  assert.equal(filename, 'lista-e1.csv');
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], '"Nome","Usuário","Acompanhantes","Entrou"');
  assert.equal(lines.length, 3);
  assert.match(lines[1]!, /^".*","@ana",1,não$/);
  assert.match(lines[2]!, /^".*","@bia",0,sim$/);
  assert.equal(csvCell('=CMD()'), `"'=CMD()"`);
  assert.equal(csvCell('Ana "A" Silva'), '"Ana ""A"" Silva"');
});

test('desligar apaga os nomes; ligar de novo começa vazia', async () => {
  const { w, dono, ana } = await setup();
  await w.core.guestList.configure(dono, 'e1', { enabled: true });
  await w.core.guestList.join(ana, 'e1');
  const off = await w.core.guestList.configure(dono, 'e1', { enabled: false });
  assert.deepEqual([off.enabled, off.mine], [false, null]);
  const on = await w.core.guestList.configure(dono, 'e1', { enabled: true });
  assert.deepEqual([on.count, (await w.core.guestList.get(ana, 'e1')).mine], [0, null]);
});

test('silenciar eventos cala o push da confirmação, que segue no sino', async () => {
  const { w, dono, ana } = await setup();
  await w.core.notifications.subscribe(ana, { endpoint: 'https://push.example/ana', keys: { p256dh: 'abc', auth: 'def' } });
  await w.core.notifications.setMuteSettings(ana, { events: true });
  await w.core.guestList.configure(dono, 'e1', { enabled: true });
  await w.core.guestList.join(ana, 'e1');
  await w.core.flushNotifications();
  assert.equal((await w.core.notifications.list(ana)).items.filter((i) => i.type === 'GUEST_LIST').length, 1);
  assert.equal(w.push.sent.length, 0);
});
