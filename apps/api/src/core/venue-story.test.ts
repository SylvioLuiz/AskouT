import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { approximate, isAlcoholVenue } from './venue-story.ts';

describe('regras dos flashes de locais', () => {
  it('reconhece categorias de bebida alcoólica', () => {
    for (const c of ['Bar', 'Pub irlandês', 'Casa noturna', 'night_club', 'Cervejaria artesanal', 'Bar e restaurante', 'Balada']) assert.equal(isAlcoholVenue(c), true, c);
    for (const c of ['Café', 'Restaurante', 'Livraria', 'Parque', 'Barbearia', 'Academia', null, undefined]) assert.equal(isAlcoholVenue(c), false, String(c));
  });

  it('arredonda a posição para uma região de cerca de 1 km', () => {
    assert.equal(approximate(-23.561234), -23.56);
    assert.equal(approximate(-46.655999), -46.66);
  });
});
