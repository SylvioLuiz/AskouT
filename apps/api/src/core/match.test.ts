import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MATCH_MAX_INTERESTS, audienceBucket, roundCoordinate, validatedInterests } from './match.ts';
import type { InterestSignal } from './match.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const DAY = 24 * H;
const NOW = new Date('2026-10-13T12:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const sig = (key: string, days: number, weight: number, tags = ['rock']): InterestSignal => ({ contentKey: key, at: ago(days), weight, tags });

describe('regra do gosto validado', () => {
  it('valida com 3 conteúdos, em 2 dias, peso suficiente e gesto recente', () => {
    const r = validatedInterests([sig('POST:a', 1, 1.5), sig('POST:b', 2, 1.5), sig('EVENT:c', 3, 2.5)], NOW);
    assert.deepEqual(r.map((i) => [i.tag, i.contents, i.days]), [['rock', 3, 3]]);
  });

  it('não valida com menos de 3 conteúdos diferentes, mesmo com muitos gestos no mesmo post', () => {
    const r = validatedInterests([sig('POST:a', 1, 2.5), sig('POST:a', 2, 2.5), sig('POST:a', 3, 2.5), sig('POST:b', 4, 2.5)], NOW);
    assert.deepEqual(r, []);
  });

  it('não valida se tudo aconteceu no mesmo dia', () => {
    const r = validatedInterests([sig('POST:a', 1, 2.5), sig('POST:b', 1, 2.5), sig('POST:c', 1, 2.5)], NOW);
    assert.deepEqual(r, []);
  });

  it('não valida se o peso somado é pequeno', () => {
    const r = validatedInterests([sig('POST:a', 1, 1), sig('POST:b', 2, 1), sig('POST:c', 3, 1)], NOW);
    assert.deepEqual(r, [], 'três toques leves somam 3, abaixo de 4');
  });

  it('não valida gosto antigo: o último gesto precisa ser dos últimos 30 dias', () => {
    const r = validatedInterests([sig('POST:a', 35, 2.5), sig('POST:b', 40, 2.5), sig('POST:c', 45, 2.5), sig('POST:d', 50, 2.5)], NOW);
    assert.deepEqual(r, []);
  });

  it('o peso envelhece: gestos de 60 dias valem um quarto', () => {
    const fresh = validatedInterests([sig('POST:a', 1, 2.5), sig('POST:b', 2, 2.5), sig('POST:c', 3, 2.5)], NOW)[0]!;
    const oldOnes = validatedInterests([sig('POST:a', 1, 2.5), sig('POST:b', 58, 2.5), sig('POST:c', 59, 2.5)], NOW);
    assert.ok(fresh.weight > 6);
    assert.deepEqual(oldOnes, [], 'um gesto novo e dois de dois meses atrás não chegam a 4');
  });

  it('cada hashtag é avaliada sozinha e só as 5 mais fortes ficam', () => {
    const signals: InterestSignal[] = [];
    for (let t = 0; t < 7; t++) for (let n = 0; n < 3; n++) signals.push(sig(`POST:${t}-${n}`, n + 1, 2 + t * 0.1, [`tag${t}`]));
    const r = validatedInterests(signals, NOW);
    assert.equal(r.length, MATCH_MAX_INTERESTS);
    assert.deepEqual(r.map((i) => i.tag), ['tag6', 'tag5', 'tag4', 'tag3', 'tag2'], 'do mais forte para o mais fraco');
  });

  it('uma hashtag repetida no mesmo conteúdo conta uma vez', () => {
    const r = validatedInterests([sig('POST:a', 1, 2.5, ['rock', 'rock']), sig('POST:b', 2, 2.5, ['rock']), sig('POST:c', 3, 2.5, ['rock'])], NOW);
    assert.equal(r[0]!.contents, 3);
  });
});

describe('números do Match', () => {
  it('arredonda a coordenada para ~1 km', () => {
    assert.equal(roundCoordinate(-23.55123), -23.55);
    assert.equal(roundCoordinate(-46.636), -46.64);
  });

  it('esconde o número abaixo de 10 e arredonda para baixo de 10 em 10', () => {
    assert.deepEqual(audienceBucket(0), { low: true, people: null, label: 'menos de 10 pessoas' });
    assert.deepEqual(audienceBucket(9), { low: true, people: null, label: 'menos de 10 pessoas' });
    assert.deepEqual(audienceBucket(10), { low: false, people: 10, label: 'cerca de 10 pessoas' });
    assert.deepEqual(audienceBucket(47), { low: false, people: 40, label: 'cerca de 40 pessoas' });
  });
});

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('dono', 'ana', 'bia', 'caio', 'eva');
  const [dono, ana, bia, caio, eva] = [u['dono']!, u['ana']!, u['bia']!, u['caio']!, u['eva']!];
  // Bar no centro de São Paulo.
  await w.places.createVenue({ id: 'v1', name: 'Casa do Rock', address: null, category: 'bar', lat: -23.55, lng: -46.63, isSample: false, ownerId: dono });
  const at = w.clock.now().getTime();
  const mk = (id: string, startsAt: number, tags: string[], title = id) => w.places.createEvent({ id, venueId: 'v1', title, description: null, startsAt: new Date(startsAt), endsAt: new Date(startsAt + 3 * H), kind: 'SHOW', isFree: false, imageUrl: null, tags, isSample: false });
  await mk('noite', at + 30 * H, ['rock', 'metal'], 'Noite do Rock');
  await mk('sem-tag', at + 40 * H, [], 'Sem hashtag');
  // Eventos do passado, só para a pessoa ter histórico de "vou".
  for (let i = 1; i <= 3; i++) await mk(`passado${i}`, at - (i * 2 + 1) * DAY, ['rock'], `Passado ${i}`);
  /** A pessoa confirmou presença em 3 rocks em dias diferentes: gosto validado por #rock. */
  const likesRock = async (id: string) => {
    for (let i = 1; i <= 3; i++) await w.eventRoom.addGoing({ source: 'PLACE', id: `passado${i}` }, id, new Date(at - i * DAY));
  };
  const region = (id: string, lat: number, lng: number) => w.core.regions.set(id, { lat, lng });
  return { w, dono, ana, bia, caio, eva, likesRock, region, at };
}

