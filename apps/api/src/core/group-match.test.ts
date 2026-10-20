import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { affinity, dateFitOf, finalScore, groupInterest } from './group-match-service.ts';
import type { TasteProfile } from './group-match-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;

async function trio() {
  const w = makeWorld();
  const { ana, bia, caio, dani } = await w.signUpMany('ana', 'bia', 'caio', 'dani');
  for (const [a, b] of [[ana!, bia!], [ana!, caio!]] as const) {
    await w.core.follows.follow(a, b);
    await w.core.follows.follow(b, a);
  }
  return { w, ana: ana!, bia: bia!, caio: caio!, dani: dani! };
}

async function venue(w: Awaited<ReturnType<typeof trio>>['w'], id: string, category: string) {
  await w.places.createVenue({ id, name: `Casa ${id}`, address: null, category, lat: -23.55, lng: -46.63, isSample: true });
}
async function event(w: Awaited<ReturnType<typeof trio>>['w'], id: string, venueId: string, inH: number, kind: 'SHOW' | 'NIGHT' | 'OTHER' = 'SHOW', tags: string[] = []) {
  const at = w.clock.now().getTime();
  await w.places.createEvent({ id, venueId, title: `Evento ${id}`, description: null, kind, isFree: false, imageUrl: null, tags, startsAt: new Date(at + inH * H), endsAt: new Date(at + (inH + 3) * H), isSample: true });
}

describe('motor de inteligência social', () => {
  it('sugere o evento que combina com o gosto do grupo e põe primeiro', async () => {
    const { w, ana, bia } = await trio();
    await venue(w, 'samba', 'samba');
    await venue(w, 'pub', 'pub');
    await event(w, 'e-samba', 'samba', 30, 'SHOW', ['samba']);
    await event(w, 'e-pub', 'pub', 30, 'NIGHT');
    await w.places.followVenue(ana, 'samba', w.clock.now());
    await w.places.followVenue(bia, 'samba', w.clock.now());
    const r = await w.core.groupMatch.suggest(ana, { friendIds: [bia] });
    assert.equal(r.people, 2);
    assert.equal(r.hasTaste, true);
    assert.deepEqual(r.items.map((i) => i.event.id), ['e-samba']);
    assert.ok(r.items[0]!.reasons.some((x) => /segue ou já foi/.test(x)));
    assert.ok(r.items[0]!.score > 50);
  });

  it('o histórico de presenças também conta como gosto', async () => {
    const { w, ana, bia } = await trio();
    await venue(w, 'bar', 'bar');
    await event(w, 'passado', 'bar', -48, 'SHOW');
    await event(w, 'novo', 'bar', 30, 'SHOW');
    for (const u of [ana, bia]) await w.eventRoom.addGoing({ source: 'PLACE', id: 'passado' }, u, w.clock.now());
    const r = await w.core.groupMatch.suggest(ana, { friendIds: [bia] });
    assert.deepEqual(r.items.map((i) => i.event.id), ['novo']);
  });

  it('descarta evento em que alguém marcou que não pode', async () => {
    const { w, ana, bia } = await trio();
    await venue(w, 'v', 'bar');
    await event(w, 'livre', 'v', 30);
    await event(w, 'ocupado', 'v', 60);
    await w.places.followVenue(ana, 'v', w.clock.now());
    const at = w.clock.now().getTime();
    await w.core.availability.addSlot(bia, { start: new Date(at + 59 * H).toISOString(), end: new Date(at + 64 * H).toISOString(), state: 'UNAVAILABLE' });
    const r = await w.core.groupMatch.suggest(ana, { friendIds: [bia] });
    assert.deepEqual(r.items.map((i) => i.event.id), ['livre']);
  });

  it('dia livre para todos vale mais que data sem informação', async () => {
    const { w, ana, bia } = await trio();
    await venue(w, 'v', 'bar');
    await event(w, 'a', 'v', 30);
    await event(w, 'b', 'v', 100);
    await w.places.followVenue(ana, 'v', w.clock.now());
    const at = w.clock.now().getTime();
    for (const u of [ana, bia]) await w.core.availability.addSlot(u, { start: new Date(at + 100 * H).toISOString(), end: new Date(at + 104 * H).toISOString(), state: 'AVAILABLE' });
    const r = await w.core.groupMatch.suggest(ana, { friendIds: [bia] });
    assert.equal(r.items[0]!.event.id, 'b');
    assert.equal(r.items[0]!.dateFit, 'ALL_FREE');
    assert.equal(r.items[1]!.dateFit, 'UNKNOWN');
  });

  it('sem gosto nenhum devolve lista vazia e avisa', async () => {
    const { w, ana, bia } = await trio();
    await venue(w, 'v', 'bar');
    await event(w, 'a', 'v', 30);
    const r = await w.core.groupMatch.suggest(ana, { friendIds: [bia] });
    assert.deepEqual(r, { people: 2, hasTaste: false, items: [] });
  });

  it('só para amigos e com entrada válida', async () => {
    const { w, ana, bia, dani } = await trio();
    await rejectsWith(w.core.groupMatch.suggest(ana, { friendIds: [dani] }), 'FORBIDDEN');
    await rejectsWith(w.core.groupMatch.suggest(ana, { friendIds: [] }), 'VALIDATION');
    await rejectsWith(w.core.groupMatch.suggest(ana, { friendIds: [bia], days: 99 }), 'VALIDATION');
    await rejectsWith(w.core.groupMatch.suggest(ana, { friendIds: [bia], limit: 0 }), 'VALIDATION');
  });

  it('a resposta não revela quem gosta do quê', async () => {
    const { w, ana, bia } = await trio();
    await venue(w, 'v', 'bar');
    await event(w, 'a', 'v', 30);
    await w.places.followVenue(bia, 'v', w.clock.now());
    const text = JSON.stringify(await w.core.groupMatch.suggest(ana, { friendIds: [bia] }));
    assert.ok(!text.includes(bia) && !text.includes('bia'));
  });
});

