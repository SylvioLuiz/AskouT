import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeWorld } from './testing/world.ts';
import { DomainError } from './errors.ts';
import { atLocalHour, dueReminder, reminderAt, reminderText } from './event-reminders.ts';

const MIN = 60_000;
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;

// O relógio dos testes começa em 2026-10-13T12:00Z, 9h em São Paulo.
async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio');
  const ana = u['ana']!, bia = u['bia']!, caio = u['caio']!;
  await w.places.createVenue({ id: 'v1', name: 'Parque Ibirapuera', address: 'Av. Pedro Álvares Cabral', category: 'park', lat: -23.58, lng: -46.65, isSample: true });
  const t0 = w.clock.now().getTime();
  await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Piquenique', description: null, kind: 'OUTDOOR', isFree: true, imageUrl: null, tags: [], startsAt: new Date(t0 + 120 * MIN), endsAt: new Date(t0 + 240 * MIN), isSample: true });
  await w.core.eventPages.go(bia, 'e1');
  await w.core.notifications.subscribe(bia, { endpoint: 'https://push.example/bia', keys: { p256dh: 'abc', auth: 'def' } });
  const goTo = (iso: string) => w.clock.tick(Date.parse(iso) - w.clock.now().getTime());
  const event = async (id: string, startsIso: string) => {
    const startsAt = new Date(startsIso);
    await w.places.createEvent({ id, venueId: 'v1', title: 'Show', description: null, kind: 'MUSIC', isFree: true, imageUrl: null, tags: [], startsAt, endsAt: new Date(startsAt.getTime() + 180 * MIN), isSample: true });
  };
  return { w, ana, bia, caio, t0, goTo, event };
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
  assert.deepEqual([n?.title, n?.body, n?.url], ['Começa daqui a pouco', '"Piquenique" · em 29 min · Parque Ibirapuera', '/eventos/e1']);
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
  assert.equal(mine?.title, 'Começa daqui a pouco', 'criou o evento depois das 9h: sem "É hoje!"');
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

test('padrão: "É hoje!" às 9h do dia do evento e "Começa daqui a pouco" 30 min antes, cada um uma vez', async () => {
  const { w, bia, goTo, event } = await setup();
  await event('e2', '2026-10-14T23:00:00Z'); // 20h em São Paulo, amanhã
  await w.core.eventPages.go(bia, 'e2');
  await w.core.eventPages.cancel(bia, 'e1');
  goTo('2026-10-14T11:55:00Z');
  assert.equal(await w.core.eventReminders.sendDue(), 0, '8h55: ainda não');
  goTo('2026-10-14T12:00:00Z');
  assert.equal(await w.core.eventReminders.sendDue(), 1, '9h: É hoje!');
  goTo('2026-10-14T12:05:00Z');
  assert.equal(await w.core.eventReminders.sendDue(), 0, 'não repete');
  goTo('2026-10-14T22:31:00Z');
  assert.equal(await w.core.eventReminders.sendDue(), 1, '29 min antes');
  await w.core.flushNotifications();
  const got = (await reminders(w, bia)).map((n) => [n.title, n.body]);
  assert.deepEqual(got, [
    ['Começa daqui a pouco', '"Show" · em 29 min · Parque Ibirapuera'],
    ['É hoje!', '"Show" · hoje às 20:00 · Parque Ibirapuera'],
  ]);
  assert.equal(w.push.sent.length, 2, 'cada lembrete é um push');
});

test('quem confirma depois da manhã não recebe "É hoje!"; evento cedo também não', async () => {
  const { w, bia, goTo, event } = await setup();
  await w.core.eventPages.cancel(bia, 'e1');
  await event('tarde', '2026-10-13T23:00:00Z'); // 20h de hoje; bia confirma às 11h
  await event('cedo', '2026-10-14T12:30:00Z'); // 9h30 de amanhã
  goTo('2026-10-13T14:00:00Z');
  await w.core.eventPages.go(bia, 'tarde');
  await w.core.eventPages.go(bia, 'cedo');
  for (const at of ['2026-10-13T14:05:00Z', '2026-10-13T18:00:00Z', '2026-10-13T22:31:00Z', '2026-10-14T11:00:00Z', '2026-10-14T12:01:00Z']) {
    goTo(at);
    await w.core.eventReminders.sendDue();
  }
  await w.core.flushNotifications();
  assert.deepEqual((await reminders(w, bia)).map((n) => n.title), ['Começa daqui a pouco', 'Começa daqui a pouco'], 'só os de 30 min');
});

