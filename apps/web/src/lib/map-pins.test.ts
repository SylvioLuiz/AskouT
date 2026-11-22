import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventsByPlace } from './map-pins.ts';
import type { ExploreEvent, ExplorePlace } from './types.ts';

const place = (key: string, lat: number, lng: number, venueId?: string) => ({ key, name: key, lat, lng, venue: venueId ? { id: venueId } : null }) as unknown as ExplorePlace;
const event = (id: string, venue: { id: string; name: string; lat: number; lng: number }) => ({ id, title: id, venue: { address: null, category: null, logoUrl: null, ...venue } }) as unknown as ExploreEvent;

test('mapa: soma os eventos no pin do local (pelo local do AskouT ou pelo lugar) e separa os de lugar fora da lista', () => {
  const places = [place('bar', -23.5, -46.6, 'v-bar'), place('praca', -23.51, -46.61)];
  const events = [
    event('e1', { id: 'v-bar', name: 'Bar', lat: -23.5, lng: -46.6 }),
    event('e2', { id: 'v-bar', name: 'Bar', lat: -23.5, lng: -46.6 }),
    // Sem o local do AskouT ligado no pin, mas no mesmo lugar (a ~10 m).
    event('e3', { id: 'v-outro', name: 'Praça', lat: -23.51009, lng: -46.61 }),
    // Lugar que não está entre os locais: pin próprio, somando os dois.
    event('e4', { id: 'v-casa', name: 'Casa da Ana', lat: -23.6, lng: -46.7 }),
    event('e5', { id: 'v-casa', name: 'Casa da Ana', lat: -23.6, lng: -46.7 }),
  ];
  const { countByPlace, loose } = eventsByPlace(places, events);
  assert.equal(countByPlace.get('bar'), 2);
  assert.equal(countByPlace.get('praca'), 1);
  assert.deepEqual(loose.map((l) => [l.name, l.count, l.eventId, l.venueId]), [['Casa da Ana', 2, 'e4', 'v-casa']]);
});