describe('contas do motor', () => {
  const taste = (): TasteProfile => ({ venueIds: new Set(['v']), categories: new Set(['bar']), kinds: new Map([['SHOW', 2]]), tags: new Set(['samba']) });
  const venueRec = { id: 'v', name: 'V', address: null, category: 'Bar', lat: 0, lng: 0, isSample: false } as never;
  const eventRec = (over: object) => ({ id: 'e', venueId: 'v', title: 't', description: null, startsAt: new Date(), endsAt: new Date(), kind: 'SHOW', isFree: false, imageUrl: null, tags: ['samba'], isSample: false, ...over }) as never;

  it('afinidade soma local, tipo, categoria e hashtags até 1', () => {
    assert.equal(affinity(taste(), eventRec({}), venueRec).value, 1);
    assert.equal(affinity(taste(), eventRec({ kind: 'NIGHT', tags: [] }), { ...(venueRec as object), id: 'x', category: null } as never).value, 0);
    assert.equal(affinity(taste(), eventRec({ kind: 'OTHER', tags: [] }), { ...(venueRec as object), id: 'x' } as never).value, 0.2);
  });
  it('grupo: pior caso pesa tanto quanto a média', () => {
    assert.equal(groupInterest([1, 1]), 1);
    assert.equal(groupInterest([1, 0]), 0.25);
    assert.equal(groupInterest([]), 0);
  });
  it('nível da agenda e nota final', () => {
    assert.equal(dateFitOf('red'), undefined);
    assert.equal(dateFitOf('awaiting', 1), undefined);
    assert.equal(dateFitOf('green'), 'ALL_FREE');
    assert.equal(finalScore(1, 'green'), 100);
    assert.equal(finalScore(1, 'awaiting'), 76);
    assert.equal(finalScore(0.5, 'orange'), 54);
  });
});
