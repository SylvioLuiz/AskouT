import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseIcs, plainText, wallToUtc } from './ical.ts';

const from = new Date('2026-10-24T00:00:00Z');
const to = new Date('2027-02-01T00:00:00Z');
const cal = (...events: string[]): string => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const ev = (...lines: string[]): string => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
const starts = (text: string, opts: Partial<{ from: Date; to: Date; max: number }> = {}): string[] => parseIcs(text, { from, to, ...opts }).events.map((e) => e.start.toISOString());

describe('iCal: eventos simples', () => {
  it('lê título, descrição, local, link, início e fim em UTC', () => {
    const r = parseIcs(
      cal(ev('UID:a1', 'DTSTART:20261031T000000Z', 'DTEND:20261031T030000Z', 'SUMMARY:Samba de Raiz', 'DESCRIPTION:Roda aberta\\nTraga a galera\\, sem pressa', 'LOCATION:Rua A\\, 10', 'URL:https://ingresso.exemplo/1')),
      { from, to },
    );
    assert.equal(r.isCalendar, true);
    assert.equal(r.events.length, 1);
    const e = r.events[0]!;
    assert.equal(e.uid, 'a1');
    assert.equal(e.summary, 'Samba de Raiz');
    assert.equal(e.description, 'Roda aberta\nTraga a galera, sem pressa');
    assert.equal(e.location, 'Rua A, 10');
    assert.equal(e.url, 'https://ingresso.exemplo/1');
    assert.equal(e.start.toISOString(), '2026-10-31T00:00:00.000Z');
    assert.equal(e.end.toISOString(), '2026-10-31T03:00:00.000Z');
  });

  it('converte o horário do fuso informado (TZID) para UTC', () => {
    const t = cal(ev('UID:a2', 'DTSTART;TZID=America/Sao_Paulo:20261031T210000', 'DTEND;TZID=America/Sao_Paulo:20261031T233000', 'SUMMARY:Show'));
    const e = parseIcs(t, { from, to }).events[0]!;
    assert.equal(e.start.toISOString(), '2026-11-01T00:00:00.000Z');
    assert.equal(e.end.toISOString(), '2026-11-01T02:30:00.000Z');
  });

  it('horário sem fuso vale no fuso padrão (São Paulo) e fuso desconhecido cai nele também', () => {
    assert.deepEqual(starts(cal(ev('UID:a3', 'DTSTART:20261031T210000', 'SUMMARY:x'))), ['2026-11-01T00:00:00.000Z']);
    assert.deepEqual(starts(cal(ev('UID:a4', 'DTSTART;TZID=Fuso/Que/Nao/Existe:20261031T210000', 'SUMMARY:x'))), ['2026-11-01T00:00:00.000Z']);
  });

  it('usa DURATION quando não há DTEND, e 3 horas quando não há nenhum dos dois', () => {
    const a = parseIcs(cal(ev('UID:d1', 'DTSTART:20261031T200000Z', 'DURATION:PT1H30M', 'SUMMARY:x')), { from, to }).events[0]!;
    assert.equal(a.end.toISOString(), '2026-10-31T21:30:00.000Z');
    const b = parseIcs(cal(ev('UID:d2', 'DTSTART:20261031T200000Z', 'SUMMARY:x')), { from, to }).events[0]!;
    assert.equal(b.end.toISOString(), '2026-10-31T23:00:00.000Z');
  });

  it('junta linhas dobradas', () => {
    const t = cal(ev('UID:f1', 'DTSTART:20261031T200000Z', 'SUMMARY:Titulo muito', ' longo aqui'));
    assert.equal(parseIcs(t, { from, to }).events[0]!.summary, 'Titulo muito' + 'longo aqui');
  });

  it('ignora evento cancelado e conta (sem usar) os de dia inteiro', () => {
    const t = cal(
      ev('UID:c1', 'DTSTART:20261031T200000Z', 'STATUS:CANCELLED', 'SUMMARY:cancelado'),
      ev('UID:c2', 'DTSTART;VALUE=DATE:20261101', 'SUMMARY:dia inteiro'),
      ev('UID:c3', 'DTSTART:20261102T200000Z', 'SUMMARY:valido'),
    );
    const r = parseIcs(t, { from, to });
    assert.deepEqual(r.events.map((e) => e.uid), ['c3']);
    assert.equal(r.skippedAllDay, 1);
  });

  it('só devolve o que começa dentro da janela e respeita o teto', () => {
    const t = cal(ev('UID:w1', 'DTSTART:20260101T200000Z', 'SUMMARY:passado'), ev('UID:w2', 'DTSTART:20261110T200000Z', 'SUMMARY:ok'), ev('UID:w3', 'DTSTART:20280101T200000Z', 'SUMMARY:longe'), ev('UID:w4', 'DTSTART:20261111T200000Z', 'SUMMARY:ok2'));
    assert.deepEqual(parseIcs(t, { from, to }).events.map((e) => e.uid), ['w2', 'w4']);
    assert.deepEqual(parseIcs(t, { from, to, max: 1 }).events.map((e) => e.uid), ['w2']);
  });

  it('avisa quando o texto não é um calendário', () => {
    const r = parseIcs('<html>Entrar na conta</html>', { from, to });
    assert.equal(r.isCalendar, false);
    assert.deepEqual(r.events, []);
  });

  it('um evento sem DTSTART válido é ignorado, sem derrubar o resto', () => {
    const t = cal(ev('UID:x1', 'SUMMARY:sem data'), ev('UID:x2', 'DTSTART:lixo', 'SUMMARY:data ruim'), ev('UID:x3', 'DTSTART:20261110T200000Z', 'SUMMARY:ok'));
    assert.deepEqual(parseIcs(t, { from, to }).events.map((e) => e.uid), ['x3']);
  });
});

