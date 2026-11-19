import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('dono', 'ana', 'adm');
  const dono = u['dono']!, ana = u['ana']!, adm = u['adm']!;
  const admin = w.users.users.get(adm)!;
  w.users.users.set(adm, { ...admin, role: 'ADMIN' });
  const request = { name: 'Bar da Esquina Nova', category: 'Bar', address: 'Rua das Flores, 10', lat: -23.55, lng: -46.63, document: JPEG };
  return { w, dono, ana, adm, request };
}

test('local criado do zero: dados obrigatórios, nasce sem dono e fora da busca até o admin aprovar', async () => {
  const { w, dono, ana, adm, request } = await setup();
  await rejectsWith(w.core.venues.requestVenue(dono, { ...request, name: '' }), 'VALIDATION');
  await rejectsWith(w.core.venues.requestVenue(dono, { ...request, address: undefined }), 'VALIDATION');
  await rejectsWith(w.core.venues.requestVenue(dono, { ...request, lat: undefined }), 'VALIDATION');
  await rejectsWith(w.core.venues.requestVenue(dono, { ...request, document: undefined }), 'VALIDATION');

  const claim = await w.core.venues.requestVenue(dono, request);
  assert.equal(claim.status, 'PENDING');
  assert.equal(claim.venue.organization, false);
  assert.equal(claim.venue.category, 'Bar');
  assert.equal(claim.venue.address, 'Rua das Flores, 10');
  assert.deepEqual(await w.core.venues.searchClaimable(ana, 'esquina nova'), [], 'sem dono não aparece na busca');
  assert.equal((await w.core.venues.mine(dono)).claims[0]?.venue.id, claim.venue.id, 'o pedido aparece em Meus locais');

  await w.core.venues.reviewClaim(adm, claim.id, 'APPROVED');
  assert.equal((await w.core.venues.profile(dono, claim.venue.id)).isOwner, true);
  assert.equal((await w.core.venues.searchClaimable(ana, 'esquina nova'))[0]?.state, 'TAKEN', 'aprovado, aparece na busca');
});

test('local criado do zero: respeita o limite de pedidos em análise', async () => {
  const { w, dono, request } = await setup();
  for (let i = 0; i < 5; i += 1) await w.core.venues.requestVenue(dono, { ...request, name: `Bar ${i}` });
  await rejectsWith(w.core.venues.requestVenue(dono, { ...request, name: 'Bar 6' }), 'CONFLICT');
});