describe('Minha região', () => {
  it('guarda só a coordenada arredondada, troca, mostra e apaga', async () => {
    const { w, ana } = await setup();
    assert.deepEqual(await w.core.regions.get(ana), { region: null });
    const saved = await w.core.regions.set(ana, { lat: -23.55123, lng: -46.63456 });
    assert.deepEqual([saved.region.lat, saved.region.lng], [-23.55, -46.63]);
    await w.core.regions.set(ana, { lat: -23.6, lng: -46.7 });
    assert.deepEqual((await w.core.regions.get(ana)).region && [(await w.core.regions.get(ana)).region!.lat, (await w.core.regions.get(ana)).region!.lng], [-23.6, -46.7]);
    assert.deepEqual(await w.core.regions.clear(ana), { removed: true });
    assert.deepEqual(await w.core.regions.clear(ana), { removed: false });
    assert.deepEqual(await w.core.regions.get(ana), { region: null });
  });

  it('recusa coordenada inválida', async () => {
    const { w, ana } = await setup();
    await rejectsWith(w.core.regions.set(ana, { lat: 91, lng: 0 }), 'VALIDATION');
    await rejectsWith(w.core.regions.set(ana, { lat: 0, lng: '1' }), 'VALIDATION');
    await rejectsWith(w.core.regions.set(ana, { lat: Number.NaN, lng: 0 }), 'VALIDATION');
    await rejectsWith(w.core.regions.set(ana, {}), 'VALIDATION');
  });
});

