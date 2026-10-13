import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceMeters } from './geo.ts';
import { SUGGESTION_MAX_ITEMS } from './suggestion-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const ANA = { lat: -23.5505, lng: -46.6333 };
const BIA = { lat: -23.5605, lng: -46.6433 };
const H = 3_600_000;

async function matched() {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await w.core.follows.follow(ana!, bia!);
  await w.core.follows.follow(bia!, ana!);
  await w.core.flash.turnOn(ana!, { hours: 2 });
  await w.core.flash.turnOn(bia!, { hours: 2 });
  const invite = await w.core.flash.invite(ana!, bia!);
  await w.core.flash.respond(bia!, invite.id, 'accept');
  return { w, ana: ana!, bia: bia!, caio: caio!, inviteId: invite.id };
}

async function share(w: Awaited<ReturnType<typeof matched>>['w'], who: string, inviteId: string, p: { lat: number; lng: number }) {
  await w.core.flash.shareLocation(who, inviteId, p);
}

async function venueWithEvent(w: Awaited<ReturnType<typeof matched>>['w'], name: string, lat: number, lng: number, startsInH: number, sample = true) {
  const venueId = `v-${name}`;
  await w.places.createVenue({ id: venueId, name, address: null, category: 'bar', lat, lng, isSample: sample });
  await w.places.createEvent({ id: `e-${name}`, venueId, title: `Evento ${name}`, description: null, startsAt: new Date(w.clock.now().getTime() + startsInH * H), endsAt: new Date(w.clock.now().getTime() + (startsInH + 2) * H), isSample: sample });
}

test('aceitar o convite cria a conversa dos dois e o encontro aponta para ela', async () => {
  const { w, ana, bia, inviteId } = await matched();
  const m = await w.core.flash.getMatch(ana, inviteId);
  const mb = await w.core.flash.getMatch(bia, inviteId);
  assert.equal(m.conversationId, mb.conversationId);
  assert.equal((await w.core.conversations.open(ana, bia)).id, m.conversationId);
  await w.core.flash.end(ana, inviteId);
  assert.equal((await w.core.conversations.list(ana))[0]!.id, m.conversationId, 'a conversa continua depois do Flash');
});

test('sem os dois compartilhando localização: 409; quem não participa: 404', async () => {
  const { w, ana, bia, caio, inviteId } = await matched();
  await rejectsWith(w.core.suggestions.forMatch(ana, inviteId), 'CONFLICT');
  await share(w, ana, inviteId, ANA);
  await rejectsWith(w.core.suggestions.forMatch(ana, inviteId), 'CONFLICT');
  await share(w, bia, inviteId, BIA);
  await rejectsWith(w.core.suggestions.forMatch(caio, inviteId), 'NOT_FOUND');
  assert.equal((await w.core.suggestions.forMatch(bia, inviteId)).reason, null);
});

test('eventos do AskouT vêm primeiro, perto do ponto médio; fora do raio e da janela ficam de fora', async () => {
  const { w, ana, inviteId } = await matched();
  await share(w, ana, inviteId, ANA);
  await share(w, (await w.core.flash.getMatch(ana, inviteId)).other.userId, inviteId, BIA);
  const mid = { lat: (ANA.lat + BIA.lat) / 2, lng: (ANA.lng + BIA.lng) / 2 };
  await venueWithEvent(w, 'Perto', mid.lat + 0.001, mid.lng, 1);
  await venueWithEvent(w, 'Real', mid.lat, mid.lng + 0.005, 3, false);
  await venueWithEvent(w, 'Longe', mid.lat + 0.05, mid.lng, 1); // ~5,5 km
  await venueWithEvent(w, 'Amanha', mid.lat, mid.lng, 30);
  const view = await w.core.suggestions.forMatch(ana, inviteId);
  assert.deepEqual(view.items.map((i) => i.venueName), ['Perto', 'Real']);
  const [first, second] = view.items;
  assert.equal(first!.source, 'EVENT');
  assert.equal(first!.sample, true);
  assert.equal(second!.sample, false, 'o que não é de teste não é marcado como teste');
  assert.ok(first!.distanceFromMidM < 3000);
  assert.equal(first!.distanceFromMeM, Math.round(distanceMeters({ lat: first!.lat, lng: first!.lng }, ANA)));
  assert.equal(first!.distanceFromThemM, Math.round(distanceMeters({ lat: first!.lat, lng: first!.lng }, BIA)));
  assert.equal(view.placesAvailable, true);
});

