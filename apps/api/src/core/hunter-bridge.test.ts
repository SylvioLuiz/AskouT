import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HunterBridge } from './hunter-bridge.ts';
import type { HunterEventFields, HunterLink, HunterStore, HunterTx, HunterVenueState } from './hunter-bridge.ts';
import { DomainError } from './errors.ts';

const VENUE = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2027-03-10T12:00:00Z');

function world(opts: { venues?: HunterVenueState[] } = {}) {
  const venues = new Map((opts.venues ?? [{ id: VENUE, name: 'Bar do Juarez', address: 'Rua A, 1', lat: -23.5, lng: -46.6, externalKey: 'google:abc', ownerId: null, claimStatuses: [] }]).map((v) => [v.id, v]));
  const events = new Map<string, HunterEventFields>();
  const links = new Map<string, HunterLink>();
  const audit: string[] = [];
  let enabled = false;
  const tx: HunterTx = {
    venue: async (id) => venues.get(id),
    link: async (ref) => links.get(ref),
    createEvent: async (eventId, link, fields) => { events.set(eventId, fields); links.set(link.ref, link); },
    updateEvent: async (eventId, fields) => { events.set(eventId, { ...(events.get(eventId) as HunterEventFields), ...fields }); },
    deleteEvent: async (eventId) => { events.delete(eventId); for (const [r, l] of links) if (l.eventId === eventId) links.delete(r); },
    eventsStartingBetween: async (venueId, from, to) => [...events.entries()].filter(([, e]) => e.venueId === venueId && e.startsAt >= from && e.startsAt < to).map(([id, e]) => ({ id, title: e.title })),
  };
  const store: HunterStore = {
    isEnabled: async () => enabled,
    setEnabled: async (v) => { enabled = v; },
    venueByExternalKey: async (k) => [...venues.values()].find((v) => v.externalKey === k),
    searchVenues: async (text) => [...venues.values()].filter((v) => v.name.toLowerCase().includes(text.toLowerCase())),
    transaction: async (_id, run) => run(tx),
    findLink: async (ref) => { const l = links.get(ref); return l ? { ...l, eventStartsAt: events.get(l.eventId)?.startsAt ?? NOW } : undefined; },
    listLinks: async () => ({ total: links.size, items: [...links.values()].map((l) => ({ ref: l.ref, eventId: l.eventId, title: events.get(l.eventId)?.title ?? '', venueId: l.venueId, venueName: 'Bar', startsAt: NOW, createdAt: NOW })) }),
    deleteByRefs: async (refs) => { let n = 0; for (const r of refs) { const l = links.get(r); if (l) { events.delete(l.eventId); links.delete(r); n++; } } return n; },
    allRefs: async () => [...links.keys()],
    regionCells: async (_c, min) => [{ lat: -23.5, lng: -46.6, users: 9 }].filter((c) => c.users >= min),
    audit: async (_a, action) => { audit.push(action); },
  };
  const bridge = new HunterBridge({ store, serviceToken: 'a'.repeat(40), clock: { now: () => NOW }, newEventId: (ref) => `00000000-0000-4000-8000-${ref.length.toString().padStart(12, '0')}` });
  return { bridge, venues, events, links, audit, enable: () => { enabled = true; } };
}

const body = (extra: Record<string, unknown> = {}) => ({ ref: 'src:evento-1', venueId: VENUE, title: 'Festa Anos 80', startsAt: '2027-03-20T22:00:00Z', endsAt: '2027-03-21T03:00:00Z', kind: 'NIGHT', imageUrl: 'https://exemplo.com/a.jpg', ...extra });

test('desligado: recusa tudo e não grava', async () => {
  const w = world();
  assert.deepEqual(await w.bridge.create(body()), { ok: false, refusal: 'DISABLED' });
  assert.equal(w.events.size, 0);
});

test('local sem responsável: cria e repetir o pedido não duplica', async () => {
  const w = world(); w.enable();
  const a = await w.bridge.create(body());
  assert.equal(a.ok && a.created, true);
  const b = await w.bridge.create(body());
  assert.equal(b.ok && b.created, false);
  assert.equal(w.events.size, 1);
});

test('local com responsável, pedido pendente ou desconhecido: não cria', async () => {
  const owned = world({ venues: [{ id: VENUE, name: 'A', address: null, lat: 0, lng: 0, externalKey: null, ownerId: 'u1', claimStatuses: ['APPROVED'] }] }); owned.enable();
  assert.deepEqual(await owned.bridge.create(body()), { ok: false, refusal: 'OWNED' });
  const pending = world({ venues: [{ id: VENUE, name: 'A', address: null, lat: 0, lng: 0, externalKey: null, ownerId: null, claimStatuses: ['PENDING'] }] }); pending.enable();
  assert.deepEqual(await pending.bridge.create(body()), { ok: false, refusal: 'CLAIM_PENDING' });
  const none = world({ venues: [] }); none.enable();
  assert.deepEqual(await none.bridge.create(body()), { ok: false, refusal: 'UNKNOWN' });
});

