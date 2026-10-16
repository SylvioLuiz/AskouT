import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allDeletable, copyText, dayLabel, filterConversations, formatDistances, formatWhen, listTimeLabel, mergeMessages, previewOf, replyPreview, selectable, toCard } from './chat.ts';
import { fitWithin, mediaKind, mediaProblem, typingLabel } from './chat-media.ts';
import type { ChatMessage, ConversationItem, SuggestionItem } from './types.ts';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);
const iso = (d: Date) => d.toISOString();
const NOW = at(13, 18, 0);

test('formatWhen: agora, hoje, amanhã, sem horário', () => {
  assert.equal(formatWhen(iso(at(13, 17, 0)), iso(at(13, 21, 30)), NOW), 'Acontecendo agora até 21:30');
  assert.equal(formatWhen(iso(at(13, 17, 0)), null, NOW), 'Acontecendo agora');
  assert.equal(formatWhen(iso(at(13, 20, 15)), iso(at(13, 23, 0)), NOW), 'Hoje às 20:15 até 23:00');
  assert.equal(formatWhen(iso(at(14, 9, 0)), null, NOW), 'Amanhã às 09:00');
  assert.equal(formatWhen(iso(at(13, 22, 0)), iso(at(14, 2, 0)), NOW), 'Hoje às 22:00 até amanhã às 02:00');
  assert.match(formatWhen(iso(at(13, 20, 0)), iso(at(16, 12, 0)), NOW), /^Hoje às 20:00 até 16 de out\. às 12:00$/);
  assert.match(formatWhen(iso(at(13, 17, 0)), iso(at(15, 10, 0)), NOW), /^Acontecendo agora até 15 de out\. às 10:00$/);
  assert.equal(formatWhen(iso(at(13, 17, 0)), iso(at(14, 1, 0)), NOW), 'Acontecendo agora até amanhã às 01:00');
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

const msg = (id: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, senderId: 'u', mine: false, senderName: null, kind: 'TEXT', body: id, suggestion: null, audio: null, meetup: null, response: null, respondedAt: null, distances: null, deleted: false, replyTo: null, reactions: [], createdAt, ...extra }) as ChatMessage;

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

test('previewOf: mensagem de voz mostra a duração', () => {
  const m = msg('a', '2026-10-14T10:00:00Z', { kind: 'AUDIO', body: 'Mensagem de voz', audio: { durationMs: 7400 }, mine: true });
  assert.equal(previewOf(m), 'Você: Mensagem de voz (0:07)');
  assert.equal(previewOf({ ...m, mine: false, senderName: 'Bia' }), 'Bia: Mensagem de voz (0:07)');
});

test('previewOf e replyPreview: apagada, foto e vídeo', () => {
  assert.equal(previewOf(msg('1', 'x', { deleted: true, mine: true })), 'Você: Mensagem apagada');
  assert.equal(previewOf(msg('2', 'x', { kind: 'IMAGE', senderName: 'Bia' })), 'Bia: Foto');
  assert.equal(previewOf(msg('3', 'x', { kind: 'VIDEO', mine: true })), 'Você: Vídeo');
  assert.equal(replyPreview(msg('4', 'x', { deleted: true })), 'Mensagem apagada');
  assert.equal(replyPreview(msg('5', 'x', { kind: 'IMAGE' })), 'Foto');
  assert.equal(replyPreview(msg('6', 'x', { body: 'a'.repeat(300) })).length, 100);
});

test('fitWithin reduz sem ampliar e mantém a proporção', () => {
  assert.deepEqual(fitWithin(4000, 2000, 1600), { width: 1600, height: 800 });
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(0, 10, 1600), { width: 0, height: 0 });
});

test('mediaProblem e mediaKind', () => {
  assert.equal(mediaProblem({ type: 'image/jpeg', size: 9_000_000 }), null);
  assert.equal(mediaProblem({ type: 'image/gif', size: 10 }) !== null, true);
  assert.equal(mediaProblem({ type: 'video/mp4', size: 21 * 1024 * 1024 }) !== null, true);
  assert.equal(mediaProblem({ type: 'video/mp4', size: 1024 }), null);
  assert.equal(mediaProblem({ type: 'application/pdf', size: 10 }) !== null, true);
  assert.equal(mediaProblem({ type: 'image/png', size: 0 }) !== null, true);
  assert.equal(mediaKind({ type: 'video/webm' }), 'VIDEO');
  assert.equal(mediaKind({ type: 'text/plain' }), null);
});

test('typingLabel', () => {
  assert.equal(typingLabel([]), '');
  assert.equal(typingLabel(['Bia']), 'Bia está digitando…');
  assert.equal(typingLabel(['Bia', 'Caio']), 'Bia e Caio estão digitando…');
  assert.equal(typingLabel(['a', 'b', 'c']), '3 pessoas estão digitando…');
});

test('filterConversations ignora acento e procura na última mensagem', () => {
  const conv = (id: string, name: string, last: string): ConversationItem => ({ id, type: 'GROUP', other: null, name, imageUrl: null, memberCount: 3, lastMessage: msg(id, 'x', { body: last }), unread: 0, canSend: true, pinned: false, muted: false });
  const items = [conv('1', 'Futebol de quinta', 'bora?'), conv('2', 'Família', 'almoço domingo')];
  assert.deepEqual(filterConversations(items, 'familia').map((c) => c.id), ['2']);
  assert.deepEqual(filterConversations(items, 'ALMOCO').map((c) => c.id), ['2']);
  assert.deepEqual(filterConversations(items, 'quinta bora').map((c) => c.id), ['1']);
  assert.equal(filterConversations(items, '  ').length, 2);
});

test('puxar para responder: curva de borracha e ponto de disparo', async () => {
  const { rubberOffset, swipeTriggered } = await import('./swipe.ts');
  assert.equal(rubberOffset(-20), 0);
  assert.equal(rubberOffset(0), 0);
  assert.ok(rubberOffset(30) > 20 && rubberOffset(30) < 30);
  assert.ok(rubberOffset(2000) < 96);
  assert.equal(swipeTriggered(rubberOffset(20)), false);
  assert.equal(swipeTriggered(rubberOffset(120)), true);
});

test('selecionar várias: copiar e apagar', () => {
  const a = msg('1', '2026-10-14T13:00:00Z', { body: 'oi', mine: true });
  const b = msg('2', '2026-10-14T13:01:00Z', { body: 'tudo bem?', senderName: 'Bia' });
  const foto = msg('3', '2026-10-14T13:02:00Z', { kind: 'IMAGE', mine: true });
  assert.equal(copyText([a]), 'oi');
  assert.match(copyText([a, b]), /^\[\d\d:\d\d\] Você: oi\n\[\d\d:\d\d\] Bia: tudo bem\?$/);
  assert.match(copyText([a, foto]), /Você: oi$/);
  assert.equal(copyText([foto]), '');
  assert.equal(allDeletable([a, foto]), true);
  assert.equal(allDeletable([a, b]), false);
  assert.equal(allDeletable([]), false);
  assert.equal(allDeletable([msg('4', 'x', { mine: true, deleted: true })]), false);
  assert.equal(selectable(msg('5', 'x', { kind: 'SYSTEM' })), false);
  assert.equal(selectable(a), true);
});
