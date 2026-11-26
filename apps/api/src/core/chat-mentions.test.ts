import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeWorld } from './testing/world.ts';

type World = ReturnType<typeof makeWorld>;

async function befriend(w: World, a: string, b: string) {
  await w.core.follows.follow(a, b);
  await w.core.follows.follow(b, a);
}

async function setup() {
  const w = makeWorld();
  const { ana, bia, caio, dani } = await w.signUpMany('ana', 'bia', 'caio', 'dani');
  for (const other of [bia!, caio!, dani!]) await befriend(w, ana!, other);
  const { id } = await w.core.conversations.createGroup(ana!, { name: 'Turma', memberIds: [bia!, caio!] });
  // Criar o grupo já avisa quem entrou; lido, o próximo aviso da conversa aparece no sino.
  for (const member of [bia!, caio!]) await w.core.notifications.markRead(member);
  return { w, ana: ana!, bia: bia!, caio: caio!, dani: dani!, id };
}

const notices = async (w: World, userId: string, category: 'mentions' | 'messages' = 'messages') => (await w.core.notifications.list(userId, category)).items.filter((n) => n.type === 'MESSAGE' && !n.read);

test('@menção no grupo: quem foi marcado recebe "mencionou você", os outros o aviso comum', async () => {
  const { w, ana, bia, caio, id } = await setup();
  await w.core.conversations.send(ana, id, { body: 'Bora sábado, @Bia?' });
  const toBia = await notices(w, bia, 'mentions');
  assert.equal(toBia.length, 1);
  assert.equal(toBia[0]!.title, 'ana mencionou você em Turma');
  assert.equal(toBia[0]!.body, 'Bora sábado, @Bia?');
  assert.equal(toBia[0]!.url, `/conversas/${id}`);
  // Bia não recebe também o aviso comum da mensagem.
  assert.equal((await notices(w, bia)).length, 1);
  // Caio recebe o aviso comum, que não entra em "Menções".
  assert.deepEqual((await notices(w, caio)).map((n) => n.body), ['ana: Bora sábado, @Bia?']);
  assert.equal((await notices(w, caio, 'mentions')).length, 0);
});

test('@menção: chega mesmo com a conversa silenciada; quem não é do grupo, quem escreveu e quem bloqueou ficam de fora', async () => {
  const { w, ana, bia, caio, dani, id } = await setup();
  await w.core.conversations.setPreferences(bia, id, { muted: true });
  await w.core.blocks.block(caio, ana);
  await w.core.conversations.send(ana, id, { body: '@bia @caio @dani @ana @ninguem olha isso' });
  assert.equal((await notices(w, bia, 'mentions')).length, 1);
  assert.equal((await notices(w, caio)).length, 0);
  assert.equal((await notices(w, dani)).length, 0);
  assert.equal((await notices(w, ana)).length, 0);
});

test('@menção: cada mensagem com menção gera o seu aviso; na conversa 1 a 1 não há aviso de menção', async () => {
  const { w, ana, bia, id } = await setup();
  await w.core.conversations.send(ana, id, { body: 'oi @bia' });
  await w.core.conversations.send(ana, id, { body: 'cadê você @bia?' });
  assert.equal((await notices(w, bia, 'mentions')).length, 2);
  const direct = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, direct.id, { body: 'e aí @bia' });
  assert.equal((await notices(w, bia, 'mentions')).length, 2);
});
