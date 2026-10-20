import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DWELL_BATCH_MAX, DWELL_MAX_MS, DWELL_RETENTION_DAYS } from './dwell-service.ts';
import { addFeatures, decay, directCloseness, emptyTaste, finalScore, hashtagsOf, RECO_MIN_STICKY_MS, stickyThreshold, stickyWeight, tasteSimilarity } from './recommendation-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'eva');
  const [ana, bia, caio, eva] = [u['ana']!, u['bia']!, u['caio']!, u['eva']!];
  for (const f of [bia, caio]) {
    await w.core.follows.follow(ana, f);
    await w.core.follows.follow(f, ana);
  }
  await w.core.follows.follow(bia, eva);
  await w.core.follows.follow(eva, bia);
  await w.places.createVenue({ id: 'v1', name: 'Casa do Samba', address: null, category: 'samba', lat: 0, lng: 0, isSample: false });
  await w.places.createVenue({ id: 'v2', name: 'Pub Rock', address: null, category: 'pub', lat: 0, lng: 0, isSample: false });
  return { w, ana, bia, caio, eva };
}
type World = Awaited<ReturnType<typeof setup>>['w'];

async function event(w: World, id: string, venueId: string, inH: number, kind: 'SHOW' | 'NIGHT' | 'OTHER' = 'SHOW', tags: string[] = []) {
  const at = w.clock.now().getTime();
  await w.places.createEvent({ id, venueId, title: `Evento ${id}`, description: null, kind, isFree: false, imageUrl: null, tags, startsAt: new Date(at + inH * H), endsAt: new Date(at + (inH + 3) * H), isSample: false });
}
const ids = (r: { items: { event: { id: string } | null; post: { id: string } | null }[] }) => r.items.map((i) => i.event?.id ?? i.post?.id);

