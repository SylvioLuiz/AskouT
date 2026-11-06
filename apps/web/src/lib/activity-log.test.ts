import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityDayLabel, activityDetail, activityPath, activitySentence, appendPage, groupByDay, type ActivityItem } from './activity-log.ts';

const bia = { userId: 'u-bia', username: 'bia', displayName: 'Bia', avatarUrl: null, isPrivate: false };
const item = (over: Partial<ActivityItem>): ActivityItem => ({ id: 'x', kind: 'LIKE', action: 'POST_LIKE', at: '2026-11-06T15:00:00.000Z', available: true, target: { type: 'POST', id: 'p1' }, person: bia, title: 'Noite boa', text: null, pending: false, ...over });

test('activityPath: cada item leva ao conteúdo de origem', () => {
  assert.equal(activityPath(item({})), '/posts/p1');
  assert.equal(activityPath(item({ target: { type: 'USER_EVENT', id: 'ev 1' } })), '/eventos/ev%201');
  assert.equal(activityPath(item({ target: { type: 'PLACE_EVENT', id: 'e1' } })), '/eventos/e1');
  assert.equal(activityPath(item({ action: 'FOLLOW_VENUE', target: { type: 'VENUE', id: 'v1' } })), '/bares/v1');
  assert.equal(activityPath(item({ action: 'FOLLOW_USER', target: { type: 'USER', id: 'u-bia' } })), '/u/bia');
  assert.equal(activityPath(item({ available: false, target: null, person: null })), undefined, 'indisponível: sem link');
});

test('activitySentence: frase simples para cada ação, também quando o conteúdo sumiu', () => {
  assert.equal(activitySentence(item({})), 'Você curtiu um post de @bia');
  assert.equal(activitySentence(item({ person: null })), 'Você curtiu o seu post');
  assert.equal(activitySentence(item({ action: 'FOLLOW_USER', pending: true })), 'Você pediu para seguir @bia');
  assert.equal(activitySentence(item({ action: 'EVENT_GOING', person: null, title: 'Samba' })), 'Você confirmou presença em Samba');
  assert.equal(activitySentence(item({ action: 'FEED_POST', person: null, title: 'Corrida', pending: true })), 'Você publicou em Corrida (esperando aprovação)');
  assert.equal(activitySentence(item({ action: 'POST_COMMENT', available: false, person: null })), 'Você comentou num conteúdo que não está mais disponível');
  assert.equal(activityDetail(item({})), 'Noite boa', 'post curtido mostra o começo da legenda');
  assert.equal(activityDetail(item({ action: 'POST_COMMENT', text: 'Que demais!' })), 'Que demais!');
});

test('groupByDay: agrupa por dia com Hoje, Ontem e a data', () => {
  const now = new Date('2026-11-06T18:00:00.000Z');
  const groups = groupByDay(
    [
      item({ id: 'a', at: '2026-11-06T17:00:00.000Z' }),
      item({ id: 'b', at: '2026-11-06T12:00:00.000Z' }),
      item({ id: 'c', at: '2026-11-05T12:00:00.000Z' }),
      item({ id: 'd', at: '2026-10-20T12:00:00.000Z' }),
    ],
    now,
  );
  assert.deepEqual(groups.map((g) => g.items.map((i) => i.id)), [['a', 'b'], ['c'], ['d']]);
  assert.deepEqual(groups.slice(0, 2).map((g) => g.label), ['Hoje', 'Ontem']);
  assert.match(groups[2]!.label, /20 de outubro/);
  assert.match(activityDayLabel('2025-10-20T12:00:00.000Z', now), /2025/, 'de outro ano mostra o ano');
  assert.equal(activityDayLabel('lixo', now), '');
});

test('appendPage: carregar mais não repete itens', () => {
  assert.deepEqual(appendPage([item({ id: 'a' })], [item({ id: 'a' }), item({ id: 'b' })]).map((i) => i.id), ['a', 'b']);
});
