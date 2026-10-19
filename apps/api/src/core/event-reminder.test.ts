import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeWorld } from './testing/world.ts';

const MIN = 60_000;
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio');
  const ana = u['ana']!, bia = u['bia']!, caio = u['caio']!;
  await w.places.createVenue({ id: 'v1', name: 'Parque Ibirapuera', address: 'Av. Pedro Álvares Cabral', category: 'park', lat: -23.58, lng: -46.65, isSample: true });
  const t0 = w.clock.now().getTime();
  await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Piquenique', description: null, kind: 'OUTDOOR', isFree: true, imageUrl: null, tags: [], startsAt: new Date(t0 + 120 * MIN), endsAt: new Date(t0 + 240 * MIN), isSample: true });
  await w.core.eventPages.go(bia, 'e1');
  await w.core.notifications.subscribe(bia, { endpoint: 'https://push.example/bia', keys: { p256dh: 'abc', auth: 'def' } });
  return { w, ana, bia, caio, t0 };
}

const reminders = async (w: Awaited<ReturnType<typeof setup>>['w'], userId: string) => (await w.core.notifications.list(userId)).items.filter((n) => n.type === 'EVENT_REMINDER');

test('lembrete 30 min antes: só quem confirmou, uma vez só, e só dentro da janela', async () => {
  const { w, bia, caio } = await setup();
  w.clock.tick(60 * MIN);
  assert.equal(await w.core.eventReminders.sendDue(), 0, 'faltam 60 min: ainda é cedo');
  w.clock.tick(31 * MIN);
  assert.equal(await w.core.eventReminders.sendDue(), 1, 'faltam 29 min: sai');
  await w.core.flushNotifications();
  const [n] = await reminders(w, bia);
  assert.deepEqual([n?.title, n?.body, n?.url], ['Começa em 29 min', '"Piquenique" · Parque Ibirapuera', '/eventos/e1']);
  assert.equal(w.push.sent.length, 1, 'o push saiu para o aparelho');
  assert.equal((await reminders(w, caio)).length, 0, 'quem não confirmou não recebe');
  w.clock.tick(MIN);
  assert.equal(await w.core.eventReminders.sendDue(), 0, 'não repete');
  w.clock.tick(40 * MIN);
  assert.equal(await w.core.eventReminders.sendDue(), 0, 'depois que começou, nada');
});

test('quem cancelou a presença não recebe; o dono de evento de pessoa recebe', async () => {
  const { w, ana, bia } = await setup();
  await w.core.eventPages.cancel(bia, 'e1');
  const start = new Date(w.clock.now().getTime() + 100 * MIN).toISOString();
  const ev = await w.core.posts.create(ana, { images: [JPEG], placeName: 'Praça', event: { title: 'Corrida', startsAt: start, kind: 'SPORT' } });
  w.clock.tick(80 * MIN);
  assert.equal(await w.core.eventReminders.sendDue(), 1, 'só o dono do evento de pessoa; o do local ficou sem confirmados');
  assert.equal((await reminders(w, bia)).length, 0);
  const [mine] = await reminders(w, ana);
  assert.equal(mine?.url, `/eventos/${ev.id}`);
});

test('silenciar eventos cala o push do lembrete, mas ele continua no sino', async () => {
  const { w, bia } = await setup();
  await w.core.notifications.setMuteSettings(bia, { events: true });
  w.clock.tick(95 * MIN);
  assert.equal(await w.core.eventReminders.sendDue(), 1);
  await w.core.flushNotifications();
  assert.equal((await reminders(w, bia)).length, 1);
  assert.equal(w.push.sent.length, 0);
});
