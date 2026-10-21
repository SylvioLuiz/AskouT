import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_VENUE_EVENT, claimStatusLabel, documentProblem, parseTags, ticketHost, ticketUrlProblem, venueEventBody, venueEventProblem } from './venue.ts';
import type { VenueEventDraft } from './venue.ts';

const NOW = new Date('2026-10-14T12:00:00');
const draft = (over: Partial<VenueEventDraft> = {}): VenueEventDraft => ({ ...EMPTY_VENUE_EVENT, title: 'Samba', starts: '2026-10-20T20:00', ...over });

test('documento: tipo e tamanho', () => {
  assert.equal(documentProblem({ type: 'application/pdf', size: 1000 }), null);
  assert.equal(documentProblem({ type: 'image/png', size: 2 * 1024 * 1024 }), null);
  assert.match(documentProblem({ type: 'text/html', size: 10 }) ?? '', /PDF ou uma imagem/);
  assert.match(documentProblem({ type: 'image/jpeg', size: 2 * 1024 * 1024 + 1 }) ?? '', /2 MB/);
  assert.match(documentProblem({ type: 'image/jpeg', size: 0 }) ?? '', /vazio/);
});

test('hashtags: sem #, sem repetidos, minúsculas', () => {
  assert.deepEqual(parseTags('#Samba, música ##samba;  #Roda'), ['samba', 'música', 'roda']);
  assert.deepEqual(parseTags('  '), []);
});

test('rascunho do evento: valida nome, datas, imagem e hashtags', () => {
  assert.equal(venueEventProblem(draft(), NOW, false), null);
  assert.match(venueEventProblem(draft({ title: '  ' }), NOW, false) ?? '', /nome/);
  assert.match(venueEventProblem(draft({ title: 'x'.repeat(81) }), NOW, false) ?? '', /80/);
  assert.match(venueEventProblem(draft({ starts: '' }), NOW, false) ?? '', /começa/);
  assert.match(venueEventProblem(draft({ starts: '2026-10-01T20:00' }), NOW, false) ?? '', /futuro/);
  assert.equal(venueEventProblem(draft({ starts: '2026-10-01T20:00' }), NOW, true), null, 'editar um evento antigo é permitido');
  assert.match(venueEventProblem(draft({ ends: '2026-10-20T19:00' }), NOW, false) ?? '', /depois do início/);
  assert.match(venueEventProblem(draft({ ends: '2026-12-20T19:00' }), NOW, false) ?? '', /30 dias/);
  assert.match(venueEventProblem(draft({ imageUrl: 'http://x.com/a.jpg' }), NOW, false) ?? '', /https/);
  assert.match(venueEventProblem(draft({ tags: '#a #b #c #d #e #f' }), NOW, false) ?? '', /5 hashtags/);
});

test('corpo enviado para a API', () => {
  const body = venueEventBody(draft({ title: ' Samba ', description: ' ', ends: '', imageUrl: ' ', tags: '#Samba', isFree: true, kind: 'SHOW' }));
  assert.equal(body.title, 'Samba');
  assert.equal(body.description, null);
  assert.equal(body.endsAt, null);
  assert.equal(body.imageUrl, null);
  assert.deepEqual(body.tags, ['samba']);
  assert.equal(body.isFree, true);
  assert.equal(new Date(body.startsAt).getTime(), new Date('2026-10-20T20:00').getTime());
});

test('rótulos do pedido', () => {
  assert.equal(claimStatusLabel('PENDING'), 'Avaliação em andamento');
  assert.equal(claimStatusLabel('REJECTED'), 'Recusado');
});

test('capa: foto do aparelho vai como imageData; capa já enviada é mantida', () => {
  const base = { ...EMPTY_VENUE_EVENT, title: 'X', starts: '2026-12-01T20:00' };
  const up = venueEventBody({ ...base, imageData: 'data:image/jpeg;base64,AAAA' });
  assert.equal(up.imageData, 'data:image/jpeg;base64,AAAA');
  assert.equal('imageUrl' in up, false);
  const own = { ...base, imageUrl: '/place-events/abc-1/cover?v=123' };
  assert.equal(venueEventProblem(own, new Date('2026-11-01T00:00:00Z'), true), null);
  assert.equal(venueEventBody(own).imageUrl, '/place-events/abc-1/cover?v=123');
  assert.match(venueEventProblem({ ...base, imageUrl: '/outra/coisa' }, new Date('2026-11-01T00:00:00Z'), true) ?? '', /https/);
});

test('link de ingresso: vazio vale, só https com domínio de verdade', () => {
  assert.equal(ticketUrlProblem(''), null);
  assert.equal(ticketUrlProblem('   '), null);
  assert.equal(ticketUrlProblem('https://www.sympla.com.br/evento/samba?utm=askout'), null);
  for (const bad of ['http://sympla.com.br/x', 'sympla.com.br/x', 'javascript:alert(1)', 'https://localhost/x', 'https://10.0.0.1/x', 'https://u:p@sympla.com.br/x', 'https://a b.com', `https://x.com/${'a'.repeat(500)}`]) {
    assert.ok(ticketUrlProblem(bad), bad);
  }
});

test('link de ingresso: vai no corpo, vazio remove, e o botão mostra só o site', () => {
  assert.equal(venueEventBody(draft({ ticketUrl: ' https://ingresso.com/a ' })).ticketUrl, 'https://ingresso.com/a');
  assert.equal(venueEventBody(draft({ ticketUrl: '' })).ticketUrl, null);
  assert.ok(venueEventProblem(draft({ ticketUrl: 'http://x.com' }), NOW, false));
  assert.equal(venueEventProblem(draft({ ticketUrl: 'https://x.com/y' }), NOW, false), null);
  assert.equal(ticketHost('https://www.sympla.com.br/evento/1'), 'sympla.com.br');
  assert.equal(ticketHost('lixo'), '');
});
