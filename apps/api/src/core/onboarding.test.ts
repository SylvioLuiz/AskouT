import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD, makeWorld } from './testing/world.ts';

test('tutorial inicial: conta nova ainda não viu; depois de concluir, vale em qualquer login', async () => {
  const w = makeWorld();
  const signed = await w.signUp('ana');
  assert.equal(signed.user.onboarded, false, 'primeiro login mostra o tutorial');
  const actor = { userId: signed.user.id, role: signed.user.role };
  assert.equal((await w.core.auth.me(actor)).onboarded, false);

  assert.deepEqual(await w.core.auth.completeOnboarding(actor), { onboarded: true });
  assert.equal((await w.core.auth.me(actor)).onboarded, true);
  const again = await w.core.auth.login({ identifier: 'ana', password: PASSWORD });
  assert.equal(again.user.onboarded, true, 'outro aparelho/login não mostra de novo');
});

test('tutorial inicial: concluir de novo não muda a data registrada', async () => {
  const w = makeWorld();
  const signed = await w.signUp('ana');
  const actor = { userId: signed.user.id, role: signed.user.role };
  await w.core.auth.completeOnboarding(actor);
  const first = (await w.users.findById(signed.user.id))!.onboardedAt;
  assert.ok(first instanceof Date);
  w.clock.tick(60_000);
  await w.core.auth.completeOnboarding(actor);
  assert.equal((await w.users.findById(signed.user.id))!.onboardedAt, first);
});