describe('motor de recomendação', () => {
  it('amigo mais próximo (mais interação) pesa mais nos eventos a que vai', async () => {
    const { w, ana, bia, caio } = await setup();
    await event(w, 'e-bia', 'v1', 30);
    await event(w, 'e-caio', 'v2', 30);
    await w.eventRoom.addGoing({ source: 'PLACE', id: 'e-bia' }, bia, w.clock.now());
    await w.eventRoom.addGoing({ source: 'PLACE', id: 'e-caio' }, caio, w.clock.now());
    const post = await w.core.posts.create(bia, { caption: 'oi', images: [JPEG] });
    await w.core.posts.like(ana, post.id);
    await w.core.posts.addComment(ana, post.id, 'show!');
    const r = await w.core.recommendations.recommend(ana);
    assert.deepEqual(ids(r), ['e-bia', 'e-caio']);
    assert.ok(r.items[0]!.score > r.items[1]!.score);
    assert.deepEqual(r.items[0]!.friendsGoing.map((p) => p.username), ['bia']);
    assert.equal(r.items[0]!.reasons[0], 'bia vai');
  });

  it('quem você mais conversa 1 a 1 pesa mais, sem ler o texto; com a personalização desligada não conta', async () => {
    const { w, ana, bia, caio } = await setup();
    await event(w, 'e-bia', 'v1', 30);
    await event(w, 'e-caio', 'v2', 30);
    await w.eventRoom.addGoing({ source: 'PLACE', id: 'e-bia' }, bia, w.clock.now());
    await w.eventRoom.addGoing({ source: 'PLACE', id: 'e-caio' }, caio, w.clock.now());
    const chat = await w.core.conversations.open(ana, caio);
    for (const body of ['oi', 'bora?', 'vamos sim']) await w.core.conversations.send(ana, chat.id, { body });
    await w.core.conversations.send(caio, chat.id, { body: 'fechou' });
    const r = await w.core.recommendations.recommend(ana);
    assert.deepEqual(ids(r), ['e-caio', 'e-bia']);
    const off = await w.core.recommendations.recommend(ana, { personalize: false });
    assert.equal(off.items[0]!.score, off.items[1]!.score, 'sem personalizar, os dois valem igual');
  });

  it('post que amigo curtiu aparece, sem dizer quem curtiu', async () => {
    const { w, ana, bia, eva } = await setup();
    const post = await w.core.posts.create(eva, { caption: 'noite boa #samba', images: [JPEG] });
    await w.core.posts.like(bia, post.id);
    const r = await w.core.recommendations.recommend(ana);
    assert.deepEqual(ids(r), [post.id]);
    assert.equal(r.items[0]!.friendsEngaged, 1);
    assert.deepEqual(r.items[0]!.friendsGoing, []);
    assert.ok(!JSON.stringify(r.items[0]!.reasons).includes('bia'));
  });

  it('não recomenda post que a pessoa não pode ver (perfil privado) nem o que ela já curtiu', async () => {
    const { w, ana, bia, eva } = await setup();
    await w.core.profiles.setPrivacy(eva, true);
    const hidden = await w.core.posts.create(eva, { caption: 'privado', images: [JPEG] });
    await w.core.posts.like(bia, hidden.id);
    assert.deepEqual((await w.core.recommendations.recommend(ana)).items, []);
    await w.core.profiles.setPrivacy(eva, false);
    const open = await w.core.posts.create(eva, { caption: 'aberto', images: [JPEG] });
    await w.core.posts.like(bia, open.id);
    assert.ok(ids(await w.core.recommendations.recommend(ana)).includes(open.id));
    await w.core.posts.like(ana, open.id);
    assert.ok(!ids(await w.core.recommendations.recommend(ana)).includes(open.id));
  });

  it('não recomenda evento a que a pessoa já vai', async () => {
    const { w, ana, bia } = await setup();
    await event(w, 'e1', 'v1', 30);
    await w.eventRoom.addGoing({ source: 'PLACE', id: 'e1' }, bia, w.clock.now());
    assert.deepEqual(ids(await w.core.recommendations.recommend(ana)), ['e1']);
    await w.eventRoom.addGoing({ source: 'PLACE', id: 'e1' }, ana, w.clock.now());
    assert.deepEqual((await w.core.recommendations.recommend(ana)).items, []);
  });

  it('conteúdo que prendeu (mais tempo que a média) vira gosto e traz eventos parecidos, mesmo sem amigos', async () => {
    const { w, ana } = await setup();
    await event(w, 'visto', 'v1', 30, 'SHOW', ['samba']);
    await event(w, 'parecido', 'v1', 50, 'SHOW', ['samba']);
    await event(w, 'outro', 'v2', 50, 'NIGHT', ['rock']);
    await w.core.dwell.record(ana, [{ targetType: 'EVENT', targetId: 'visto', ms: 15_000, source: 'FEED' }]);
    const r = await w.core.recommendations.recommend(ana);
    const got = ids(r);
    assert.ok(got.includes('parecido'));
    assert.ok(!got.includes('outro'));
    assert.ok(r.items.find((i) => i.event?.id === 'parecido')!.reasons.includes('Tem a ver com #samba'));
  });

  it('tempo abaixo da média da pessoa não conta como gosto', async () => {
    const { w, ana } = await setup();
    await event(w, 'curto', 'v1', 30, 'SHOW', ['samba']);
    await event(w, 'parecido', 'v1', 50, 'SHOW', ['samba']);
    const filler = Array.from({ length: 9 }, (_, i) => ({ targetType: 'POST', targetId: `p${i}`, ms: 40_000, source: 'FEED' }));
    await w.core.dwell.record(ana, filler);
    await w.core.dwell.record(ana, [{ targetType: 'EVENT', targetId: 'curto', ms: 6000, source: 'FEED' }]);
    assert.deepEqual((await w.core.recommendations.recommend(ana)).items, []);
  });

  it('com a personalização desligada, só vale o que os amigos fizeram', async () => {
    const { w, ana, bia } = await setup();
    await event(w, 'visto', 'v1', 30, 'SHOW', ['samba']);
    await event(w, 'parecido', 'v1', 50, 'SHOW', ['samba']);
    await w.core.dwell.record(ana, [{ targetType: 'EVENT', targetId: 'visto', ms: 15_000, source: 'FEED' }]);
    assert.ok(ids(await w.core.recommendations.recommend(ana)).includes('parecido'));
    const off = await w.core.recommendations.recommend(ana, { personalize: false });
    assert.equal(off.personalized, false);
    assert.deepEqual(off.items, []);
    await event(w, 'amigo', 'v2', 40);
    await w.eventRoom.addGoing({ source: 'PLACE', id: 'amigo' }, bia, w.clock.now());
    assert.deepEqual(ids(await w.core.recommendations.recommend(ana, { personalize: false })), ['amigo']);
  });

  it('evento mostrado no bloco várias vezes sem clique para de aparecer', async () => {
    const { w, ana, bia } = await setup();
    await event(w, 'e1', 'v1', 30);
    await w.eventRoom.addGoing({ source: 'PLACE', id: 'e1' }, bia, w.clock.now());
    for (let i = 0; i < 3; i += 1) await w.core.dwell.record(ana, [{ targetType: 'EVENT', targetId: 'e1', ms: 800, source: 'RECO' }]);
    assert.deepEqual((await w.core.recommendations.recommend(ana)).items, []);
  });

  it('no máximo 2 itens do mesmo local', async () => {
    const { w, ana, bia } = await setup();
    for (const n of [1, 2, 3, 4]) {
      await event(w, `e${n}`, 'v1', 20 + n);
      await w.eventRoom.addGoing({ source: 'PLACE', id: `e${n}` }, bia, w.clock.now());
    }
    assert.equal((await w.core.recommendations.recommend(ana)).items.length, 2);
  });

  it('valida o limite', async () => {
    const { w, ana } = await setup();
    await rejectsWith(w.core.recommendations.recommend(ana, { limit: 0 }), 'VALIDATION');
    await rejectsWith(w.core.recommendations.recommend(ana, { limit: 11 }), 'VALIDATION');
  });
});

