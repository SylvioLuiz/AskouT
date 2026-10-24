import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeCalendarUrl } from './calendar-import-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const D = 24 * H;
const URL1 = 'https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-123/basic.ics';

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ev = (uid: string, start: Date, summary: string, extra: string[] = []) => ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + 3 * H))}`, `SUMMARY:${summary}`, ...extra, 'END:VEVENT'].join('\r\n');
const ics = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('dono', 'outro');
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: -23.58, lng: -46.65, isSample: false });
  await w.places.setVenueOwner('v1', u['dono']!);
  const base = w.clock.now().getTime();
  const at = (days: number) => new Date(base + days * D);
  const owned = async () => (await w.core.notifications.list(u['dono']!)).items.filter((n) => n.type === 'VENUE_CALENDAR');
  return { w, dono: u['dono']!, outro: u['outro']!, at, owned };
}

test('endereço da agenda: aceita https e webcal, recusa o resto', () => {
  assert.equal(normalizeCalendarUrl('webcal://calendar.google.com/x.ics'), 'https://calendar.google.com/x.ics');
  assert.equal(normalizeCalendarUrl(' https://exemplo.com.br/agenda.ics '), 'https://exemplo.com.br/agenda.ics');
  for (const bad of ['', 'http://exemplo.com/a.ics', 'ftp://exemplo.com/a', 'https://localhost/a.ics', 'https://127.0.0.1/a.ics', 'https://10.0.0.1/a', 'https://usuario:senha@exemplo.com/a', 'https://intranet/a', 'texto', 42]) {
    assert.throws(() => normalizeCalendarUrl(bad), { code: 'VALIDATION' }, String(bad));
  }
});

test('ligar a agenda lê na hora e cria rascunhos; o link nunca volta inteiro', async () => {
  const { w, dono, at } = await setup();
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(8), 'Samba de Raiz', ['DESCRIPTION:Roda aberta<br>com <b>feijoada</b>', 'URL:https://ingresso.exemplo/1']), ev('b', at(9), 'Forró')));
  const panel = await w.core.calendarImport.save(dono, 'v1', { url: URL1, leadDays: 7 });
  assert.equal(panel.calendar?.host, 'calendar.google.com');
  assert.equal(panel.calendar?.leadDays, 7);
  assert.equal(panel.calendar?.lastFound, 2);
  assert.equal(JSON.stringify(panel).includes('private-123'), false, 'o segredo do link não vaza');
  assert.deepEqual(panel.drafts.map((d) => d.title), ['Samba de Raiz', 'Forró']);
  const first = panel.drafts[0]!;
  assert.equal(first.status, 'WAITING');
  assert.equal(first.description, 'Roda aberta\ncom feijoada');
  assert.equal(first.ticketUrl, 'https://ingresso.exemplo/1');
  assert.equal(first.publishAt, at(1).toISOString(), 'sobe 7 dias antes do evento');
  assert.equal((await w.places.listVenueEvents('v1')).length, 0, 'nada sobe sozinho');
});

test('só quem administra o local mexe na agenda', async () => {
  const { w, dono, outro, at } = await setup();
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(8), 'Show')));
  await rejectsWith(w.core.calendarImport.save(outro, 'v1', { url: URL1 }), 'NOT_FOUND');
  await rejectsWith(w.core.calendarImport.panel(outro, 'v1'), 'NOT_FOUND');
  await w.core.calendarImport.save(dono, 'v1', { url: URL1 });
  const id = (await w.core.calendarImport.panel(dono, 'v1')).drafts[0]!.id;
  await rejectsWith(w.core.calendarImport.approve(outro, 'v1', id), 'NOT_FOUND');
  await rejectsWith(w.core.calendarImport.dismiss(outro, 'v1', id), 'NOT_FOUND');
  await rejectsWith(w.core.calendarImport.editDraft(outro, 'v1', id, { title: 'x' }), 'NOT_FOUND');
  await rejectsWith(w.core.calendarImport.remove(outro, 'v1'), 'NOT_FOUND');
});

test('endereço que não é agenda ou não abre não é salvo, e dias fora de 1 a 30 são recusados', async () => {
  const { w, dono, at } = await setup();
  w.calendarFetcher.texts.set(URL1, '<html>entrar</html>');
  await rejectsWith(w.core.calendarImport.save(dono, 'v1', { url: URL1 }), 'VALIDATION');
  w.calendarFetcher.errors.set(URL1, 'A agenda não foi encontrada. Confira o endereço.');
  await rejectsWith(w.core.calendarImport.save(dono, 'v1', { url: URL1 }), 'VALIDATION');
  assert.equal((await w.core.calendarImport.panel(dono, 'v1')).calendar, null);
  w.calendarFetcher.errors.clear();
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(5), 'Show')));
  for (const leadDays of [0, 31, 2.5, '7', null]) await rejectsWith(w.core.calendarImport.save(dono, 'v1', { url: URL1, leadDays }), 'VALIDATION');
  await rejectsWith(w.core.calendarImport.save(dono, 'v1', { leadDays: 5 }), 'VALIDATION');
});

test('um dia antes de subir o dono recebe a prévia; aprovado, sobe na data; sem aprovar, nunca sobe', async () => {
  const { w, dono, at, owned } = await setup();
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(7), 'Samba de Raiz'), ev('b', at(7.5), 'Forró')));
  await w.core.calendarImport.save(dono, 'v1', { url: URL1, leadDays: 5 });
  // Samba sobe no dia 2 (aviso no dia 1); Forró sobe no dia 2,5 (aviso no dia 1,5).
  w.clock.tick(0.5 * D);
  await w.core.calendarImport.runDue();
  assert.equal((await owned()).length, 0, 'ainda cedo');
  w.clock.tick(0.7 * D); // dia 1,2
  const r1 = await w.core.calendarImport.runDue();
  assert.equal(r1.notified, 1);
  const notes = await owned();
  assert.equal(notes.length, 1);
  assert.match(notes[0]!.title, /Aprovar "Samba de Raiz"\?/);
  assert.match(notes[0]!.body, /sobe/);
  assert.equal(notes[0]!.url, '/bares/v1/agenda');
  await w.core.calendarImport.runDue();
  assert.equal((await owned()).length, 1, 'não avisa duas vezes');
  const samba = (await w.core.calendarImport.panel(dono, 'v1')).drafts.find((d) => d.title === 'Samba de Raiz')!;
  assert.equal(samba.status, 'AWAITING');
  await w.core.calendarImport.approve(dono, 'v1', samba.id);
  assert.equal((await w.places.listVenueEvents('v1')).length, 0, 'aprovado, mas ainda não chegou a data');
  w.clock.tick(1 * D); // dia 2,2
  const r2 = await w.core.calendarImport.runDue();
  assert.equal(r2.published, 1);
  const events = await w.places.listVenueEvents('v1');
  assert.deepEqual(events.map((e) => e.title), ['Samba de Raiz']);
  assert.equal(events[0]!.startsAt.toISOString(), at(7).toISOString());
  assert.ok((await owned()).some((n) => /já está no AskouT/.test(n.title)));
  // O Forró recebeu aviso, mas ninguém aprovou: não sobe.
  w.clock.tick(3 * D);
  await w.core.calendarImport.runDue();
  assert.deepEqual((await w.places.listVenueEvents('v1')).map((e) => e.title), ['Samba de Raiz']);
  await w.core.calendarImport.runDue();
  assert.equal((await w.places.listVenueEvents('v1')).length, 1, 'rodar de novo não duplica');
});

test('vários eventos na hora do aviso viram uma notificação só', async () => {
  const { w, dono, at, owned } = await setup();
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(2), 'Um'), ev('b', at(3), 'Dois'), ev('c', at(3.5), 'Três')));
  await w.core.calendarImport.save(dono, 'v1', { url: URL1, leadDays: 7 });
  const r = await w.core.calendarImport.runDue();
  assert.equal(r.notified, 1);
  const notes = await owned();
  assert.equal(notes.length, 1);
  assert.match(notes[0]!.title, /3 eventos para aprovar/);
});

test('aprovar quando a data de subir já passou publica na hora', async () => {
  const { w, dono, at } = await setup();
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(2), 'Chegou em cima')));
  const panel = await w.core.calendarImport.save(dono, 'v1', { url: URL1, leadDays: 7 });
  const res = await w.core.calendarImport.approve(dono, 'v1', panel.drafts[0]!.id);
  assert.ok('published' in res && res.published);
  assert.equal((await w.places.listVenueEvents('v1')).length, 1);
  await rejectsWith(w.core.calendarImport.approve(dono, 'v1', panel.drafts[0]!.id), 'CONFLICT');
});

test('o dono edita tudo antes de aprovar e a agenda não sobrescreve mais', async () => {
  const { w, dono, at } = await setup();
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(8), 'Samba')));
  const id = (await w.core.calendarImport.save(dono, 'v1', { url: URL1, leadDays: 7 })).drafts[0]!.id;
  const edited = await w.core.calendarImport.editDraft(dono, 'v1', id, { title: 'Samba da Madrugada', description: 'Entrada grátis', kind: 'SHOW', isFree: true, tags: ['Samba', 'ao vivo'], startsAt: at(9).toISOString(), endsAt: at(9.2).toISOString(), imageUrl: 'https://img.exemplo/c.jpg', ticketUrl: 'https://tickets.exemplo/s' });
  assert.equal(edited.title, 'Samba da Madrugada');
  assert.equal(edited.kind, 'SHOW');
  assert.equal(edited.isFree, true);
  assert.equal(edited.edited, true);
  assert.equal(edited.publishAt, at(2).toISOString(), 'a data de subir acompanha o novo início');
  assert.equal(edited.imageUrl, 'https://img.exemplo/c.jpg');
  // A agenda muda o título lá, mas o rascunho editado fica como o dono deixou.
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(8), 'Samba (mudou na agenda)')));
  w.clock.tick(7 * H);
  await w.core.calendarImport.runDue();
  assert.equal((await w.core.calendarImport.panel(dono, 'v1')).drafts[0]!.title, 'Samba da Madrugada');
  // Edição inválida é recusada e nada muda.
  await rejectsWith(w.core.calendarImport.editDraft(dono, 'v1', id, { title: '' }), 'VALIDATION');
  await rejectsWith(w.core.calendarImport.editDraft(dono, 'v1', id, { title: 'x', startsAt: at(-3).toISOString() }), 'VALIDATION');
  await rejectsWith(w.core.calendarImport.editDraft(dono, 'v1', id, { title: 'x', imageData: 'data:image/png;base64,iVBORw0KGgo=' }), 'VALIDATION');
  await rejectsWith(w.core.calendarImport.editDraft(dono, 'v1', id, { title: 'x', ticketUrl: 'http://inseguro.exemplo' }), 'VALIDATION');
  // Publicado com os dados editados.
  await w.core.calendarImport.approve(dono, 'v1', id);
  w.clock.tick(5 * D);
  await w.core.calendarImport.runDue();
  const event = (await w.places.listVenueEvents('v1'))[0]!;
  assert.equal(event.title, 'Samba da Madrugada');
  assert.equal(event.ticketUrl, 'https://tickets.exemplo/s');
  assert.deepEqual(event.tags, ['samba', 'aovivo']);
});

test('dispensar tira da fila e a agenda não traz de volta; o que sumiu da agenda sai da fila', async () => {
  const { w, dono, at } = await setup();
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(8), 'Um'), ev('b', at(9), 'Dois')));
  const panel = await w.core.calendarImport.save(dono, 'v1', { url: URL1, leadDays: 7 });
  await w.core.calendarImport.dismiss(dono, 'v1', panel.drafts.find((d) => d.title === 'Um')!.id);
  w.clock.tick(7 * H);
  await w.core.calendarImport.runDue();
  assert.deepEqual((await w.core.calendarImport.panel(dono, 'v1')).drafts.map((d) => d.title), ['Dois']);
  // "Dois" foi apagado na agenda.
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(8), 'Um')));
  w.clock.tick(7 * H);
  await w.core.calendarImport.runDue();
  assert.deepEqual((await w.core.calendarImport.panel(dono, 'v1')).drafts, []);
});

test('mudou o horário na agenda: o que estava aprovado volta a pedir aprovação', async () => {
  const { w, dono, at } = await setup();
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(8), 'Samba')));
  const id = (await w.core.calendarImport.save(dono, 'v1', { url: URL1, leadDays: 7 })).drafts[0]!.id;
  await w.core.calendarImport.approve(dono, 'v1', id);
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(9), 'Samba')));
  w.clock.tick(7 * H);
  await w.core.calendarImport.runDue();
  const d = (await w.core.calendarImport.panel(dono, 'v1')).drafts[0]!;
  assert.equal(d.startsAt, at(9).toISOString());
  assert.equal(d.status === 'WAITING' || d.status === 'AWAITING', true);
});

test('mudar os dias de antecedência refaz a data de subir', async () => {
  const { w, dono, at } = await setup();
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(16), 'Samba')));
  const p1 = await w.core.calendarImport.save(dono, 'v1', { url: URL1, leadDays: 14 });
  assert.equal(p1.drafts[0]!.publishAt, at(2).toISOString());
  const p2 = await w.core.calendarImport.save(dono, 'v1', { leadDays: 3 });
  assert.equal(p2.calendar?.leadDays, 3);
  assert.equal(p2.drafts[0]!.publishAt, at(13).toISOString());
  assert.equal(w.calendarFetcher.calls.length, 1, 'mudar só os dias não lê a agenda de novo');
});

test('falha de leitura fica anotada sem apagar os rascunhos; "atualizar agora" tem intervalo mínimo', async () => {
  const { w, dono, at } = await setup();
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(8), 'Samba')));
  await w.core.calendarImport.save(dono, 'v1', { url: URL1 });
  await rejectsWith(w.core.calendarImport.syncNow(dono, 'v1'), 'CONFLICT');
  w.clock.tick(7 * H);
  w.calendarFetcher.errors.set(URL1, 'Não foi possível abrir a agenda');
  const r = await w.core.calendarImport.runDue();
  assert.equal(r.synced, 0);
  const panel = await w.core.calendarImport.panel(dono, 'v1');
  assert.equal(panel.calendar?.lastError, 'Não foi possível abrir a agenda');
  assert.equal(panel.drafts.length, 1);
  w.calendarFetcher.errors.clear();
  w.clock.tick(2 * 60_000);
  const ok = await w.core.calendarImport.syncNow(dono, 'v1');
  assert.equal(ok.calendar?.lastError, null);
});

test('agenda desligada não é lida; remover apaga a fila mas não os eventos que já subiram', async () => {
  const { w, dono, at } = await setup();
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(2), 'Já sobe'), ev('b', at(20), 'Longe')));
  const p = await w.core.calendarImport.save(dono, 'v1', { url: URL1, leadDays: 7 });
  await w.core.calendarImport.approve(dono, 'v1', p.drafts.find((d) => d.title === 'Já sobe')!.id);
  assert.equal((await w.places.listVenueEvents('v1')).length, 1);
  await w.core.calendarImport.save(dono, 'v1', { enabled: false });
  const calls = w.calendarFetcher.calls.length;
  w.clock.tick(7 * H);
  await w.core.calendarImport.runDue();
  assert.equal(w.calendarFetcher.calls.length, calls);
  await w.core.calendarImport.remove(dono, 'v1');
  assert.equal((await w.core.calendarImport.panel(dono, 'v1')).calendar, null);
  assert.equal((await w.places.listVenueEvents('v1')).length, 1);
});

test('evento que já existe no local (mesmo nome e hora) não vira rascunho; vencido sai da fila', async () => {
  const { w, dono, at } = await setup();
  const start = at(8);
  await w.core.venues.createEvent(dono, 'v1', { title: 'Samba', startsAt: start.toISOString() });
  w.calendarFetcher.texts.set(URL1, ics(ev('a', start, 'samba'), ev('b', at(1), 'Amanhã')));
  const panel = await w.core.calendarImport.save(dono, 'v1', { url: URL1 });
  assert.deepEqual(panel.drafts.map((d) => d.title), ['Amanhã']);
  w.clock.tick(2 * D);
  const r = await w.core.calendarImport.runDue();
  assert.equal(r.expired >= 1, true);
  assert.deepEqual((await w.core.calendarImport.panel(dono, 'v1')).drafts, []);
});

test('local que perdeu o responsável não recebe aviso nem publica', async () => {
  const { w, dono, at, owned } = await setup();
  w.calendarFetcher.texts.set(URL1, ics(ev('a', at(2), 'Samba')));
  await w.core.calendarImport.save(dono, 'v1', { url: URL1, leadDays: 7 });
  await w.places.setVenueOwner('v1', null);
  w.clock.tick(7 * H);
  const r = await w.core.calendarImport.runDue();
  assert.equal(r.notified, 0);
  assert.equal(r.published, 0);
  assert.equal((await owned()).length, 0);
});
