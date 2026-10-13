import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayLabel, formatDistances, formatWhen, listTimeLabel, mergeMessages, previewOf, toCard } from './chat.ts';
import type { ChatMessage, SuggestionItem } from './types.ts';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);
const iso = (d: Date) => d.toISOString();
const NOW = at(13, 18, 0);

test('formatWhen: agora, hoje, amanhã, sem horário', () => {
  assert.equal(formatWhen(iso(at(13, 17, 0)), iso(at(13, 21, 30)), NOW), 'Acontecendo agora até 21:30');
  assert.equal(formatWhen(iso(at(13, 17, 0)), null, NOW), 'Acontecendo agora');
  assert.equal(formatWhen(iso(at(13, 20, 15)), iso(at(13, 23, 0)), NOW), 'Hoje às 20:15 até 23:00');
  assert.equal(formatWhen(iso(at(14, 9, 0)), null, NOW), 'Amanhã às 09:00');
  assert.equal(formatWhen(null, null, NOW), 'Horário não informado');
  assert.equal(formatWhen('lixo', null, NOW), 'Horário não informado');
});

test('dayLabel e listTimeLabel', () => {
  assert.equal(dayLabel(iso(at(13, 9)), NOW), 'Hoje');
  assert.equal(dayLabel(iso(at(12, 23, 59)), NOW), 'Ontem');
  assert.match(dayLabel(iso(at(1, 9)), NOW), /out/);
  assert.equal(listTimeLabel(iso(at(13, 9, 5)), NOW), '09:05');
  assert.equal(listTimeLabel(iso(at(12, 9, 5)), NOW), 'Ontem');
  assert.equal(dayLabel('lixo', NOW), '');
});

const item: SuggestionItem = { key: 'osm:node/1', source: 'OSM', title: 'Bar', venueName: 'Bar', category: 'bar', startsAt: null, endsAt: null, sample: false, lat: -23.5, lng: -46.6, rating: null, ratingCount: null, photoPath: null, photoAuthor: null, mapsUri: null, distanceFromMeM: 1240, distanceFromThemM: 830, distanceFromMidM: 100 };

test('previewOf: encontro e mensagem de grupo', () => {
  assert.equal(previewOf(msg('a', '2026-10-13T10:00:00Z', { kind: 'MEETUP', body: 'Encontro: Show', mine: true })), 'Você: Encontro: Show');
  assert.equal(previewOf(msg('b', '2026-10-13T10:00:00Z', { body: 'oi gente', senderName: 'Bia' })), 'Bia: oi gente');
  assert.equal(previewOf(msg('c', '2026-10-13T10:00:00Z', { body: 'oi', mine: true, senderName: 'Ana' })), 'Você: oi');
});

test('formatDistances usa o nome da outra pessoa', () => {
  assert.equal(formatDistances(item, 'Bia'), 'a 1,2 km de você · 850 m de Bia');
});

test('toCard leva só os campos do cartão', () => {
  const card = toCard(item);
  assert.deepEqual(Object.keys(card).sort(), ['endsAt', 'externalId', 'lat', 'lng', 'sample', 'source', 'startsAt', 'title', 'venueName']);
  assert.equal(card.externalId, 'osm:node/1');
});

const msg = (id: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, senderId: 'u', mine: false, senderName: null, kind: 'TEXT', body: id, suggestion: null, meetup: null, response: null, respondedAt: null, distances: null, createdAt, ...extra });

test('mergeMessages: sem repetir, em ordem, a versão mais nova vence', () => {
  const a = [msg('1', '2026-10-13T10:00:00.000Z'), msg('2', '2026-10-13T10:01:00.000Z')];
  const b = [msg('2', '2026-10-13T10:01:00.000Z', { body: 'novo' }), msg('3', '2026-10-13T10:02:00.000Z')];
  const merged = mergeMessages(a, b);
  assert.deepEqual(merged.map((m) => m.id), ['1', '2', '3']);
  assert.equal(merged[1]!.body, 'novo');
});

test('previewOf', () => {
  assert.equal(previewOf(null), 'Nenhuma mensagem ainda');
  assert.equal(previewOf(msg('1', 'x', { body: 'oi\n  tudo?', mine: true })), 'Você: oi tudo?');
  assert.equal(previewOf(msg('2', 'x', { kind: 'SUGGESTION', suggestion: toCard(item) })), 'Sugeriu Bar');
});

import { formatRating, ratingLabel, routeLink, sourceLabel, starPercent } from './chat.ts';

test('nota do Google: texto, rótulo acessível e estrelas em meias unidades', () => {
  assert.equal(formatRating(4.62), '4,6');
  assert.equal(formatRating(5), '5,0');
  assert.equal(ratingLabel(4.6, 321), 'Nota 4,6 de 5, 321 avaliações no Google');
  assert.equal(ratingLabel(4.6, 1), 'Nota 4,6 de 5, 1 avaliação no Google');
  assert.equal(ratingLabel(4.6, null), 'Nota 4,6 de 5 no Google');
  assert.equal(starPercent(4.6), 90);
  assert.equal(starPercent(4.2), 80);
  assert.equal(starPercent(9), 100);
  assert.equal(starPercent(-1), 0);
});

test('rota e fonte', () => {
  assert.equal(routeLink(-23.5, -46.6), 'https://www.google.com/maps/dir/?api=1&destination=-23.5,-46.6&travelmode=walking');
  assert.equal(sourceLabel('GOOGLE'), 'Lugar do Google');
});
