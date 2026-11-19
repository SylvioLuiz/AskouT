import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const JPEG = () => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('adm', 'ana', 'bia');
  const adm = u['adm']!, ana = u['ana']!, bia = u['bia']!;
  w.users.users.set(adm, { ...w.users.users.get(adm)!, role: 'ADMIN' });
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, ana);
  const A = { userId: adm, role: 'ADMIN' as const };
  const start = new Date(w.clock.now().getTime() + 24 * 3_600_000).toISOString();
  return { w, A, adm, ana, bia, start };
}

test('a gestão cadastra, edita, ordena e apaga configurações de evento; só admin', async () => {
  const { w, A, ana } = await setup();
  await rejectsWith(w.core.admin.eventExtras({ userId: ana, role: 'USER' }), 'FORBIDDEN');
  await rejectsWith(w.core.admin.createEventExtra({ userId: ana, role: 'USER' }, { icon: 'car', label: 'X', type: 'TEXT' }), 'FORBIDDEN');
  await rejectsWith(w.core.admin.createEventExtra(A, { icon: 'foguete', label: 'X', type: 'TEXT' }), 'VALIDATION');
  await rejectsWith(w.core.admin.createEventExtra(A, { icon: 'car', label: '  ', type: 'TEXT' }), 'VALIDATION');
  await rejectsWith(w.core.admin.createEventExtra(A, { icon: 'car', label: 'X', type: 'NUMBER' }), 'VALIDATION');

  await w.core.admin.createEventExtra(A, { icon: 'smoking', label: 'Pode fumar?', type: 'YES_NO' });
  const { items } = await w.core.admin.createEventExtra(A, { icon: 'car', label: '  Estacionamento ', type: 'TEXT' });
  assert.deepEqual(items.map((o) => [o.icon, o.label, o.type]), [['smoking', 'Pode fumar?', 'YES_NO'], ['car', 'Estacionamento', 'TEXT']]);
  await rejectsWith(w.core.admin.createEventExtra(A, { icon: 'info', label: 'pode FUMAR?', type: 'TEXT' }), 'CONFLICT');

  const park = items[1]!;
  const moved = await w.core.admin.moveEventExtra(A, park.id, 'up');
  assert.deepEqual(moved.items.map((o) => o.label), ['Estacionamento', 'Pode fumar?']);
  const edited = await w.core.admin.updateEventExtra(A, park.id, { icon: 'parking', label: 'Onde estacionar', type: 'TEXT' });
  assert.deepEqual(edited.items[0], { id: park.id, icon: 'parking', label: 'Onde estacionar', type: 'TEXT' });
  assert.deepEqual((await w.core.eventExtras.list()).map((o) => o.label), ['Onde estacionar', 'Pode fumar?'], 'o app vê na hora');

  await w.core.admin.deleteEventExtra(A, park.id);
  assert.deepEqual((await w.core.eventExtras.list()).map((o) => o.label), ['Pode fumar?']);
  await rejectsWith(w.core.admin.deleteEventExtra(A, park.id), 'NOT_FOUND');
  assert.deepEqual([...w.admin.audit.values()].map((a) => a.action), ['EVENT_EXTRA_CREATED', 'EVENT_EXTRA_CREATED', 'EVENT_EXTRA_UPDATED', 'EVENT_EXTRA_REMOVED']);
});

test('quem cria o evento responde; a página mostra ícone, nome e resposta; a edição troca as respostas', async () => {
  const { w, A, ana, bia, start } = await setup();
  await w.core.admin.createEventExtra(A, { icon: 'smoking', label: 'Pode fumar?', type: 'YES_NO' });
  await w.core.admin.createEventExtra(A, { icon: 'car', label: 'Estacionamento', type: 'TEXT' });
  await w.core.admin.createEventExtra(A, { icon: 'pet', label: 'Aceita pets?', type: 'YES_NO' });
  const [smoke, park, pet] = await w.core.eventExtras.list();

  await rejectsWith(w.core.posts.create(ana, { images: [JPEG()], event: { title: 'Festa', startsAt: start, extras: [{ optionId: smoke!.id, value: 'talvez' }] } }), 'VALIDATION');
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG()], event: { title: 'Festa', startsAt: start, extras: [{ optionId: park!.id, value: 'x'.repeat(121) }] } }), 'VALIDATION');

  const ev = await w.core.posts.create(ana, {
    images: [JPEG()],
    event: { title: 'Festa', startsAt: start, extras: [{ optionId: park!.id, value: '  na rua de trás ' }, { optionId: smoke!.id, value: false }, { optionId: pet!.id, value: null }, { optionId: 'sumiu', value: true }] },
  });
  assert.deepEqual(ev.event?.extras, [{ optionId: park!.id, value: 'na rua de trás' }, { optionId: smoke!.id, value: false }]);

  const page = await w.core.eventPages.get(bia, ev.id);
  assert.deepEqual(page.extras.map((x) => [x.icon, x.label, x.value]), [['smoking', 'Pode fumar?', false], ['car', 'Estacionamento', 'na rua de trás']], 'na ordem da gestão');

  // Editar sem mandar `extras` mantém; mandando, troca.
  const same = await w.core.posts.update(ana, ev.id, { caption: 'Traga gelo' });
  assert.equal(same.event?.extras.length, 2);
  const kept = await w.core.posts.update(ana, ev.id, { event: { title: 'Festa!', startsAt: start } });
  assert.equal(kept.event?.extras.length, 2);
  const changed = await w.core.posts.update(ana, ev.id, { event: { title: 'Festa!', startsAt: start, extras: [{ optionId: smoke!.id, value: true }, { optionId: pet!.id, value: true }] } });
  assert.deepEqual(changed.event?.extras, [{ optionId: smoke!.id, value: true }, { optionId: pet!.id, value: true }]);

  // A gestão renomeia: vale para o evento já criado. Apagou: some da página.
  await w.core.admin.updateEventExtra(A, smoke!.id, { icon: 'smoking', label: 'Liberado fumar?', type: 'YES_NO' });
  await w.core.admin.deleteEventExtra(A, pet!.id);
  assert.deepEqual((await w.core.eventPages.get(bia, ev.id)).extras.map((x) => [x.label, x.value]), [['Liberado fumar?', true]]);

  const plain = await w.core.posts.update(ana, ev.id, { event: null });
  assert.equal(plain.event, null);
});
