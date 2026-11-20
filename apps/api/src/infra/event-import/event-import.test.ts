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

test('cinema fica de fora do importador', () => {
  assert.deepEqual(classifyEvent({ title: 'Cinema de Billy Wilder 360º', description: 'Mostra de cinema', venueName: 'MISS' }), { keep: false, reason: 'cinema' });
  assert.equal(classifyEvent({ title: 'Festa no cinema abandonado', description: '', venueName: '' }).keep, true);
});

test('CCSP: sessão única e sessão semanal viram ocorrências futuras com horário de São Paulo', async () => {
  const { sessionEvents } = await import('./ccsp.ts');
  const now = new Date('2026-11-20T12:00:00Z');
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
  const info = { slug: 's', link: 'https://centrocultural.sp.gov.br/evento/s/', excerpt: { rendered: '<p>Piano na praça &amp; música.</p>' } };
  const single = sessionEvents({ id: 9, slug: 's', link: 'x', title: { rendered: 'Piano na Pra&ccedil;a' }, meta: { data_inicio: day('2026-12-05'), horario_inicio: '18:00', horario_termino: '19:00', valor_ingresso: '' } }, info, now);
  assert.equal(single.length, 1);
  assert.equal(single[0]!.startsAt.toISOString(), '2026-12-05T21:00:00.000Z');
  assert.equal(single[0]!.isFree, true);
  assert.equal(single[0]!.description, 'Piano na praça & música.');
  assert.equal(single[0]!.link, 'https://centrocultural.sp.gov.br/evento/s/');
  const weekly = sessionEvents({ id: 8, slug: 'w', link: 'x', title: { rendered: 'Passinho Charme' }, meta: { data_inicio: day('2026-11-27'), horario_inicio: '19:00', horario_termino: '21:00', recorrencia_tipo: 'semanal', recorrencia_fim: day('2026-12-18'), valor_ingresso: 'R$ 20' } }, undefined, now);
  assert.deepEqual(weekly.map((e) => e.sourceId), ['8-2026-11-27', '8-2026-12-04', '8-2026-12-11', '8-2026-12-18']);
  assert.equal(weekly[0]!.isFree, false);
  const past = sessionEvents({ id: 7, slug: 'p', link: 'x', title: { rendered: 'Passado' }, meta: { data_inicio: day('2026-10-01'), horario_inicio: '19:00' } }, undefined, now);
  assert.deepEqual(past, []);
});

test('Sesc: lê unidade, categoria, preço, local e datas da página; só presencial e futuro', async () => {
  const { parseSescPage, sescEvents } = await import('./sesc.ts');
  const html = `<html><head><meta property="og:image" content="https://www.sescsp.org.br/a.png"></head><body>
<nav>Home | Itaquera | Shows, Espetáculos e Performances | Butterfly – Saindo …</nav>
<h1>Butterfly &#8211; Saindo do Casulo</h1> Itaquera Duração: 90 minutos atividade presencial Grátis Local: PRAÇA DE EVENTOS  Sem retirada de ingressos.
Data e horário 05/12 a 05/12 05/12 • Sábado • das 15h00 às 16h30 Compartilhe: Um espetáculo de dança em cadeira de rodas.</body></html>`;
  const page = parseSescPage(html, 'https://www.sescsp.org.br/programacao/butterfly-saindo-do-casulo/')!;
  assert.equal(page.unit, 'Itaquera');
  assert.equal(page.category, 'Shows, Espetáculos e Performances');
  assert.equal(page.free, true);
  assert.equal(page.presencial, true);
  assert.equal(page.place, 'PRAÇA DE EVENTOS');
  assert.deepEqual(page.dates, [{ day: 5, month: 12, sh: 15, sm: 0, eh: 16, em: 30 }]);
  const now = new Date('2026-11-20T12:00:00Z');
  const events = sescEvents(page, now);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.startsAt.toISOString(), '2026-12-05T18:00:00.000Z');
  assert.equal(events[0]!.venueName, 'Sesc Itaquera');
  assert.equal(events[0]!.area.name, 'São Paulo');
  assert.deepEqual(sescEvents({ ...page, presencial: false }, now), []);
  assert.deepEqual(sescEvents({ ...page, dates: [{ day: 1, month: 10, sh: 10, sm: 0 }] }, now), []);
  assert.equal(sescEvents({ ...page, unit: 'Santos' }, now)[0]!.area.name, 'Santos');
});

