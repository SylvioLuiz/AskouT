import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOTIFICATION_CATEGORIES, matchesNotificationFilter, notificationFilter } from './notification-categories.ts';
import { NOTIFICATIONS_PAGE } from './notification-service.ts';
import { makeWorld } from './testing/world.ts';
import type { NotificationType } from './types.ts';

describe('filtros da tela de notificações', () => {
  async function seed() {
    const w = makeWorld();
    const { ana } = (await w.signUpMany('ana')) as Record<string, string>;
    let n = 0;
    const add = (type: NotificationType, dedupeKey: string | null, minutesAgo: number) =>
      w.notifications.create({ id: `n${++n}`, userId: ana!, type, title: `${type} ${dedupeKey ?? ''}`, body: '', url: '/', dedupeKey, readAt: null, createdAt: new Date(w.clock.now().getTime() - minutesAgo * 60_000) });
    await add('POST_COMMENT', 'comment-mention:c1:u', 500);
    await add('FEED_MENTION', 'feed-comment-mention:c2:u', 400);
    await add('POST_TAG', 'post-tag:p1', 300);
    await add('POST_COMMENT', 'post-comment:c3', 200);
    await add('FEED_COMMENT', 'feed-comment:c4', 199);
    await add('POST_LIKE', 'post-like:p1:u', 198);
    await add('FEED_REACTION', 'feed-reaction:p2:u', 197);
    await add('FOLLOW_NEW', 'follow-new:u', 196);
    await add('MEETUP_INVITE', 'meetup-invite:m1', 195);
    await add('FLASH_INVITE', 'flash-invite:u', 194);
    await add('EVENT_REMINDER', 'event-reminder:e1', 193);
    await add('VENUE_CLAIM', null, 192);
    // Muitas mensagens mais novas: sem filtro no servidor, as menções antigas ficariam fora da página.
    for (let i = 0; i < NOTIFICATIONS_PAGE + 5; i += 1) await add('MESSAGE', `message:${i}`, i);
    return { w, ana: ana! };
  }

  it('cada chip traz só os seus tipos, e menção num comentário não conta como comentário', async () => {
    const { w, ana } = await seed();
    const types = async (category: string) => (await w.core.notifications.list(ana, category)).items.map((i) => `${i.type}`);
    assert.deepEqual(await types('mentions'), ['POST_TAG', 'FEED_MENTION', 'POST_COMMENT']);
    assert.deepEqual(await types('comments'), ['FEED_COMMENT', 'POST_COMMENT']);
    assert.deepEqual(await types('likes'), ['FEED_REACTION', 'POST_LIKE']);
    assert.deepEqual(await types('follows'), ['FOLLOW_NEW']);
    assert.deepEqual(await types('invites'), ['FLASH_INVITE', 'MEETUP_INVITE']);
    assert.deepEqual(await types('events'), ['EVENT_REMINDER']);
    const messages = await types('messages');
    assert.equal(messages.length, NOTIFICATIONS_PAGE);
    assert.ok(messages.every((t) => t === 'MESSAGE'));
  });

  it('o filtro vai ao banco: acha avisos que não caberiam na página sem filtro', async () => {
    const { w, ana } = await seed();
    const all = await w.core.notifications.list(ana);
    assert.equal(all.items.length, NOTIFICATIONS_PAGE);
    assert.ok(!all.items.some((i) => i.type === 'FEED_MENTION'));
    assert.equal((await w.core.notifications.list(ana, 'mentions')).items.length, 3);
    // O contador de não lidos é sempre o total.
    assert.equal((await w.core.notifications.list(ana, 'mentions')).unread, all.unread);
    assert.deepEqual((await w.core.notifications.list(ana, 'all')).items, all.items);
    assert.deepEqual((await w.core.notifications.list(ana, '')).items, all.items);
  });

  it('categoria desconhecida é recusada', async () => {
    const { w, ana } = await seed();
    await assert.rejects(() => w.core.notifications.list(ana, 'bananas'), /inválid/i);
    await assert.rejects(() => w.core.notifications.list(ana, ['mentions']), /inválid/i);
  });

  it('todo tipo de aviso cai em no máximo um chip, e menção/comentário com chave estranha não cai em nenhum', () => {
    const cats = NOTIFICATION_CATEGORIES.filter((c) => c !== 'all');
    const sample: Array<{ type: NotificationType; dedupeKey: string | null }> = [
      { type: 'POST_COMMENT', dedupeKey: 'comment-mention:x' },
      { type: 'POST_COMMENT', dedupeKey: 'post-comment:x' },
      { type: 'POST_COMMENT', dedupeKey: null },
      { type: 'FEED_NOTICE', dedupeKey: null },
      { type: 'MESSAGE', dedupeKey: null },
    ];
    const hits = sample.map((n) => cats.filter((c) => matchesNotificationFilter(n, notificationFilter(c))));
    assert.deepEqual(hits, [['mentions'], ['comments'], [], ['events'], ['messages']]);
  });
});