test('mudança de propriedade depois de publicar: não atualiza nem remove, e o evento fica', async () => {
  const w = world(); w.enable();
  await w.bridge.create(body());
  w.venues.get(VENUE)!.ownerId = 'dono';
  assert.deepEqual(await w.bridge.update('src:evento-1', body({ title: 'Outro nome' })), { ok: false, refusal: 'OWNED' });
  assert.deepEqual(await w.bridge.cancel('src:evento-1'), { ok: false, refusal: 'OWNED' });
  assert.equal(w.events.size, 1);
  assert.equal([...w.events.values()][0]!.title, 'Festa Anos 80');
});

test('atualiza e cancela quando o local continua livre', async () => {
  const w = world(); w.enable();
  await w.bridge.create(body());
  const u = await w.bridge.update('src:evento-1', body({ title: 'Festa Anos 90' }));
  assert.equal(u.ok, true);
  assert.equal([...w.events.values()][0]!.title, 'Festa Anos 90');
  const c = await w.bridge.cancel('src:evento-1');
  assert.deepEqual(c, { ok: true, removed: true });
  assert.equal(w.events.size, 0);
  assert.deepEqual(await w.bridge.cancel('src:evento-1'), { ok: true, removed: false });
});

test('validação: datas, https, referência', async () => {
  const w = world(); w.enable();
  await assert.rejects(() => w.bridge.create(body({ endsAt: '2027-03-20T21:00:00Z' })), DomainError);
  await assert.rejects(() => w.bridge.create(body({ endsAt: '2027-03-01T03:00:00Z', startsAt: '2027-03-01T01:00:00Z' })), DomainError);
  await assert.rejects(() => w.bridge.create(body({ imageUrl: 'http://exemplo.com/a.jpg' })), DomainError);
  await assert.rejects(() => w.bridge.create(body({ ref: 'x' })), DomainError);
  await assert.rejects(() => w.bridge.create(body({ title: '' })), DomainError);
  assert.equal(w.events.size, 0);
});

test('consulta de local traz o veredito da regra', async () => {
  const w = world();
  const r = await w.bridge.lookupVenues({ externalKey: 'google:abc' });
  assert.equal(r.venues[0]?.canPublish, true);
  w.venues.get(VENUE)!.claimStatuses = ['PENDING'];
  assert.equal((await w.bridge.lookupVenues({ q: 'juarez' })).venues[0]?.denied, 'CLAIM_PENDING');
  await assert.rejects(() => w.bridge.lookupVenues({}), DomainError);
});

test('regiões: mínimo nunca abaixo de 3 pessoas', async () => {
  const w = world();
  assert.equal((await w.bridge.regions('1')).minUsers, 3);
  assert.equal((await w.bridge.regions(undefined)).minUsers, 5);
});

test('gestão: liga e desliga, exige o token no servidor, lista e remove tudo com auditoria', async () => {
  const w = world(); 
  assert.deepEqual(await w.bridge.setEnabled('adm', true), { enabled: true });
  await w.bridge.create(body());
  await w.bridge.create(body({ ref: 'src:evento-2', title: 'Outra festa' }));
  const o = await w.bridge.adminOverview(50, 0);
  assert.equal(o.total, 2);
  assert.equal(o.enabled, true);
  assert.deepEqual(await w.bridge.setEnabled('adm', false), { enabled: false });
  assert.deepEqual(await w.bridge.adminRemove('adm', 'src:evento-1'), { removed: 1 });
  assert.deepEqual(await w.bridge.adminRemove('adm', undefined), { removed: 1 });
  assert.equal(w.events.size, 0);
  assert.deepEqual(w.audit, ['HUNTER_ENABLED', 'HUNTER_DISABLED', 'HUNTER_EVENT_REMOVED', 'HUNTER_EVENTS_REMOVED_ALL']);
  await assert.rejects(() => w.bridge.setEnabled('adm', 'sim'), DomainError);
});

test('sem token de serviço no servidor não liga', async () => {
  const b = new HunterBridge({ store: {} as HunterStore, serviceToken: undefined, clock: { now: () => NOW }, newEventId: () => 'x' });
  await assert.rejects(() => b.setEnabled('adm', true), DomainError);
});

test('duplicidade: mesmo título, local e dia não entra de novo (mesmo com outra referência)', async () => {
  const w = world();
  w.enable();
  assert.equal((await w.bridge.create(body())).ok, true);
  assert.deepEqual(await w.bridge.create(body({ ref: 'outra:fonte-2', title: '  festa ANOS 80 ' })), { ok: false, refusal: 'DUPLICATE' });
  assert.equal(w.events.size, 1);
  // outro dia ou outro título passam
  assert.equal((await w.bridge.create(body({ ref: 'outra:fonte-3', startsAt: '2027-03-27T22:00:00Z', endsAt: '2027-03-28T03:00:00Z' }))).ok, true);
  assert.equal((await w.bridge.create(body({ ref: 'outra:fonte-4', title: 'Festa Anos 90' }))).ok, true);
});