test('Sesc: palestra, oficina e curso ficam como "Outro"; nas outras fontes continuam fora', () => {
  const talk = { title: 'Oficina de bordado', description: 'Aprenda pontos básicos.', venueName: 'Sesc Santos' };
  assert.deepEqual(classifyEvent({ ...talk, source: 'sesc-sp' }), { keep: true, kind: 'OTHER' });
  assert.deepEqual(classifyEvent({ title: 'Palestra sobre economia criativa', description: '', venueName: 'Sesc Pompeia', source: 'sesc-sp' }), { keep: true, kind: 'OTHER' });
  assert.equal(classifyEvent({ ...talk, source: 'juicy-santos' }).keep, false);
  assert.equal(classifyEvent({ title: 'Palestra online do Sesc', description: 'transmissão online', venueName: 'Sesc', source: 'sesc-sp' }).keep, false, 'online continua fora');
});

test('Sympla: lê um evento da página (título, hora de São Paulo, local com coordenadas, preço, imagem)', async () => {
  const { parseSymplaEvent, isSymplaEventUrl, parseUrlList } = await import('./sympla-event.ts');
  const page = (over: Record<string, unknown> = {}) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { hydrationData: { eventHydration: { event: {
      id: 3651782, name: 'SEM FREIO &amp; 14 ANOS', startDate: '2026-11-28 20:00:00', endDate: '2026-11-29 06:00:00', strippedDetail: '&nbsp;É funk, é pancadão.&nbsp;',
      newUrl: 'https://www.sympla.com.br/evento/sem-freio/3651782', logoUrl: 'https://images.sympla.com.br/a.jpg', paymentEventType: 'paid', published: true, cancelled: false, privateEvent: false, onlineInfo: null,
      eventsAddress: { name: 'Blitz Haus', address: 'Rua Augusta', addressNum: '657', neighborhood: 'Consolação', city: 'São Paulo', state: 'SP', geolocation: { latitude: -23.5521, longitude: -46.6521 } },
      ...over,
    } } } } },
  })}</script></html>`;
  const e = parseSymplaEvent(page(), 'https://www.sympla.com.br/evento/sem-freio/3651782')!;
  assert.equal(e.title, 'SEM FREIO & 14 ANOS');
  assert.equal(e.startsAt.toISOString(), '2026-11-28T23:00:00.000Z');
  assert.equal(e.endsAt.toISOString(), '2026-11-29T09:00:00.000Z');
  assert.equal(e.venueName, 'Blitz Haus');
  assert.equal(e.address, 'Rua Augusta, 657 - Consolação - São Paulo - SP');
  assert.deepEqual(e.coords, { lat: -23.5521, lng: -46.6521 });
  assert.equal(e.isFree, false);
  assert.equal(e.description, 'É funk, é pancadão.');
  assert.equal(e.sourceId, '3651782');
  assert.equal(parseSymplaEvent(page({ paymentEventType: 'free' }), 'x')!.isFree, true);
  for (const bad of [{ cancelled: true }, { privateEvent: true }, { published: false }, { onlineInfo: { url: 'x' } }, { startDate: 'em breve' }]) {
    assert.equal(parseSymplaEvent(page(bad), 'x'), undefined, JSON.stringify(bad));
  }
  assert.equal(parseSymplaEvent('<html>sem dados</html>', 'x'), undefined);
  assert.equal(isSymplaEventUrl('https://www.sympla.com.br/evento/a/1'), true);
  assert.equal(isSymplaEventUrl('http://www.sympla.com.br/evento/a/1'), false);
  assert.equal(isSymplaEventUrl('https://sympla.evil.com/evento/a/1'), false);
  assert.equal(isSymplaEventUrl('https://www.sympla.com.br/produtor/x'), false);
  assert.deepEqual(parseUrlList('# comentário\nhttps://www.sympla.com.br/evento/a/1  # fim\n\nhttps://outro.com/x\nhttps://www.sympla.com.br/evento/a/1\n'), ['https://www.sympla.com.br/evento/a/1']);
});

test('Clube Outs: lê as festas da agenda (data, nome e imagem); hora de balada e só o que vem', async () => {
  const { parseClubeOuts } = await import('./clube-outs.ts');
  const card = (d: string, name: string) => `<Div onclick=Verificar('Clube_Outs/${d.replace(/\//g, '')}') style='x'><Table><TR><TD><img src=https://www.comprasnanet.com.br/Clube_Outs/${d.replace(/\//g, '')}/imagens/a.jpg style='width:300px'></TD></TR><TR><TD><B> Data: ${d} <font color=#000090>(Sexta) <BR>  <font color=#000000>${name}</B><BR> </TD></TR></Table></DIV>`;
  const html = card('10/11/2026', 'FESTA PASSADA') + card('20/11/2026', 'THE GRUNGE PARTY - OPEN BAR') + card('21/11/2026', 'FESTA DOS PERDIDOS &amp; AREA 51') + card('21/11/2026', 'FESTA DOS PERDIDOS &amp; AREA 51');
  const events = parseClubeOuts(html, new Date('2026-11-20T12:00:00Z'));
  assert.deepEqual(events.map((e) => e.title), ['THE GRUNGE PARTY - OPEN BAR', 'FESTA DOS PERDIDOS & AREA 51']);
  assert.equal(events[0]!.startsAt.toISOString(), '2026-11-21T02:00:00.000Z');
  assert.equal(events[0]!.venueName, 'Clube Outs');
  assert.equal(events[0]!.imageUrl, 'https://www.comprasnanet.com.br/Clube_Outs/20112026/imagens/a.jpg');
  assert.match(events[0]!.description, /Horário a confirmar/);
});

