import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageOn } from './age-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

test('ageOn: o aniversário conta no próprio dia', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  assert.equal(ageOn('2008-10-22', now), 18);
  assert.equal(ageOn('2008-10-23', now), 17);
  assert.equal(ageOn('2000-02-29', now), 26);
  assert.equal(ageOn('lixo', now), -1);
});

test('Flash: sem data de nascimento, não liga nem vê ninguém', async () => {
  const w = makeWorld();
  const ana = (await w.signUp('ana', { minor: true })).user.id;
  assert.deepEqual(await w.core.age.status(ana), { declared: false, adult: false });
  await rejectsWith(w.core.flash.turnOn(ana, { hours: 1 }), 'FORBIDDEN');
  await rejectsWith(w.core.flash.listAvailable(ana), 'FORBIDDEN');
});

test('Flash: menor de 18 anos é recusado e não consegue trocar a data', async () => {
  const w = makeWorld();
  const ana = (await w.signUp('ana', { minor: true })).user.id;
  const today = w.clock.now();
  const seventeen = `${today.getUTCFullYear() - 17}-01-01`;
  assert.deepEqual(await w.core.age.declare(ana, { birthDate: seventeen }), { declared: true, adult: false });
  await rejectsWith(w.core.flash.turnOn(ana, { hours: 1 }), 'FORBIDDEN');
  await rejectsWith(w.core.age.declare(ana, { birthDate: '1990-01-01' }), 'CONFLICT');
  assert.equal((await w.core.age.status(ana)).adult, false);
});

test('Flash: maior de 18 anos liga normalmente; datas inválidas são recusadas', async () => {
  const w = makeWorld();
  const ana = (await w.signUp('ana', { minor: true })).user.id;
  for (const bad of [undefined, 123, '', '2000-13-01', '2001-02-30', '1800-01-01', '2999-01-01', '01/01/1990']) {
    await rejectsWith(w.core.age.declare(ana, { birthDate: bad }), 'VALIDATION');
  }
  assert.deepEqual(await w.core.age.declare(ana, { birthDate: '1990-05-10' }), { declared: true, adult: true });
  const st = await w.core.flash.turnOn(ana, { hours: 1 });
  assert.equal(st.active, true);
});
