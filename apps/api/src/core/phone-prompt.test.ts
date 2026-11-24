import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './testing/world.ts';
import { PHONE_PROMPT_GAP_DAYS, PHONE_PROMPT_MAX } from './profile-service.ts';

const DAY = 24 * 60 * 60 * 1000;

test('pedido de cadastro do celular: espera o primeiro dia, respeita o intervalo e para depois de algumas vezes', async () => {
  const w = makeWorld();
  const ana = (await w.signUp('ana')).user.id;
  // Conta recém-criada: ainda não pede (a pessoa acabou de passar pelo cadastro).
  assert.deepEqual(await w.core.profiles.phonePrompt(ana), { show: false });
  w.clock.tick(DAY);
  for (let i = 0; i < PHONE_PROMPT_MAX; i++) {
    assert.deepEqual(await w.core.profiles.phonePrompt(ana), { show: true });
    await w.core.profiles.markPhonePrompted(ana);
    assert.deepEqual(await w.core.profiles.phonePrompt(ana), { show: false });
    w.clock.tick(PHONE_PROMPT_GAP_DAYS * DAY - 1000);
    assert.deepEqual(await w.core.profiles.phonePrompt(ana), { show: false });
    w.clock.tick(1000);
  }
  // Já pediu o máximo de vezes: não pede mais.
  w.clock.tick(30 * DAY);
  assert.deepEqual(await w.core.profiles.phonePrompt(ana), { show: false });
});

test('pedido de cadastro do celular: quem já tem celular nunca vê', async () => {
  const w = makeWorld();
  const ana = (await w.signUp('ana')).user.id;
  w.clock.tick(2 * DAY);
  await w.core.profiles.setPhone(ana, '(11) 98765-4321');
  assert.deepEqual(await w.core.profiles.phonePrompt(ana), { show: false });
});