test('escolha geral: quantos lembretes e quanto tempo antes', async () => {
  const { w, bia, goTo, event } = await setup();
  await w.core.eventPages.cancel(bia, 'e1');
  assert.deepEqual(await w.core.notifications.eventReminderSettings(bia), { reminders: ['manha', '30m'], custom: false });
  const saved = await w.core.notifications.setEventReminderSettings(bia, { reminders: ['15m', '1d', '2h'], timeZone: 'America/Sao_Paulo' });
  assert.deepEqual(saved, { reminders: ['1d', '2h', '15m'], custom: true }, 'fica na ordem do mais cedo ao mais perto');
  await event('e2', '2026-10-14T23:00:00Z');
  await w.core.eventPages.go(bia, 'e2');
  const steps: [string, number][] = [
    ['2026-10-13T22:55:00Z', 0],
    ['2026-10-13T23:00:00Z', 1], // 1 dia antes
    ['2026-10-14T12:00:00Z', 0], // sem "É hoje!"
    ['2026-10-14T21:00:00Z', 1], // 2 h antes
    ['2026-10-14T22:30:00Z', 0], // sem 30 min
    ['2026-10-14T22:45:00Z', 1], // 15 min antes
  ];
  for (const [at, n] of steps) {
    goTo(at);
    assert.equal(await w.core.eventReminders.sendDue(), n, at);
  }
  await w.core.flushNotifications();
  assert.deepEqual((await reminders(w, bia)).map((n) => [n.title, n.body]).reverse(), [
    ['É amanhã!', '"Show" · amanhã às 20:00 · Parque Ibirapuera'],
    ['Começa em 2 h', '"Show" · hoje às 20:00 · Parque Ibirapuera'],
    ['Começa daqui a pouco', '"Show" · em 15 min · Parque Ibirapuera'],
  ]);
  await w.core.notifications.setEventReminderSettings(bia, { reminders: [] });
  assert.deepEqual(await w.core.notifications.eventReminderSettings(bia), { reminders: [], custom: true }, 'lista vazia: nenhum lembrete');
  await w.core.notifications.setEventReminderSettings(bia, { reminders: null });
  assert.deepEqual(await w.core.notifications.eventReminderSettings(bia), { reminders: ['manha', '30m'], custom: false }, 'null volta ao padrão');
  await assert.rejects(w.core.notifications.setEventReminderSettings(bia, { reminders: ['3h'] }), DomainError);
  await assert.rejects(w.core.notifications.setEventReminderSettings(bia, { reminders: ['30m'], timeZone: 'Lua/Base' }), DomainError);
});

test('escolha do evento vale no lugar da geral', async () => {
  const { w, bia, caio, goTo } = await setup();
  await w.core.eventPages.go(caio, 'e1');
  await w.core.notifications.setEventReminderSettings(caio, { reminders: ['15m'] });
  assert.deepEqual(await w.core.eventPages.reminders(bia, 'e1'), { reminders: ['manha', '30m'], custom: false, general: ['manha', '30m'] });
  assert.deepEqual(await w.core.eventPages.setReminders(bia, 'e1', ['1h']), { reminders: ['1h'], custom: true, general: ['manha', '30m'] });
  await w.core.eventPages.setReminders(caio, 'e1', []);
  const t0 = w.clock.now().getTime();
  goTo(new Date(t0 + 60 * MIN).toISOString());
  assert.equal(await w.core.eventReminders.sendDue(), 1, 'bia: 1 h antes');
  goTo(new Date(t0 + 91 * MIN).toISOString());
  assert.equal(await w.core.eventReminders.sendDue(), 0, 'bia trocou os 30 min do padrão pela 1 h');
  goTo(new Date(t0 + 106 * MIN).toISOString());
  assert.equal(await w.core.eventReminders.sendDue(), 0, 'caio desligou neste evento, mesmo com 15 min no geral');
  await w.core.flushNotifications();
  assert.deepEqual((await reminders(w, bia)).map((n) => n.title), ['Começa em 1 h']);
  assert.deepEqual(await w.core.eventPages.setReminders(bia, 'e1', null), { reminders: ['manha', '30m'], custom: false, general: ['manha', '30m'] }, 'volta a seguir a geral');
  await assert.rejects(w.core.eventPages.setReminders(bia, 'e1', 'manha'), DomainError);
});

test('"É hoje!" sai às 9h no fuso da pessoa', () => {
  const start = new Date('2026-10-15T00:00:00Z'); // 21h em São Paulo, 20h em Manaus
  assert.equal(reminderAt('manha', start, 'America/Sao_Paulo')?.toISOString(), '2026-10-14T12:00:00.000Z');
  assert.equal(reminderAt('manha', start, 'America/Manaus')?.toISOString(), '2026-10-14T13:00:00.000Z');
  assert.equal(reminderAt('manha', start, null)?.toISOString(), '2026-10-14T12:00:00.000Z', 'sem fuso: São Paulo');
  assert.equal(reminderAt('manha', new Date('2026-10-14T12:30:00Z'), 'America/Sao_Paulo'), null, 'evento às 9h30: sem "É hoje!"');
  assert.equal(atLocalHour('2026-03-29', 9, 'Europe/Lisbon').toISOString(), '2026-03-29T08:00:00.000Z', 'horário de verão');
  assert.equal(reminderText({ option: 'manha', title: 'Show', where: null, startsAt: start, now: new Date('2026-10-14T13:00:00Z'), timeZone: 'America/Manaus' }).body, '"Show" · hoje às 20:00');
});

test('lembrete atrasado demais não sai, e quem confirmou depois do horário não é lembrado', () => {
  const startsAt = new Date('2026-10-14T23:00:00Z');
  const joinedAt = new Date('2026-10-01T00:00:00Z');
  assert.deepEqual(dueReminder({ options: ['1d'], startsAt, joinedAt, now: new Date('2026-10-14T12:00:00Z'), timeZone: null }), { send: null, skip: [] }, '1 dia antes, mas já é o dia');
  assert.deepEqual(dueReminder({ options: ['1h', '30m'], startsAt, joinedAt, now: new Date('2026-10-14T22:40:00Z'), timeZone: null }), { send: '30m', skip: ['1h'] }, 'os dois vencidos: sai só o mais perto');
  assert.deepEqual(dueReminder({ options: ['30m'], startsAt, joinedAt: new Date('2026-10-14T22:40:00Z'), now: new Date('2026-10-14T22:41:00Z'), timeZone: null }), { send: null, skip: [] }, 'confirmou faltando 20 min');
});