describe('comprar o Match', () => {
  it('valida alcance, raio e hashtags (só as do próprio evento)', async () => {
    const { w, dono } = await setup();
    const base = { target: 'EVENT', eventId: 'noite', days: 1, audience: 'MATCH', radiusKm: 5, tags: ['rock'] };
    await rejectsWith(w.core.boosts.create(dono, 'v1', { ...base, audience: 'TODOS' }), 'VALIDATION');
    await rejectsWith(w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 1, audience: 'MATCH', radiusKm: 5, tags: ['rock'] }), 'VALIDATION', 'Match só para evento');
    await rejectsWith(w.core.boosts.create(dono, 'v1', { ...base, radiusKm: 3 }), 'VALIDATION', 'raio fora da lista');
    await rejectsWith(w.core.boosts.create(dono, 'v1', { ...base, radiusKm: undefined }), 'VALIDATION');
    await rejectsWith(w.core.boosts.create(dono, 'v1', { ...base, tags: [] }), 'VALIDATION');
    await rejectsWith(w.core.boosts.create(dono, 'v1', { ...base, tags: ['sertanejo'] }), 'VALIDATION', 'hashtag que o evento não tem');
    await rejectsWith(w.core.boosts.create(dono, 'v1', { ...base, tags: 'rock' }), 'VALIDATION');
    await rejectsWith(w.core.boosts.create(dono, 'v1', { ...base, eventId: 'sem-tag' }), 'VALIDATION', 'evento sem hashtags');
    const ok = await w.core.boosts.create(dono, 'v1', { ...base, tags: ['rock', 'rock', 'metal'] });
    assert.deepEqual([ok.audience, ok.radiusKm, ok.matchTags, ok.phase], ['MATCH', 5, ['rock', 'metal'], 'PENDING_PAYMENT']);
  });

  it('sem informar alcance continua sendo destaque para todos', async () => {
    const { w, dono } = await setup();
    const b = await w.core.boosts.create(dono, 'v1', { target: 'EVENT', eventId: 'noite', days: 1 });
    assert.deepEqual([b.audience, b.radiusKm, b.matchTags], ['ALL', null, []]);
  });

  it('o anúncio Match não aparece como destaque geral no Explorar', async () => {
    const { w, dono, bia } = await setup();
    const b = await w.core.boosts.create(dono, 'v1', { target: 'EVENT', eventId: 'noite', days: 1, audience: 'MATCH', radiusKm: 5, tags: ['rock'] });
    await w.core.boosts.simulatePayment(dono, b.id);
    assert.equal((await w.core.boosts.activeTargets(w.clock.now())).eventIds.size, 0);
    assert.deepEqual((await w.core.explore.sponsored(bia)).events, []);
  });

  it('só o responsável vê a estimativa; mostra faixa, nunca quem', async () => {
    const { w, dono, ana, likesRock, region } = await setup();
    await likesRock(ana);
    await region(ana, -23.56, -46.64);
    const q = { eventId: 'noite', radiusKm: 5, tags: ['rock'] };
    await rejectsWith(w.core.boosts.estimate(ana, 'v1', q), 'NOT_FOUND');
    const est = await w.core.boosts.estimate(dono, 'v1', q);
    assert.deepEqual(est, { low: true, people: null, label: 'menos de 10 pessoas', partial: false });
    assert.ok(!JSON.stringify(est).includes(ana));
    await rejectsWith(w.core.boosts.estimate(dono, 'v1', { ...q, radiusKm: 4 }), 'VALIDATION');
  });

  it('a estimativa conta só quem tem região, mora no raio e tem o gosto validado; chega a 10 e mostra o número', async () => {
    const { w, dono, likesRock, region } = await setup();
    const fans = Object.values(await w.signUpMany(...Array.from({ length: 12 }, (_, i) => `fa${i}`)));
    for (const f of fans) {
      await likesRock(f);
      await region(f, -23.56, -46.64);
    }
    const q = { eventId: 'noite', radiusKm: 5, tags: ['rock'] };
    assert.equal((await w.core.boosts.estimate(dono, 'v1', q)).people, 10, '12 pessoas aparecem como "cerca de 10"');
    await w.core.regions.set(fans[0]!, { lat: -22.9, lng: -43.2 });
    await w.core.regions.clear(fans[1]!);
    await w.core.blocks.block(dono, fans[2]!);
    assert.equal((await w.core.boosts.estimate(dono, 'v1', q)).people, null, 'fora do raio, sem região e bloqueado saem: 9 pessoas ficam abaixo de 10');
    assert.equal((await w.core.boosts.estimate(dono, 'v1', { ...q, tags: ['metal'] })).people, null, 'quem gosta de rock não casa com #metal');
  });
});

