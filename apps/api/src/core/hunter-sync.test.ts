import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HunterBridge } from './hunter-bridge.ts';
import type { HunterEventFields, HunterLink, HunterStore, HunterTx, HunterVenueState } from './hunter-bridge.ts';
import { syncFromHunter } from './hunter-sync.ts';
import type { AckResult, FeedItem } from './hunter-sync.ts';

const NOW = new Date('2027-03-10T12:00:00Z');
const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const venue = (id: string, name: string, ownerId: string | null): HunterVenueState => ({ id, name, address: null, lat: -23.5, lng: -46.6, externalKey: null, ownerId, claimStatuses: [] });

function setup(enabled = true) {
  const venues = [venue(V1, 'Bar do Juarez', null), venue(V2, 'Casa do Dono', 'u1')];
  const events = new Map<string, HunterEventFields>();
  const links = new Map<string, HunterLink>();
  const tx: HunterTx = {
    venue: async (id) => venues.find((v) => v.id === id),
    link: async (ref) => links.get(ref),
    createEvent: async (id, link, f) => { events.set(id, f); links.set(link.ref, link); },
    updateEvent: async () => undefined,
    deleteEvent: async () => undefined,
    eventsStartingBetween: async (vid, from, to) => [...events.entries()].filter(([, e]) => e.venueId === vid && e.startsAt >= from && e.startsAt < to).map(([id, e]) => ({ id, title: e.title })),
  };
  const store = {
    isEnabled: async () => enabled,
    searchVenues: async (t: string) => venues.filter((v) => v.name.toLowerCase().includes(t.toLowerCase().slice(0, 4))),
    transaction: async (_v: string, run: (t: HunterTx) => Promise<unknown>) => run(tx),
  } as unknown as HunterStore;
  const bridge = new HunterBridge({ store, serviceToken: 'a'.repeat(40), clock: { now: () => NOW }, newEventId: (r) => `00000000-0000-4000-8000-${r.length.toString().padStart(12, '0')}` });
  const acks: Record<string, AckResult> = {};
  const feedOf = (items: FeedItem[]) => ({ fetchApproved: async () => items, ack: async (k: string, r: AckResult) => { acks[k] = r; } });
  return { bridge, events, acks, feedOf };
}
const k = (c: string) => c.repeat(32);
const item = (key: string, extra: Record<string, unknown> = {}): FeedItem => ({ key, candidate: { title: 'Samba', venueName: 'Bar do Juarez', startsAt: '2027-03-20T22:00:00Z', area: { lat: -23.5, lng: -46.6 }, ...extra } });

test('gestão publica o aprovado, devolve revisão quando não pode e barra duplicado', async () => {
  const w = setup();
  const r = await syncFromHunter(w.bridge, w.feedOf([
    item(k('a')),
    item(k('b'), { venueName: 'Casa do Dono' }), // local com responsável
    item(k('c'), { venueName: 'Lugar Que Não Existe' }),
    item(k('d'), { title: '  SAMBA ' }), // duplicado do primeiro
    item(k('e'), { startsAt: undefined }),
  ]), NOW);
  assert.deepEqual(w.acks, { [k('a')]: 'PUBLISHED', [k('b')]: 'REVIEW', [k('c')]: 'REVIEW', [k('d')]: 'REJECTED', [k('e')]: 'REVIEW' });
  assert.equal(w.events.size, 1);
  assert.equal(r.published, 1);
  // endsAt padrão: início + 4h
  assert.equal([...w.events.values()][0]!.endsAt.toISOString(), '2027-03-21T02:00:00.000Z');
});

test('Hunter desligado na gestão: não busca nem publica', async () => {
  const w = setup(false);
  const r = await syncFromHunter(w.bridge, w.feedOf([item(k('a'))]), NOW);
  assert.equal(r.stoppedDisabled, true);
  assert.equal(w.events.size, 0);
  assert.deepEqual(w.acks, {});
});

test('dado inválido (evento já terminou) volta para revisão e repetir o pedido não duplica', async () => {
  const w = setup();
  await syncFromHunter(w.bridge, w.feedOf([item(k('a'), { startsAt: '2027-03-01T22:00:00Z', endsAt: '2027-03-02T02:00:00Z' })]), NOW);
  assert.equal(w.acks[k('a')], 'REVIEW');
  await syncFromHunter(w.bridge, w.feedOf([item(k('b'))]), NOW);
  await syncFromHunter(w.bridge, w.feedOf([item(k('b'))]), NOW);
  assert.equal(w.events.size, 1);
});

test('local já vinculado no Hunter dispensa a busca; local inexistente/com dono volta para revisão', async () => {
  const w = setup();
  await syncFromHunter(w.bridge, w.feedOf([
    { ...item(k('a'), { venueName: 'Nome Que Nenhuma Busca Acharia' }), venueId: V1 },
    { ...item(k('b'), { title: 'Outro', venueName: 'X' }), venueId: V2 }, // com responsável
    { ...item(k('c'), { title: 'Terceiro', venueName: 'Y' }), venueId: '99999999-9999-4999-8999-999999999999' }, // não existe
  ]), NOW);
  assert.deepEqual(w.acks, { [k('a')]: 'PUBLISHED', [k('b')]: 'REVIEW', [k('c')]: 'REVIEW' });
});
