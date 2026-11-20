import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';
import { DEFAULT_TASTES } from './tastes.ts';

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('adm', 'ana');
  const adm = u['adm']!, ana = u['ana']!;
  w.users.users.set(adm, { ...w.users.users.get(adm)!, role: 'ADMIN' });
  return { w, A: { userId: adm, role: 'ADMIN' as const }, ana };
}

test('sem nada cadastrado valem os nove gostos de origem; só admin mexe', async () => {
  const { w, A, ana } = await setup();
  assert.deepEqual((await w.core.tastes.list()).map((t) => t.id), DEFAULT_TASTES.map((t) => t.id));
  assert.deepEqual((await w.core.admin.tastes(A)).items.length, 9);
  await rejectsWith(w.core.admin.tastes({ userId: ana, role: 'USER' }), 'FORBIDDEN');
  await rejectsWith(w.core.admin.createTaste({ userId: ana, role: 'USER' }, { label: 'X', hint: 'y', keywords: 'z' }), 'FORBIDDEN');
});

test('a gestão cadastra, edita, ordena e apaga gostos, com validação e auditoria', async () => {
  const { w, A } = await setup();
  await rejectsWith(w.core.admin.createTaste(A, { label: '  ', hint: 'x', keywords: 'a' }), 'VALIDATION');
  await rejectsWith(w.core.admin.createTaste(A, { label: 'Lives', hint: '', keywords: 'a' }), 'VALIDATION');
  await rejectsWith(w.core.admin.createTaste(A, { label: 'Lives', hint: 'x', keywords: ' , ' }), 'VALIDATION');
  await rejectsWith(w.core.admin.createTaste(A, { label: 'Lives', hint: 'x', keywords: 'a', kinds: ['FOGUETE'] }), 'VALIDATION');
  await rejectsWith(w.core.admin.createTaste(A, { label: 'bares', hint: 'x', keywords: 'a' }), 'CONFLICT');

  const { items } = await w.core.admin.createTaste(A, { label: ' Pet  friendly ', hint: 'Lugares com pet', keywords: 'Pet*\nCachorro, pet*;Área Verde', kinds: ['OUTDOOR', 'NIGHT', 'OUTDOOR'] });
  assert.equal(items.length, 10);
  const pet = items[9]!;
  assert.deepEqual([pet.label, pet.keywords, pet.kinds], ['Pet friendly', ['pet*', 'cachorro', 'area verde'], ['NIGHT', 'OUTDOOR']]);

  const moved = await w.core.admin.moveTaste(A, pet.id, 'up');
  assert.equal(moved.items[8]!.id, pet.id);
  const edited = await w.core.admin.updateTaste(A, pet.id, { label: 'Pets', hint: 'Com pet', keywords: ['pet*'], kinds: [] });
  assert.deepEqual(edited.items[8], { id: pet.id, label: 'Pets', hint: 'Com pet', keywords: ['pet*'], kinds: [] });
  assert.equal((await w.core.tastes.list())[8]!.label, 'Pets', 'o app vê na hora');

  await w.core.admin.deleteTaste(A, pet.id);
  assert.equal((await w.core.tastes.list()).length, 9);
  await rejectsWith(w.core.admin.deleteTaste(A, pet.id), 'NOT_FOUND');
  assert.deepEqual([...w.admin.audit.values()].map((a) => a.action), ['TASTE_CREATED', 'TASTE_UPDATED', 'TASTE_REMOVED']);
});

test('não apaga o último gosto', async () => {
  const { w, A } = await setup();
  for (const t of DEFAULT_TASTES.slice(1)) await w.core.admin.deleteTaste(A, t.id);
  await rejectsWith(w.core.admin.deleteTaste(A, DEFAULT_TASTES[0]!.id), 'CONFLICT');
});

test('a pessoa escolhe gostos do catálogo atual; gosto apagado deixa de valer', async () => {
  const { w, A, ana } = await setup();
  assert.deepEqual((await w.core.auth.setTastes({ userId: ana, role: 'USER' }, ['SHOW', 'X', 'BAR'])).tastes, ['BAR', 'SHOW']);
  const { items } = await w.core.admin.createTaste(A, { label: 'Pets', hint: 'Com pet', keywords: 'pet*' });
  const pets = items[9]!.id;
  assert.deepEqual((await w.core.auth.setTastes({ userId: ana, role: 'USER' }, [pets, 'BAR'])).tastes, ['BAR', pets]);
  await w.core.admin.deleteTaste(A, pets);
  assert.deepEqual((await w.core.auth.setTastes({ userId: ana, role: 'USER' }, [pets, 'BAR'])).tastes, ['BAR']);
  await rejectsWith(w.core.auth.setTastes({ userId: ana, role: 'USER' }, 'BAR'), 'VALIDATION');
});
