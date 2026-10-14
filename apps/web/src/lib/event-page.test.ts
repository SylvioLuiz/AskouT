import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attendeeStrip, eventDateLabel, eventLink, eventTimeLabel, venueLine, venueMapLink } from './event-page.ts';

test('data e hora do evento em colunas', () => {
  const start = new Date('2026-10-17T20:00').toISOString();
  const sameEnd = new Date('2026-10-17T23:30').toISOString();
  const laterEnd = new Date('2026-10-19T12:00').toISOString();
  assert.match(eventDateLabel(start, sameEnd).main, /17 out/);
  assert.match(eventDateLabel(start, sameEnd).sub ?? '', /sáb/);
  assert.match(eventDateLabel(start, laterEnd).sub ?? '', /até 19 out/);
  assert.deepEqual(eventTimeLabel(start, sameEnd), { main: '20:00', sub: 'até 23:30' });
  assert.deepEqual(eventTimeLabel(start, laterEnd), { main: '20:00', sub: null });
  assert.deepEqual(eventDateLabel('lixo', 'lixo'), { main: '—', sub: null });
});

test('lugar, mapa, avatares e link', () => {
  assert.equal(venueLine({ name: 'Parque', address: 'Av. A', lat: null, lng: null }), 'Parque · Av. A');
  assert.equal(venueLine({ name: 'Parque', address: null, lat: null, lng: null }), 'Parque');
  assert.equal(venueMapLink({ name: 'Bar do Zé', address: 'Rua A, 1', lat: null, lng: null }), 'https://www.google.com/maps/search/?api=1&query=Bar%20do%20Z%C3%A9%2C%20Rua%20A%2C%201');
  assert.equal(venueMapLink({ name: 'X', address: null, lat: -23.5, lng: -46.6 }), 'https://www.google.com/maps/search/?api=1&query=-23.5,-46.6');
  assert.deepEqual(attendeeStrip([1, 2, 3, 4], 9, 3), { shown: [1, 2, 3], more: 6 });
  assert.deepEqual(attendeeStrip([1], 1, 3), { shown: [1], more: 0 });
  assert.equal(eventLink('https://x.app', 'a b'), 'https://x.app/eventos/a%20b');
});