test('agenda curada: avulso, noite fixa semanal com datas puladas e validação', async () => {
  const { manualEvents, validateManual } = await import('./manual-events.ts');
  const base = { venue: 'Grow', area: 'mogi', kind: 'NIGHT', start: '20:00', credit: 'Instagram do Grow', link: 'https://www.instagram.com/instagrow.exe/' } as const;
  const entries = validateManual([
    { ...base, title: 'Quintow', weekday: 4 },
    { ...base, title: 'Sextou', weekday: 5, skip: ['2026-11-20'] },
    { ...base, title: 'Show avulso', date: '2026-11-28', kind: 'SHOW', start: '22:00', end: '01:00' },
    { ...base, title: 'Show que já passou', date: '2026-11-10' },
  ]);
  const now = new Date('2026-11-20T12:00:00Z'); // sexta 20/11, 09h em São Paulo
  const events = manualEvents(entries, now, 14);
  const dates = (title: string) => events.filter((e) => e.title === title).map((e) => e.startsAt.toISOString());
  assert.deepEqual(dates('Quintow'), ['2026-11-26T23:00:00.000Z', '2026-12-03T23:00:00.000Z']);
  assert.deepEqual(dates('Sextou'), ['2026-11-27T23:00:00.000Z', '2026-12-04T23:00:00.000Z'], 'a sexta 20/11 foi pulada');
  assert.deepEqual(dates('Show avulso'), ['2026-11-29T01:00:00.000Z']);
  assert.equal(events.find((e) => e.title === 'Show avulso')!.endsAt.toISOString(), '2026-11-29T04:00:00.000Z', 'termina de madrugada');
  assert.deepEqual(dates('Show que já passou'), []);
  const one = events.find((e) => e.title === 'Quintow')!;
  assert.equal(one.sourceId, 'grow-quintow-2026-11-26');
  assert.equal(one.kind, 'NIGHT');
  assert.equal(one.area.name, 'Mogi das Cruzes');
  assert.match(one.description, /Horário a confirmar/);
  assert.throws(() => validateManual([{ ...base, title: 'Sem dia' }]), /date.*weekday/);
  assert.throws(() => validateManual([{ ...base, title: 'Dois', date: '2026-11-28', weekday: 1 }]), /um só/);
  assert.throws(() => validateManual([{ ...base, title: 'Hora', date: '2026-11-28', start: '25:00' }]), /horário/);
  assert.throws(() => validateManual([{ ...base, title: 'Link', date: '2026-11-28', link: 'http://x' }]), /https/);
  assert.throws(() => validateManual([{ ...base, title: 'Região', date: '2026-11-28', area: 'rio' }]), /região/);
});

test('agenda curada: evento avulso anunciado para daqui a semanas entra mesmo fora do horizonte das noites fixas', async () => {
  const { manualEvents, validateManual } = await import('./manual-events.ts');
  const entries = validateManual([{ title: 'Festival', venue: 'Sweet Mogi', area: 'mogi', kind: 'SHOW', date: '2026-12-13', start: '20:00', credit: 'Instagram', link: 'https://www.instagram.com/x/' }]);
  assert.equal(manualEvents(entries, new Date('2026-11-20T12:00:00Z'), 14).length, 1);
  assert.equal(manualEvents(entries, new Date('2026-06-01T12:00:00Z'), 14).length, 0, 'mais de 180 dias: ainda não');
});