describe('Match no Para você', () => {
  async function paid() {
    const s = await setup();
    const b = await s.w.core.boosts.create(s.dono, 'v1', { target: 'EVENT', eventId: 'noite', days: 3, audience: 'MATCH', radiusKm: 5, tags: ['rock'] });
    await s.w.core.boosts.simulatePayment(s.dono, b.id);
    return s;
  }
  const sponsoredOf = (r: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['w']['core']['recommendations']['recommend']>>) => r.items.filter((i) => i.sponsored);

  it('aparece para quem mora no raio e tem o gosto validado, dizendo por quê, sem dados de outras pessoas', async () => {
    const { w, ana, likesRock, region } = await paid();
    await likesRock(ana);
    await region(ana, -23.57, -46.65);
    const r = await w.core.recommendations.recommend(ana);
    const [item] = sponsoredOf(r);
    assert.equal(item?.event?.id, 'noite');
    assert.equal(item?.match?.tag, 'rock');
    assert.equal(item?.match?.distanceKm, 3);
    assert.deepEqual(item?.reasons, ['Combina com você: #rock', 'A cerca de 3 km de você']);
    assert.equal(sponsoredOf(r).length, 1);
    assert.equal(r.items.filter((i) => i.event?.id === 'noite').length, 1, 'sem repetir o mesmo evento');
  });

  it('não aparece sem gosto validado, sem região, fora do raio ou com a personalização desligada', async () => {
    const { w, ana, bia, caio, eva, likesRock, region } = await paid();
    await region(bia, -23.56, -46.64); // perto, mas sem gosto
    await likesRock(caio);
    await region(caio, -22.9, -43.2); // gosto, mas longe (Rio)
    await likesRock(eva); // gosto, mas sem região
    await likesRock(ana);
    await region(ana, -23.56, -46.64);
    for (const id of [bia, caio, eva]) assert.deepEqual(sponsoredOf(await w.core.recommendations.recommend(id)), []);
    assert.deepEqual(sponsoredOf(await w.core.recommendations.recommend(ana, { personalize: false })), [], 'a pessoa desligou o uso do comportamento');
    assert.equal(sponsoredOf(await w.core.recommendations.recommend(ana)).length, 1, 'controle: com tudo ligado aparece');
    await w.core.regions.clear(ana);
    assert.deepEqual(sponsoredOf(await w.core.recommendations.recommend(ana)), [], 'apagar a região desliga o Match');
  });

  it('só casa se alguma hashtag validada da pessoa está entre as do anúncio', async () => {
    const { w, dono, ana, likesRock, region } = await setup();
    const b = await w.core.boosts.create(dono, 'v1', { target: 'EVENT', eventId: 'noite', days: 1, audience: 'MATCH', radiusKm: 5, tags: ['metal'] });
    await w.core.boosts.simulatePayment(dono, b.id);
    await likesRock(ana);
    await region(ana, -23.56, -46.64);
    assert.deepEqual(sponsoredOf(await w.core.recommendations.recommend(ana)), []);
  });

  it('não aparece para o dono, para quem bloqueou o dono, para quem já vai ou já compartilhou, nem depois de 3 exibições sem abrir', async () => {
    const { w, dono, ana, bia, likesRock, region, at } = await paid();
    for (const id of [dono, ana, bia]) {
      await likesRock(id);
      await region(id, -23.56, -46.64);
    }
    assert.deepEqual(sponsoredOf(await w.core.recommendations.recommend(dono)), []);
    assert.equal(sponsoredOf(await w.core.recommendations.recommend(ana)).length, 1);
    await w.core.blocks.block(bia, dono);
    assert.deepEqual(sponsoredOf(await w.core.recommendations.recommend(bia)), [], 'bloqueio nos dois sentidos');
    for (let i = 0; i < 3; i++) await w.core.dwell.record(ana, [{ targetType: 'EVENT', targetId: 'noite', ms: 2000, source: 'RECO' }]);
    assert.deepEqual(sponsoredOf(await w.core.recommendations.recommend(ana)), [], 'cansou de ver');
    await w.eventRoom.addGoing({ source: 'PLACE', id: 'noite' }, bia, new Date(at));
    await w.core.blocks.unblock(bia, dono);
    assert.deepEqual(sponsoredOf(await w.core.recommendations.recommend(bia)), [], 'quem já vai não precisa do anúncio');
  });

  it('não aparece antes do pagamento, depois do fim do período nem depois do evento', async () => {
    const { w, dono, ana, likesRock, region } = await setup();
    await likesRock(ana);
    await region(ana, -23.56, -46.64);
    const b = await w.core.boosts.create(dono, 'v1', { target: 'EVENT', eventId: 'noite', days: 1, audience: 'MATCH', radiusKm: 5, tags: ['rock'] });
    assert.deepEqual(sponsoredOf(await w.core.recommendations.recommend(ana)), [], 'sem pagar não aparece');
    await w.core.boosts.simulatePayment(dono, b.id);
    assert.equal(sponsoredOf(await w.core.recommendations.recommend(ana)).length, 1);
    w.clock.tick(25 * H);
    assert.deepEqual(sponsoredOf(await w.core.recommendations.recommend(ana)), [], 'o dia pago acabou');
  });

  it('o limite da lista continua valendo com o anúncio dentro', async () => {
    const { w, ana, likesRock, region } = await paid();
    await likesRock(ana);
    await region(ana, -23.56, -46.64);
    const r = await w.core.recommendations.recommend(ana, { limit: 1 });
    assert.equal(r.items.length, 1);
  });
});
