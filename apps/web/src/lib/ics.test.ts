import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEventIcs, icsFilename, icsFold, icsText, nativeCalendarBridge } from './ics.ts';

const base = { id: 'ev1', title: 'Samba, chopp; e festa', startsAt: '2026-11-07T22:00:00.000Z', endsAt: '2026-11-08T02:00:00.000Z', venue: { name: 'Bar do Zé', address: 'Rua A, 10' } };

describe('arquivo de agenda (.ics)', () => {
  it('monta o evento com datas em UTC, local e lembrete', () => {
    const ics = buildEventIcs({ ...base, description: 'Linha 1\nLinha 2', url: 'https://askout.com.br/eventos/ev1' }, new Date('2026-10-24T12:00:00Z'))!;
    const lines = ics.split('\r\n');
    assert.equal(lines[0], 'BEGIN:VCALENDAR');
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.ok(lines.includes('UID:ev1@askout.com.br'));
    assert.ok(lines.includes('DTSTAMP:20261024T120000Z'));
    assert.ok(lines.includes('DTSTART:20261107T220000Z'));
    assert.ok(lines.includes('DTEND:20261108T020000Z'));
    assert.ok(lines.includes('SUMMARY:Samba\\, chopp\; e festa'));
    assert.ok(lines.includes('LOCATION:Bar do Zé\\, Rua A\\, 10'));
    assert.ok(lines.includes('DESCRIPTION:Linha 1\\nLinha 2\\n\\nhttps://askout.com.br/eventos/ev1'));
    assert.ok(lines.includes('TRIGGER:-PT1H'));
  });
  it('sem fim válido assume 2 horas; sem início válido não gera', () => {
    const ics = buildEventIcs({ ...base, endsAt: 'x' })!;
    assert.match(ics, /DTEND:20261108T000000Z/);
    assert.equal(buildEventIcs({ ...base, startsAt: 'x' }), null);
  });
  it('escapa e quebra linhas longas sem cortar acentos', () => {
    assert.equal(icsText('a\\b;c,d\ne'), 'a\\\\b\;c\\,d\\ne');
    const folded = icsFold(`SUMMARY:${'ç'.repeat(80)}`);
    for (const part of folded.split('\r\n')) assert.ok(new TextEncoder().encode(part).length <= 75);
    assert.equal(folded.replace(/\r\n /g, ''), `SUMMARY:${'ç'.repeat(80)}`);
  });
  it('nome do arquivo sem acentos nem símbolos', () => {
    assert.equal(icsFilename('Forró & Açaí — Noite!'), 'Forro-Acai-Noite.ics');
    assert.equal(icsFilename('!!!'), 'evento.ics');
  });
  it('reconhece só a ponte nativa completa', () => {
    assert.equal(nativeCalendarBridge({}), undefined);
    assert.equal(nativeCalendarBridge({ AskouTCalendar: {} }), undefined);
    const b = { addEvent: async () => undefined };
    assert.equal(nativeCalendarBridge({ AskouTCalendar: b }), b);
  });
});
