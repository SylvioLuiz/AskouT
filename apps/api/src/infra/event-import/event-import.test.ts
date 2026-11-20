import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchJuicyEvents, parseJuicyEvent } from './juicy-santos.ts';
import type { JuicyRow } from './juicy-santos.ts';
import { classifyEvent } from './niche.ts';

const row = (over: Partial<{ id: number; title: string; date: string; time: string; venue: string; price: string; body: string }> = {}): JuicyRow => {
  const o = { id: 7, title: 'Beatles 4Ever em Santos', date: '20 novembro 26', time: '20:30  - 22:30', venue: 'Centro Cultural Português', price: 'R$ 65-130', body: 'Show tributo aos Beatles.', ...over };
  return {
    id: o.id,
    link: `https://www.juicysantos.com.br/eventos-na-regiao/e-${o.id}/`,
    title: { rendered: o.title },
    content: {
      rendered: `<section class="em-item-header"><div class="em-item-image "><img src='https://www.juicysantos.com.br/wp-content/uploads/a.png' alt='x'/></div>
<div class="em-item-meta-line em-event-date em-event-meta-datetime"><span></span>${o.date}    </div>
<div class="em-item-meta-line em-event-time em-event-meta-datetime"><span></span>${o.time} </div>
<section class="em-event-where"><h3>Onde</h3><div class="em-item-meta-line em-event-location"><span></span><div><a href="https://x/locais/y/">${o.venue}</a><br>Rua A, 10 - Centro, Santos - SP</div></div></section>
<section class="em-event-quanto"><h3>Quanto</h3><div class="em-item-meta-line valor0"><i class="fa-solid fa-dollar-sign"></i>
 ${o.price}</div></section></section>
<section class="em-event-content"><p>${o.body}</p><h2>Informações do evento</h2><p>Local</p></section>`,
    },
  };
};

test('lê data, hora de São Paulo, local, preço e imagem do Juicy', () => {
  const e = parseJuicyEvent(row())!;
  assert.equal(e.title, 'Beatles 4Ever em Santos');
  assert.equal(e.startsAt.toISOString(), '2026-11-20T23:30:00.000Z');
  assert.equal(e.endsAt.toISOString(), '2026-11-21T01:30:00.000Z');
  assert.equal(e.venueName, 'Centro Cultural Português');
  assert.match(e.address ?? '', /Rua A, 10/);
  assert.equal(e.isFree, false);
  assert.equal(e.imageUrl, 'https://www.juicysantos.com.br/wp-content/uploads/a.png');
  assert.equal(e.description, 'Show tributo aos Beatles.');
});

test('vários dias, gratuito e término de madrugada', () => {
  const multi = parseJuicyEvent(row({ date: '20 novembro 26 - 22 novembro 26', time: '11:00  - 22:00', price: 'R$ 0' }))!;
  assert.equal(multi.isFree, true);
  assert.equal(multi.startsAt.toISOString(), '2026-11-20T14:00:00.000Z');
  assert.equal(multi.endsAt.toISOString(), '2026-11-23T01:00:00.000Z');
  const night = parseJuicyEvent(row({ title: 'Festa', time: '22:00  - 3:00' }))!;
  assert.equal(night.endsAt.getTime() - night.startsAt.getTime(), 5 * 3_600_000);
});

test('sem data ou sem local não vira evento', () => {
  assert.equal(parseJuicyEvent(row({ date: 'em breve' })), undefined);
  assert.equal(parseJuicyEvent(row({ venue: '' })), undefined);
});

test('nicho: fica encontro de gente, sai curso, online, palestra e religião', () => {
  const v = (title: string, description = '') => classifyEvent({ title, description, venueName: '' });
  assert.deepEqual(v('Festa Vortex especial anos 80'), { keep: true, kind: 'NIGHT' });
  assert.deepEqual(v('Beatles 4Ever em Santos', 'Show tributo aos Beatles.'), { keep: true, kind: 'SHOW' });
  assert.deepEqual(v('Roda de samba no quintal'), { keep: true, kind: 'SHOW' });
  assert.deepEqual(v('Stand-up comedy'), { keep: true, kind: 'THEATER' });
  assert.deepEqual(v('Campeonato Santista de Karate-Do'), { keep: true, kind: 'SPORT' });
  assert.deepEqual(v('Festival de hambúrguer'), { keep: true, kind: 'GASTRONOMY' });
  assert.equal(v('Workshop de Percussão Gratuito').keep, false);
  assert.equal(v('Aulas gratuitas de teatro').keep, false);
  assert.equal(v('Ciclo de Palestras na Pinacoteca').keep, false);
  assert.equal(v('Congresso de Medicina').keep, false);
  assert.equal(v('Culto de domingo').keep, false);
  assert.equal(v('Show online ao vivo', 'transmissão online').keep, false);
  assert.equal(v('Reunião do Conselho Municipal de Saúde').keep, false);
  assert.equal(v('Lançamento do livro', 'Autógrafos na livraria.').keep, false);
});

test('busca páginas, ignora o que já passou e para quando só há publicações antigas', async () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const past = row({ id: 1, date: '01 outubro 26' });
  const future = row({ id: 2 });
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(url);
    const page = Number(/[?&]page=(\d+)/.exec(url)![1]);
    const date_gmt = page === 1 ? '2026-11-19T10:00:00' : '2026-01-01T10:00:00';
    return { ok: true, json: async () => [{ ...past, date_gmt }, { ...future, date_gmt }] };
  }) as unknown as typeof fetch;
  const events = await fetchJuicyEvents(now, { fetcher, maxPages: 5 });
  assert.deepEqual(events.map((e) => e.sourceId), ['2', '2']);
  assert.equal(calls.length, 2);
});

test('agenda da Prefeitura de Mogi: só o que vem, com local; sem ano vira o ano em curso', async () => {
  const { parseMogiAgenda } = await import('./mogi-prefeitura.ts');
  const item = (d: string, m: string, t: string, venue: string, time: string) => `<a><div class="row"><div class="data-evento"><h3>${d}</h3><p>${m}</p></div>
<h4>${t}</h4><p><span class="glyphicon glyphicon-map-marker" aria-hidden="true"></span> ${venue}</p>
<p><span class="glyphicon glyphicon-time" aria-hidden="true"></span> ${time}</p></div></a>`;
  const html = item('01', 'Junho', 'Exposi&ccedil;&atilde;o fixa', 'Museu Mogiano', '09:00')
    + item('29', 'Novembro', 'Roda de Passinhos do Funk com DJ', 'Pra&ccedil;a da Liberdade', '15:00')
    + item('20', 'Novembro', 'Pagode da 27', '', '15:00');
  const events = parseMogiAgenda(html, new Date('2026-11-20T12:00:00Z'));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.title, 'Roda de Passinhos do Funk com DJ');
  assert.equal(events[0]!.venueName, 'Praça da Liberdade');
  assert.equal(events[0]!.startsAt.toISOString(), '2026-11-29T18:00:00.000Z');
  assert.equal(events[0]!.sourceId, '2026-11-29-roda-de-passinhos-do-funk-com-dj');
});
