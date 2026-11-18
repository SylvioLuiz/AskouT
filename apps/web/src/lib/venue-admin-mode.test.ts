import assert from 'node:assert/strict';
import { test } from 'node:test';
import { venueAdminRoute, venueAdminTabs } from './venue-admin-mode.ts';

test('modo estabelecimento: reconhece as telas de administração e não a página pública', () => {
  assert.deepEqual(venueAdminRoute('/bares/v1/painel'), { venueId: 'v1', section: 'painel' });
  assert.deepEqual(venueAdminRoute('/bares/v1/equipe'), { venueId: 'v1', section: 'equipe' });
  assert.deepEqual(venueAdminRoute('/bares/v1/agenda'), { venueId: 'v1', section: 'agenda' });
  assert.deepEqual(venueAdminRoute('/bares/v1/impulsionar'), { venueId: 'v1', section: 'impulsionar' });
  assert.deepEqual(venueAdminRoute('/bares/v1/eventos'), { venueId: 'v1', section: 'eventos' });
  assert.deepEqual(venueAdminRoute('/bares/v1/eventos/e9/chapelaria'), { venueId: 'v1', section: 'eventos' });
  assert.equal(venueAdminRoute('/bares/v1'), undefined);
  assert.equal(venueAdminRoute('/eventos/e9'), undefined);
  assert.equal(venueAdminRoute('/bares/v1/outra'), undefined);
  assert.equal(venueAdminRoute('/bares/%E0%A4%A/painel'), undefined);
});

test('modo estabelecimento: administrador adicional não vê Impulsionar', () => {
  const labels = { painel: 'Painel', eventos: 'Eventos', equipe: 'Equipe', agenda: 'Agenda', impulsionar: 'Impulsionar' };
  assert.deepEqual(venueAdminTabs('v1', true, labels).map((t) => t.section), ['painel', 'eventos', 'agenda', 'equipe', 'impulsionar']);
  assert.deepEqual(venueAdminTabs('v1', false, labels).map((t) => t.section), ['painel', 'eventos', 'agenda', 'equipe']);
  assert.equal(venueAdminTabs('a b', true, labels)[0]?.to, '/bares/a%20b/painel');
});