describe('medição de permanência', () => {
  it('guarda, ignora passada rápida, limita o teto e apaga tudo a pedido', async () => {
    const { w, ana, bia } = await setup();
    const r = await w.core.dwell.record(ana, [
      { targetType: 'POST', targetId: 'a', ms: 100 },
      { targetType: 'POST', targetId: 'b', ms: 5000, source: 'FEED' },
      { targetType: 'EVENT', targetId: 'c', ms: 9_999_999, source: 'RECO' },
    ]);
    assert.equal(r.saved, 2);
    assert.equal(w.dwell.rows.find((x) => x.targetId === 'c')!.ms, DWELL_MAX_MS);
    await w.core.dwell.record(bia, [{ targetType: 'POST', targetId: 'z', ms: 5000 }]);
    assert.deepEqual(await w.core.dwell.erase(ana), { removed: 2 });
    assert.equal(w.dwell.rows.length, 1, 'só apaga o da própria pessoa');
  });

  it('apaga medições com mais de 60 dias ao gravar', async () => {
    const { w, ana } = await setup();
    await w.core.dwell.record(ana, [{ targetType: 'POST', targetId: 'velho', ms: 5000 }]);
    w.clock.tick((DWELL_RETENTION_DAYS + 1) * 24 * H);
    await w.core.dwell.record(ana, [{ targetType: 'POST', targetId: 'novo', ms: 5000 }]);
    assert.deepEqual(w.dwell.rows.map((x) => x.targetId), ['novo']);
  });

  it('recusa envio inválido', async () => {
    const { w, ana } = await setup();
    await rejectsWith(w.core.dwell.record(ana, []), 'VALIDATION');
    await rejectsWith(w.core.dwell.record(ana, Array.from({ length: DWELL_BATCH_MAX + 1 }, () => ({ targetType: 'POST', targetId: 'x', ms: 2000 }))), 'VALIDATION');
    await rejectsWith(w.core.dwell.record(ana, [{ targetType: 'USER', targetId: 'x', ms: 2000 }]), 'VALIDATION');
    await rejectsWith(w.core.dwell.record(ana, [{ targetType: 'POST', targetId: '', ms: 2000 }]), 'VALIDATION');
    await rejectsWith(w.core.dwell.record(ana, [{ targetType: 'POST', targetId: 'x', ms: 'muito' }]), 'VALIDATION');
    await rejectsWith(w.core.dwell.record(ana, [{ targetType: 'POST', targetId: 'x', ms: 2000, source: 'AMIGO' }]), 'VALIDATION');
  });
});