test('completa com OpenStreetMap, sem duplicar nomes e identificando a origem', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await share(w, ana, inviteId, ANA);
  await share(w, bia, inviteId, BIA);
  const mid = { lat: (ANA.lat + BIA.lat) / 2, lng: (ANA.lng + BIA.lng) / 2 };
  await venueWithEvent(w, 'Bar do Zé', mid.lat, mid.lng, 1);
  w.placeSource.places = [
    { source: 'OSM' as const, externalId: 'node/1', name: 'Bar do Zé', category: 'bar', lat: mid.lat, lng: mid.lng },
    { source: 'OSM' as const, externalId: 'node/2', name: 'Café Longe', category: 'cafe', lat: mid.lat + 0.05, lng: mid.lng },
    { source: 'OSM' as const, externalId: 'node/3', name: 'Café Perto', category: 'cafe', lat: mid.lat + 0.002, lng: mid.lng },
    { source: 'OSM' as const, externalId: 'node/4', name: 'Pub Médio', category: 'pub', lat: mid.lat + 0.01, lng: mid.lng },
  ];
  const view = await w.core.suggestions.forMatch(ana, inviteId);
  assert.deepEqual(view.items.map((i) => `${i.source}:${i.venueName}`), ['EVENT:Bar do Zé', 'OSM:Café Perto', 'OSM:Pub Médio']);
  const osm = view.items[1]!;
  assert.equal(osm.startsAt, null);
  assert.equal(osm.sample, false);
  assert.equal(osm.key, 'osm:node/3');
});

test('se o OpenStreetMap não responde, devolve só os eventos e avisa', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await share(w, ana, inviteId, ANA);
  await share(w, bia, inviteId, BIA);
  w.placeSource.available = false;
  const view = await w.core.suggestions.forMatch(ana, inviteId);
  assert.equal(view.placesAvailable, false);
  assert.deepEqual(view.items, []);
});

test('não chama o OpenStreetMap quando já há eventos suficientes e respeita o máximo', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await share(w, ana, inviteId, ANA);
  await share(w, bia, inviteId, BIA);
  const mid = { lat: (ANA.lat + BIA.lat) / 2, lng: (ANA.lng + BIA.lng) / 2 };
  for (let i = 0; i < 12; i++) await venueWithEvent(w, `L${i}`, mid.lat + i * 0.0002, mid.lng, 1);
  const view = await w.core.suggestions.forMatch(ana, inviteId);
  assert.equal(view.items.length, SUGGESTION_MAX_ITEMS);
  assert.equal(w.placeSource.calls, 0);
});

test('longe demais um do outro: sem sugestões e sem consultar fontes', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await share(w, ana, inviteId, ANA);
  await share(w, bia, inviteId, { lat: -22.9, lng: -43.2 }); // Rio
  const view = await w.core.suggestions.forMatch(ana, inviteId);
  assert.equal(view.reason, 'TOO_FAR');
  assert.deepEqual(view.items, []);
  assert.equal(w.placeSource.calls, 0);
});

test('a resposta nunca traz a posição das pessoas, só dos lugares e distâncias', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await share(w, ana, inviteId, ANA);
  await share(w, bia, inviteId, BIA);
  await venueWithEvent(w, 'Bar', (ANA.lat + BIA.lat) / 2, (ANA.lng + BIA.lng) / 2, 1);
  const json = JSON.stringify(await w.core.suggestions.forMatch(ana, inviteId));
  for (const secret of [String(ANA.lat), String(BIA.lat), String(ANA.lng), String(BIA.lng)]) assert.equal(json.includes(secret), false);
});

test('encontro encerrado ou bloqueio: sugestões somem', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await share(w, ana, inviteId, ANA);
  await share(w, bia, inviteId, BIA);
  await w.core.blocks.block(bia, ana);
  await rejectsWith(w.core.suggestions.forMatch(ana, inviteId), 'NOT_FOUND');
});
