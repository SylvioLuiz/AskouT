import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labelFromIcsUrl, mergeBusy, suggestionFromEmail } from './calendar-sync-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

// Relógio de teste: 2026-10-13T12:00Z.
const T = (iso: string) => new Date(iso);
const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:a
DTSTART:20261014T130000Z
DTEND:20261014T140000Z
SUMMARY:Consulta secreta
END:VEVENT
BEGIN:VEVENT
UID:b
DTSTART:20261014T133000Z
DTEND:20261014T150000Z
SUMMARY:Outra
END:VEVENT
END:VCALENDAR`;

test('sugestões: pelo e-mail e pelo login com o Google', () => {
  assert.equal(suggestionFromEmail('ana@gmail.com'), 'GOOGLE');
  assert.equal(suggestionFromEmail('ana@hotmail.com.br'), 'OUTLOOK');
  assert.equal(suggestionFromEmail('ana@outlook.com'), 'OUTLOOK');
  assert.equal(suggestionFromEmail('ana@icloud.com'), 'ICLOUD');
  assert.equal(suggestionFromEmail('ana@empresa.com.br'), undefined);
  assert.equal(labelFromIcsUrl('https://outlook.live.com/owa/calendar/x/reachcalendar.ics'), 'Outlook');
  assert.equal(labelFromIcsUrl('https://p01-caldav.icloud.com/published/2/abc'), 'iCloud');
});

test('mergeBusy junta sobrepostos e corta na janela', () => {
  const out = mergeBusy([{ start: T('2026-10-14T13:00Z'), end: T('2026-10-14T14:00Z') }, { start: T('2026-10-14T13:30Z'), end: T('2026-10-14T15:00Z') }, { start: T('2026-10-01T00:00Z'), end: T('2026-10-02T00:00Z') }], T('2026-10-13T00:00Z'), T('2026-10-20T00:00Z'));
  assert.deepEqual(out, [{ start: T('2026-10-14T13:00Z'), end: T('2026-10-14T15:00Z') }]);
});

test('visão geral: sugere Google para quem tem gmail e diz se o Google está configurado', async () => {
  const w = makeWorld();
  const ana = (await w.signUp('ana', { email: 'ana@gmail.com' })).user.id;
  const o = await w.core.calendarSync.overview(ana);
  assert.deepEqual(o.suggestions, [{ kind: 'GOOGLE', reason: 'email' }]);
  assert.equal(o.googleAvailable, true);
  assert.deepEqual(o.connections, []);
  const semGoogle = makeWorld({ noGoogleCalendar: true });
  const bia = (await semGoogle.signUp('bia')).user.id;
  assert.equal((await semGoogle.core.calendarSync.overview(bia)).googleAvailable, false);
  await rejectsWith(semGoogle.core.calendarSync.googleStart(bia, 'web'), 'VALIDATION');
});

test('agenda do celular: guarda as agendas escolhidas e só os horários (juntos), troca tudo a cada envio', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  const body = {
    calendars: [
      { id: '1', name: 'ana@gmail.com', account: 'Google', selected: true },
      { id: '2', name: 'Trabalho', account: 'Outlook', selected: false },
    ],
    intervals: [
      { start: '2026-10-14T13:00:00Z', end: '2026-10-14T14:00:00Z' },
      { start: '2026-10-14T13:30:00Z', end: '2026-10-14T15:00:00Z' },
      { start: 'lixo', end: 'x' },
    ],
  };
  const view = await w.core.calendarSync.saveDevice(ana!, body);
  assert.equal(view.label, 'Agenda do celular');
  assert.equal(view.calendars.filter((c) => c.selected).length, 1);
  const busy = await w.core.calendarSync.busy(ana!, '2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z');
  assert.deepEqual(busy.map((b) => [b.start, b.end]), [['2026-10-14T13:00:00.000Z', '2026-10-14T15:00:00.000Z']]);
  await w.core.calendarSync.saveDevice(ana!, { ...body, intervals: [] });
  assert.equal((await w.core.calendarSync.overview(ana!)).connections.length, 1, 'uma conexão do celular por pessoa');
  assert.equal((await w.core.calendarSync.busy(ana!, '2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z')).length, 0);
  await rejectsWith(w.core.calendarSync.saveDevice(ana!, { calendars: [{ id: '1', name: 'x', selected: false }], intervals: [] }), 'VALIDATION');
});

test('link iCal: lê na hora, guarda o link cifrado e nunca o título', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  const url = 'https://outlook.live.com/owa/calendar/abc/reachcalendar.ics';
  w.calendarFetcher.texts.set(url, ICS);
  const view = await w.core.calendarSync.addIcs(ana!, { url: url.replace('https://', 'webcal://') });
  assert.equal(view.label, 'Outlook');
  const row = [...w.personalCalendars.rows.values()][0]!;
  assert.ok(row.sourceSealed && !row.sourceSealed.includes('outlook'), 'link cifrado');
  assert.ok(!JSON.stringify(row).includes('Consulta secreta'));
  const busy = await w.core.calendarSync.busy(ana!, '2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z');
  assert.deepEqual(busy.map((b) => [b.start, b.end, b.label]), [['2026-10-14T13:00:00.000Z', '2026-10-14T15:00:00.000Z', 'Outlook']]);
  await rejectsWith(w.core.calendarSync.addIcs(ana!, { url }), 'VALIDATION'); // repetida
  w.calendarFetcher.texts.set('https://exemplo.com/nada', '<html></html>');
  await rejectsWith(w.core.calendarSync.addIcs(ana!, { url: 'https://exemplo.com/nada' }), 'VALIDATION');
  await rejectsWith(w.core.calendarSync.addIcs(ana!, { url: 'http://localhost/x.ics' }), 'VALIDATION');
});

test('Google Agenda: state assinado, importa principal e visíveis, escolha muda o que entra, remover revoga', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  const google = w.googleCalendar!;
  google.busy.set('primary@gmail.com', [{ start: T('2026-10-15T20:00Z'), end: T('2026-10-15T21:00Z') }]);
  google.busy.set('trabalho', [{ start: T('2026-10-16T12:00Z'), end: T('2026-10-16T18:00Z') }]);
  google.busy.set('feriados', [{ start: T('2026-10-17T00:00Z'), end: T('2026-10-18T00:00Z') }]);

  const { url } = await w.core.calendarSync.googleStart(ana!, 'app');
  const state = new URL(url).searchParams.get('state')!;
  assert.deepEqual(await w.core.calendarSync.googleCallback({ code: 'codigo-bom', state: 'forjado' }), { from: 'web', ok: false, message: 'O pedido venceu. Tente ligar a Google Agenda de novo.' });
  assert.equal((await w.core.calendarSync.googleCallback({ error: 'access_denied', state })).ok, false);
  const r = await w.core.calendarSync.googleCallback({ code: 'codigo-bom', state });
  assert.deepEqual(r, { from: 'app', ok: true });

  const [conn] = (await w.core.calendarSync.overview(ana!)).connections;
  assert.equal(conn!.label, 'Google · ana@gmail.com');
  assert.deepEqual(conn!.calendars.map((c) => [c.id, c.selected]), [['primary@gmail.com', true], ['trabalho', true], ['feriados', false]]);
  const week = () => w.core.calendarSync.busy(ana!, '2026-10-13T00:00:00Z', '2026-10-20T00:00:00Z');
  assert.equal((await week()).length, 2);
  assert.equal((await w.core.calendarSync.busy(bia!, '2026-10-13T00:00:00Z', '2026-10-20T00:00:00Z')).length, 0, 'só da própria pessoa');

  await w.core.calendarSync.setSelection(ana!, conn!.id, { calendarIds: ['feriados'] });
  assert.deepEqual((await week()).map((b) => b.start), ['2026-10-17T00:00:00.000Z']);
  await rejectsWith(w.core.calendarSync.setSelection(bia!, conn!.id, { calendarIds: ['feriados'] }), 'FORBIDDEN');

  // Ligar a mesma conta de novo não duplica.
  const again = new URL((await w.core.calendarSync.googleStart(ana!, 'web')).url).searchParams.get('state')!;
  await w.core.calendarSync.googleCallback({ code: 'codigo-bom', state: again });
  assert.equal((await w.core.calendarSync.overview(ana!)).connections.length, 1);

  await w.core.calendarSync.remove(ana!, conn!.id);
  assert.deepEqual(google.revokedTokens, ['refresh-1']);
  assert.equal((await week()).length, 0);
});

test('Google tirou o acesso: o job marca para reconectar e os horários saem; o motor de amigos usa os ocupados', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await w.core.follows.follow(ana!, bia!);
  await w.core.follows.follow(bia!, ana!);
  const google = w.googleCalendar!;
  google.busy.set('primary@gmail.com', [{ start: T('2026-10-15T20:00Z'), end: T('2026-10-15T23:00Z') }]);
  const { url } = await w.core.calendarSync.googleStart(bia!, 'web');
  await w.core.calendarSync.googleCallback({ code: 'codigo-bom', state: new URL(url).searchParams.get('state')! });

  const q = { friendIds: [bia!], start: '2026-10-15T20:30:00Z', end: '2026-10-15T21:30:00Z' };
  const view = await w.core.availability.compatibility(ana!, q);
  assert.equal(view.participants.find((p) => !p.isMe)?.status, 'unavailable', 'agenda ligada conta como ocupado');

  google.revoked = true;
  w.clock.tick(31 * 60_000);
  assert.deepEqual(await w.core.calendarSync.runDue(), { synced: 1 });
  const [conn] = (await w.core.calendarSync.overview(bia!)).connections;
  assert.equal(conn!.status, 'REVOKED');
  assert.match(conn!.lastError ?? '', /de novo/);
  assert.notEqual((await w.core.availability.compatibility(ana!, q)).participants.find((p) => !p.isMe)?.status, 'unavailable');
  assert.deepEqual(await w.core.calendarSync.runDue(), { synced: 0 }, 'revogada não é relida');
});

test('Outlook (Microsoft): mesmo fluxo, state de um provedor não vale no outro', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  w.microsoftCalendar!.email = 'ana@outlook.com';
  w.microsoftCalendar!.busy.set('primary@gmail.com', [{ start: T('2026-10-15T20:00Z'), end: T('2026-10-15T21:00Z') }]);
  const { url } = await w.core.calendarSync.oauthStart(ana!, 'MICROSOFT', 'web');
  const state = new URL(url).searchParams.get('state')!;
  assert.equal((await w.core.calendarSync.oauthCallback('GOOGLE', { code: 'codigo-bom', state })).ok, false, 'state do Outlook no retorno do Google');
  assert.deepEqual(await w.core.calendarSync.oauthCallback('MICROSOFT', { code: 'codigo-bom', state }), { from: 'web', ok: true });
  const o = await w.core.calendarSync.overview(ana!);
  assert.equal(o.microsoftAvailable, true);
  assert.equal(o.connections[0]!.provider, 'MICROSOFT');
  assert.equal(o.connections[0]!.label, 'Outlook · ana@outlook.com');
  assert.equal((await w.core.calendarSync.busy(ana!, '2026-10-13T00:00:00Z', '2026-10-20T00:00:00Z')).length, 1);
});