describe('contas do motor de recomendação', () => {
  it('interação antiga vale menos (meia-vida de 14 dias)', () => {
    const now = new Date('2026-10-20T00:00:00Z');
    assert.equal(decay(now, now), 1);
    assert.ok(Math.abs(decay(new Date('2026-10-06T00:00:00Z'), now) - 0.5) < 1e-9);
  });
  it('limite de "prendeu": média da pessoa, nunca abaixo do piso', () => {
    assert.equal(stickyThreshold([{ ms: 100000 }]), RECO_MIN_STICKY_MS, 'poucas medições: só o piso');
    const rows = Array.from({ length: 10 }, () => ({ ms: 10_000 }));
    assert.equal(stickyThreshold(rows), 10_000);
    assert.equal(stickyThreshold(Array.from({ length: 10 }, () => ({ ms: 1000 }))), RECO_MIN_STICKY_MS);
  });
  it('peso só aparece acima do limite e cresce devagar', () => {
    assert.equal(stickyWeight(9000, 10_000), 0);
    assert.equal(stickyWeight(10_000, 10_000), 0);
    assert.ok(stickyWeight(20_000, 10_000) > 1);
    assert.equal(stickyWeight(10_000_000, 10_000), 2);
  });
  it('proximidade por mensagens: log por dia, quem manda pesa mais, antigo vale menos', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    const row = (otherId: string, at: string, mine: boolean) => ({ otherId, at: new Date(at), mine });
    const sentTwenty = directCloseness(Array.from({ length: 20 }, () => row('a', '2026-10-20T10:00:00Z', true)), now).get('a')!;
    const sentTwo = directCloseness([row('a', '2026-10-20T10:00:00Z', true), row('a', '2026-10-20T11:00:00Z', true)], now).get('a')!;
    assert.ok(sentTwenty > sentTwo && sentTwenty < sentTwo * 3, 'cresce devagar');
    const received = directCloseness([row('a', '2026-10-20T10:00:00Z', false)], now).get('a')!;
    const sent = directCloseness([row('a', '2026-10-20T10:00:00Z', true)], now).get('a')!;
    assert.ok(sent > received);
    const old = directCloseness([row('a', '2026-09-22T10:00:00Z', true)], now).get('a')!;
    assert.ok(old < sent / 3);
    const spread = directCloseness([row('a', '2026-10-19T10:00:00Z', true), row('a', '2026-10-20T10:00:00Z', true)], now).get('a')!;
    assert.ok(spread > sentTwo, 'dias diferentes somam mais que o mesmo dia');
    assert.equal(directCloseness([], now).size, 0);
  });
  it('hashtags da legenda', () => {
    assert.deepEqual(hashtagsOf('Noite #Samba e #samba com #Pagode_Raiz'), ['samba', 'pagode_raiz']);
    assert.deepEqual(hashtagsOf(null), []);
  });
  it('semelhança com o gosto', () => {
    const t = emptyTaste();
    addFeatures(t, { tags: ['samba'], kind: 'SHOW', venueId: 'v1', authorId: null, category: 'samba' }, 1);
    const same = tasteSimilarity(t, { tags: ['samba'], kind: 'SHOW', venueId: 'v1', authorId: null, category: 'samba' });
    const half = tasteSimilarity(t, { tags: ['samba'], kind: 'NIGHT', venueId: 'v9', authorId: null, category: null });
    assert.equal(same, 1);
    assert.equal(half, 0.25);
    assert.equal(tasteSimilarity(t, { tags: [], kind: 'OTHER', venueId: null, authorId: null, category: null }), 0);
  });
  it('nota: amigos e gosto pesam mais que novidade; sem personalização o social leva tudo', () => {
    assert.equal(finalScore(1, 1, 1, true), 1);
    assert.equal(finalScore(0, 0, 1, true), 0.1);
    assert.equal(finalScore(2, 0, 0, true), 0.55, 'social passa de 1 mas é cortado');
    assert.equal(finalScore(1, 1, 0, false), 0.9);
  });
});