describe('iCal: eventos que se repetem', () => {
  // 30/10/2026 é sexta-feira.
  it('semanal em sextas e sábados, com COUNT', () => {
    const t = cal(ev('UID:r1', 'DTSTART;TZID=America/Sao_Paulo:20261030T210000', 'RRULE:FREQ=WEEKLY;BYDAY=FR,SA;COUNT=4', 'SUMMARY:Forró'));
    assert.deepEqual(starts(t), ['2026-10-31T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-07T00:00:00.000Z', '2026-11-08T00:00:00.000Z']);
  });

  it('COUNT conta desde o início da série, mesmo o que já passou', () => {
    const t = cal(ev('UID:r2', 'DTSTART:20261002T200000Z', 'RRULE:FREQ=WEEKLY;COUNT=4', 'SUMMARY:Quinzenal'));
    // 2/10, 9/10, 16/10, 23/10: tudo antes da janela (a partir de 24/10).
    assert.deepEqual(starts(t), []);
  });

  it('INTERVAL de 2 semanas', () => {
    const t = cal(ev('UID:r3', 'DTSTART:20261030T200000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3', 'SUMMARY:x'));
    assert.deepEqual(starts(t), ['2026-10-30T20:00:00.000Z', '2026-11-13T20:00:00.000Z', '2026-11-27T20:00:00.000Z']);
  });

  it('EXDATE tira uma data da série', () => {
    const t = cal(ev('UID:r4', 'DTSTART;TZID=America/Sao_Paulo:20261030T210000', 'RRULE:FREQ=WEEKLY;COUNT=3', 'EXDATE;TZID=America/Sao_Paulo:20261106T210000', 'SUMMARY:x'));
    assert.deepEqual(starts(t), ['2026-10-31T00:00:00.000Z', '2026-11-14T00:00:00.000Z']);
  });

  it('uma ocorrência alterada (RECURRENCE-ID) troca a original', () => {
    const t = cal(
      ev('UID:r5', 'DTSTART;TZID=America/Sao_Paulo:20261030T210000', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Samba'),
      ev('UID:r5', 'RECURRENCE-ID;TZID=America/Sao_Paulo:20261106T210000', 'DTSTART;TZID=America/Sao_Paulo:20261107T220000', 'DTEND;TZID=America/Sao_Paulo:20261108T010000', 'SUMMARY:Samba especial'),
    );
    const r = parseIcs(t, { from, to }).events;
    assert.deepEqual(r.map((e) => e.start.toISOString()), ['2026-10-31T00:00:00.000Z', '2026-11-08T01:00:00.000Z', '2026-11-14T00:00:00.000Z']);
    assert.deepEqual(r.map((e) => e.summary), ['Samba', 'Samba especial', 'Samba']);
    assert.equal(r[1]!.originalStart.toISOString(), '2026-11-07T00:00:00.000Z');
  });

  it('uma ocorrência cancelada (RECURRENCE-ID com STATUS:CANCELLED) some', () => {
    const t = cal(
      ev('UID:r6', 'DTSTART:20261030T200000Z', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:x'),
      ev('UID:r6', 'RECURRENCE-ID:20261106T200000Z', 'DTSTART:20261106T200000Z', 'STATUS:CANCELLED', 'SUMMARY:x'),
    );
    assert.deepEqual(starts(t), ['2026-10-30T20:00:00.000Z', '2026-11-13T20:00:00.000Z']);
  });

  it('mensal: primeiro sábado do mês e última sexta', () => {
    const first = cal(ev('UID:m1', 'DTSTART:20261107T200000Z', 'RRULE:FREQ=MONTHLY;BYDAY=1SA;COUNT=3', 'SUMMARY:x'));
    assert.deepEqual(starts(first), ['2026-11-07T20:00:00.000Z', '2026-12-05T20:00:00.000Z', '2027-01-02T20:00:00.000Z']);
    const last = cal(ev('UID:m2', 'DTSTART:20261127T200000Z', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3', 'SUMMARY:x'));
    assert.deepEqual(starts(last), ['2026-11-27T20:00:00.000Z', '2026-12-25T20:00:00.000Z', '2027-01-29T20:00:00.000Z']);
  });

  it('mensal no mesmo dia do mês e diário', () => {
    assert.deepEqual(starts(cal(ev('UID:m3', 'DTSTART:20261115T200000Z', 'RRULE:FREQ=MONTHLY;COUNT=3', 'SUMMARY:x'))), ['2026-11-15T20:00:00.000Z', '2026-12-15T20:00:00.000Z', '2027-01-15T20:00:00.000Z']);
    assert.deepEqual(starts(cal(ev('UID:m4', 'DTSTART:20261110T200000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:x'))), ['2026-11-10T20:00:00.000Z', '2026-11-11T20:00:00.000Z', '2026-11-12T20:00:00.000Z']);
  });

  it('UNTIL encerra a série', () => {
    const t = cal(ev('UID:u1', 'DTSTART:20261030T200000Z', 'RRULE:FREQ=WEEKLY;UNTIL=20261113T235959Z', 'SUMMARY:x'));
    assert.deepEqual(starts(t), ['2026-10-30T20:00:00.000Z', '2026-11-06T20:00:00.000Z', '2026-11-13T20:00:00.000Z']);
  });

  it('série sem fim não passa da janela nem do teto', () => {
    const t = cal(ev('UID:inf', 'DTSTART:20261030T200000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:x'));
    const r = starts(t, { to: new Date('2026-11-05T00:00:00Z') });
    assert.equal(r.length, 6);
    assert.equal(starts(t, { max: 10 }).length, 10);
  });

  it('o horário local se mantém quando o fuso muda para o horário de verão', () => {
    // Nova York: o horário de verão termina em 1/11/2026.
    const t = cal(ev('UID:ny', 'DTSTART;TZID=America/New_York:20261030T090000', 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:x'));
    assert.deepEqual(starts(t), ['2026-10-30T13:00:00.000Z', '2026-11-06T14:00:00.000Z']);
  });

  it('regra que não entendemos não derruba: vira evento único', () => {
    const t = cal(ev('UID:bad', 'DTSTART:20261030T200000Z', 'RRULE:FREQ=SECONDLY;COUNT=5', 'SUMMARY:x'));
    assert.deepEqual(starts(t), ['2026-10-30T20:00:00.000Z']);
  });
});

describe('iCal: utilitários', () => {
  it('wallToUtc: São Paulo é UTC-3 e Nova York muda com o horário de verão', () => {
    assert.equal(wallToUtc('America/Sao_Paulo', 2026, 10, 31, 21, 0, 0).toISOString(), '2026-11-01T00:00:00.000Z');
    assert.equal(wallToUtc('America/New_York', 2026, 7, 1, 12, 0, 0).toISOString(), '2026-07-01T16:00:00.000Z');
    assert.equal(wallToUtc('America/New_York', 2026, 12, 1, 12, 0, 0).toISOString(), '2026-12-01T17:00:00.000Z');
  });

  it('plainText tira o HTML que o Google Agenda coloca na descrição', () => {
    assert.equal(plainText('Roda de samba<br>Entrada <b>grátis</b> &amp; livre<br/><a href="https://x">link</a>'), 'Roda de samba\nEntrada grátis & livre\nlink');
    assert.equal(plainText('<p>um</p><p>dois</p>'), 'um\ndois');
  });
});
