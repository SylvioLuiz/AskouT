import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const JPEG = (n = 10) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]).toString('base64')}`;

/** Ana faz um pouco de tudo, um passo por segundo (a ordem do registro fica previsível). */
async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio');
  const ana = u['ana']!, bia = u['bia']!, caio = u['caio']!;
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: null, category: 'bar', lat: -23.5, lng: -46.6, isSample: false });
  await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Samba', description: null, kind: 'OTHER', isFree: true, imageUrl: null, tags: [], startsAt: new Date(w.clock.now().getTime() + 2 * H), endsAt: new Date(w.clock.now().getTime() + 5 * H), isSample: false });
  const step = () => w.clock.tick(1000);

  await w.core.follows.follow(ana, bia);
  step();
  await w.core.follows.follow(bia, ana);
  const biaPost = await w.core.posts.create(bia, { images: [JPEG()], caption: 'Noite boa no centro' });
  step();
  await w.core.posts.like(ana, biaPost.id);
  step();
  await w.core.posts.addComment(ana, biaPost.id, 'Que demais!');
  step();
  const mine = await w.core.posts.create(ana, { images: [JPEG()], caption: 'Meu post' });
  step();
  const start = new Date(w.clock.now().getTime() + 24 * H).toISOString();
  const ev = await w.core.posts.create(ana, { images: [JPEG()], placeName: 'Praça', event: { title: 'Corrida', startsAt: start } });
  step();
  await w.core.eventPages.go(ana, 'e1');
  step();
  const feedPost = await w.core.feed.create(ana, 'event', ev.id, { body: 'Ponto de encontro na praça' });
  step();
  await w.core.feed.react(ana, feedPost.id, '🔥');
  step();
  await w.core.venues.follow(ana, 'v1');
  step();
  await w.core.follows.follow(ana, caio);
  return { w, ana, bia, caio, biaPost, mine, ev, feedPost };
}

test('registro: tudo o que a pessoa fez, do mais recente ao mais antigo, com o destino de cada item', async () => {
  const { w, ana, bia, caio, biaPost, mine, ev } = await setup();
  const page = await w.core.activity.list(ana);
  assert.deepEqual(
    page.items.map((i) => i.action),
    ['FOLLOW_USER', 'FOLLOW_VENUE', 'FEED_REACTION', 'FEED_POST', 'EVENT_GOING', 'EVENT_CREATED', 'POST_CREATED', 'POST_COMMENT', 'POST_LIKE', 'FOLLOW_USER'],
  );
  assert.equal(page.nextCursor, null);
  const [followCaio, venue, reaction, feedPost, going, created, posted, comment, like, followBia] = page.items;
  assert.deepEqual([followCaio!.kind, followCaio!.target, followCaio!.person?.username], ['FOLLOW', { type: 'USER', id: caio }, 'caio']);
  assert.deepEqual([venue!.target, venue!.title], [{ type: 'VENUE', id: 'v1' }, 'Bar do Zé']);
  assert.deepEqual([reaction!.kind, reaction!.text, reaction!.target, reaction!.title, reaction!.person], ['LIKE', '🔥', { type: 'USER_EVENT', id: ev.id }, 'Corrida', null]);
  assert.deepEqual([feedPost!.kind, feedPost!.text, feedPost!.target], ['POST', 'Ponto de encontro na praça', { type: 'USER_EVENT', id: ev.id }]);
  assert.deepEqual([going!.kind, going!.target, going!.title], ['EVENT', { type: 'PLACE_EVENT', id: 'e1' }, 'Samba']);
  assert.deepEqual([created!.kind, created!.target, created!.title], ['EVENT', { type: 'USER_EVENT', id: ev.id }, 'Corrida']);
  assert.deepEqual([posted!.target, posted!.text], [{ type: 'POST', id: mine.id }, 'Meu post']);
  assert.deepEqual([comment!.kind, comment!.text, comment!.target, comment!.person?.userId, comment!.title], ['COMMENT', 'Que demais!', { type: 'POST', id: biaPost.id }, bia, 'Noite boa no centro']);
  assert.deepEqual([like!.kind, like!.available, like!.person?.username], ['LIKE', true, 'bia']);
  assert.equal(followBia!.person?.username, 'bia');
  assert.ok(page.items.every((i) => !Number.isNaN(Date.parse(i.at))));
  // Só a própria pessoa: o registro de Bia não mostra nada da Ana.
  assert.ok((await w.core.activity.list(bia)).items.every((i) => i.person?.userId !== bia));
});

test('registro: filtros por tipo e filtro inválido', async () => {
  const { w, ana } = await setup();
  const kinds = async (kind: string) => (await w.core.activity.list(ana, { kind })).items.map((i) => i.action);
  assert.deepEqual(await kinds('LIKE'), ['FEED_REACTION', 'POST_LIKE']);
  assert.deepEqual(await kinds('comment'), ['POST_COMMENT']);
  assert.deepEqual(await kinds('POST'), ['FEED_POST', 'POST_CREATED']);
  assert.deepEqual(await kinds('FOLLOW'), ['FOLLOW_USER', 'FOLLOW_VENUE', 'FOLLOW_USER']);
  assert.deepEqual(await kinds('EVENT'), ['EVENT_GOING', 'EVENT_CREATED']);
  assert.equal((await w.core.activity.list(ana, { kind: 'ALL' })).items.length, 10);
  await rejectsWith(w.core.activity.list(ana, { kind: 'TUDO' }), 'VALIDATION');
  await rejectsWith(w.core.activity.list(ana, { cursor: 'nada' }), 'VALIDATION');
});

test('registro: carregar mais segue de onde parou, sem repetir nem pular', async () => {
  const { w, ana } = await setup();
  const all = (await w.core.activity.list(ana)).items.map((i) => i.id);
  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await w.core.activity.list(ana, { limit: 3, ...(cursor ? { cursor } : {}) });
    assert.ok(page.items.length <= 3);
    seen.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor ?? undefined;
    pages += 1;
  } while (cursor);
  assert.equal(pages, 4);
  assert.deepEqual(seen, all);
});

test('registro: conteúdo apagado some; conta bloqueada ou suspensa não quebra a lista', async () => {
  const { w, ana, bia, caio, mine } = await setup();
  await w.core.posts.delete(ana, mine.id);
  assert.ok(!(await w.core.activity.list(ana)).items.some((i) => i.action === 'POST_CREATED'), 'post apagado sai do registro');

  await w.core.blocks.block(ana, bia);
  const afterBlock = await w.core.activity.list(ana);
  const like = afterBlock.items.find((i) => i.action === 'POST_LIKE')!;
  const comment = afterBlock.items.find((i) => i.action === 'POST_COMMENT')!;
  assert.deepEqual([like.available, like.target, like.person, like.title], [false, null, null, null]);
  assert.deepEqual([comment.available, comment.text, comment.title], [false, 'Que demais!', null], 'o próprio comentário continua legível');
  assert.ok(!afterBlock.items.some((i) => i.person?.userId === bia), 'seguir Bia saiu junto com o bloqueio');

  w.users.users.set(caio, { ...w.users.users.get(caio)!, status: 'SUSPENDED' });
  const follow = (await w.core.activity.list(ana, { kind: 'FOLLOW' })).items.find((i) => i.action === 'FOLLOW_USER')!;
  assert.deepEqual([follow.available, follow.person, follow.target], [false, null, null]);
});

test('registro: pedido para seguir perfil privado aparece como pendente', async () => {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'duda');
  const duda = u['duda']!;
  await w.core.profiles.setPrivacy(duda, true);
  await w.core.follows.follow(u['ana']!, duda);
  const [item] = (await w.core.activity.list(u['ana']!)).items;
  assert.deepEqual([item!.action, item!.pending, item!.person?.username], ['FOLLOW_USER', true, 'duda']);
});
