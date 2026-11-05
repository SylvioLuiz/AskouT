import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canOpenInMaps, mapAppLink, mapAppsFor } from './map-links.ts';

describe('links dos apps de mapa', () => {
  const bar = { lat: -23.5, lng: -46.6, label: 'Bar do Zé' };

  it('ver no mapa pelo ponto', () => {
    assert.equal(mapAppLink('google', bar, 'view'), 'https://www.google.com/maps/search/?api=1&query=-23.5%2C-46.6');
    assert.equal(mapAppLink('apple', bar, 'view'), 'https://maps.apple.com/?ll=-23.5,-46.6&q=Bar%20do%20Z%C3%A9');
    assert.equal(mapAppLink('waze', bar, 'view'), 'https://waze.com/ul?ll=-23.5,-46.6');
  });

  it('rota até o ponto', () => {
    assert.equal(mapAppLink('google', bar, 'route'), 'https://www.google.com/maps/dir/?api=1&destination=-23.5%2C-46.6');
    assert.equal(mapAppLink('apple', bar, 'route'), 'https://maps.apple.com/?daddr=-23.5%2C-46.6');
    assert.equal(mapAppLink('waze', bar, 'route'), 'https://waze.com/ul?ll=-23.5,-46.6&navigate=yes');
    assert.equal(mapAppLink('google', { ...bar, travel: 'walking' }, 'route'), 'https://www.google.com/maps/dir/?api=1&destination=-23.5%2C-46.6&travelmode=walking');
    assert.equal(mapAppLink('apple', { ...bar, travel: 'driving' }, 'route'), 'https://maps.apple.com/?daddr=-23.5%2C-46.6&dirflg=d');
  });

  it('usa o link do Google quando existe, só para ver', () => {
    const place = { ...bar, googleUrl: 'https://maps.google.com/?cid=1' };
    assert.equal(mapAppLink('google', place, 'view'), 'https://maps.google.com/?cid=1');
    assert.equal(mapAppLink('google', { ...bar, googleUrl: 'javascript:alert(1)' }, 'view'), 'https://www.google.com/maps/search/?api=1&query=-23.5%2C-46.6');
  });

  it('sem coordenada, busca pelo nome e endereço', () => {
    const target = { lat: null, lng: null, label: 'Casa da Ana', address: 'Rua A, 1' };
    assert.equal(canOpenInMaps(target), true);
    assert.equal(mapAppLink('google', target, 'view'), 'https://www.google.com/maps/search/?api=1&query=Casa%20da%20Ana%2C%20Rua%20A%2C%201');
    assert.equal(mapAppLink('apple', target, 'view'), 'https://maps.apple.com/?q=Casa%20da%20Ana%2C%20Rua%20A%2C%201');
    assert.equal(mapAppLink('waze', target, 'route'), 'https://waze.com/ul?q=Casa%20da%20Ana%2C%20Rua%20A%2C%201&navigate=yes');
    assert.equal(canOpenInMaps({ lat: null, lng: null, label: ' ' }), false);
  });
});

describe('apps de mapa por aparelho', () => {
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

  it('Android e Windows não oferecem o Apple Mapas', () => {
    assert.deepEqual(mapAppsFor(ANDROID, 'Linux armv8l'), ['google', 'waze']);
    assert.deepEqual(mapAppsFor(WINDOWS, 'Win32'), ['google', 'waze']);
  });

  it('iPhone, iPad e Mac oferecem os três', () => {
    assert.deepEqual(mapAppsFor(IPHONE, 'iPhone'), ['google', 'apple', 'waze']);
    assert.deepEqual(mapAppsFor(IPAD_AS_MAC, 'MacIntel'), ['google', 'apple', 'waze']);
  });
});
