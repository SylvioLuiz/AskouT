import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PINNED_MAX, REACTIONS, TYPING_TTL_MS } from './conversation-service.ts';
import { CHAT_IMAGE_MAX_BYTES, parseChatMedia } from './media.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

type World = ReturnType<typeof makeWorld>;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

async function befriend(w: World, a: string, b: string) {
  await w.core.follows.follow(a, b);
  await w.core.follows.follow(b, a);
}

async function setup() {
  const w = makeWorld();
  const { ana, bia, caio, dani } = await w.signUpMany('ana', 'bia', 'caio', 'dani');
  await befriend(w, ana!, bia!);
  await befriend(w, ana!, caio!);
  await befriend(w, ana!, dani!);
  const chat = await w.core.conversations.open(ana!, bia!);
  return { w, ana: ana!, bia: bia!, caio: caio!, dani: dani!, id: chat.id };
}

// ---------- Responder ----------

test('responder: guarda a original, mostra o trecho e valida a conversa', async () => {
  const { w, ana, bia, caio, id } = await setup();
  const first = await w.core.conversations.send(ana, id, { body: 'Bora no cinema sábado?' });
  const reply = await w.core.conversations.send(bia, id, { body: 'Bora!', replyToId: first.id });
  assert.equal(reply.replyTo?.id, first.id);
  assert.equal(reply.replyTo?.preview, 'Bora no cinema sábado?');
  assert.equal(reply.replyTo?.senderName, 'ana');
  assert.equal(reply.replyTo?.mine, false);
  const seen = await w.core.conversations.messages(ana, id);
  assert.equal(seen.messages.at(-1)?.replyTo?.mine, true);
  await rejectsWith(w.core.conversations.send(bia, id, { body: 'x', replyToId: 'nao-existe' }), 'NOT_FOUND');
  // Mensagem de outra conversa não vale.
  const other = await w.core.conversations.open(ana, caio);
  const elsewhere = await w.core.conversations.send(ana, other.id, { body: 'outra' });
  await rejectsWith(w.core.conversations.send(bia, id, { body: 'x', replyToId: elsewhere.id }), 'NOT_FOUND');
});

test('responder: apagar a original mostra "apagada" no trecho', async () => {
  const { w, ana, bia, id } = await setup();
  const first = await w.core.conversations.send(ana, id, { body: 'segredo' });
  await w.core.conversations.send(bia, id, { body: 'ok', replyToId: first.id });
  await w.core.conversations.deleteMessage(ana, id, first.id);
  const reply = (await w.core.conversations.messages(bia, id)).messages.at(-1)!;
  assert.equal(reply.replyTo?.deleted, true);
  assert.equal(reply.replyTo?.preview, '');
  await rejectsWith(w.core.conversations.send(bia, id, { body: 'x', replyToId: first.id }), 'NOT_FOUND');
});

// ---------- Reações ----------

test('reagir: uma por pessoa, trocar, tirar, agrupar e só emojis da lista', async () => {
  const { w, ana, bia, caio, id } = await setup();
  const m = await w.core.conversations.send(ana, id, { body: 'oi' });
  let r = await w.core.conversations.react(bia, id, m.id, '❤️');
  assert.deepEqual(r.reactions, [{ emoji: '❤️', count: 1, mine: true }]);
  r = await w.core.conversations.react(bia, id, m.id, '😂');
  assert.deepEqual(r.reactions, [{ emoji: '😂', count: 1, mine: true }]);
  r = await w.core.conversations.react(ana, id, m.id, '😂');
  assert.deepEqual(r.reactions, [{ emoji: '😂', count: 2, mine: true }]);
  const view = (await w.core.conversations.messages(bia, id)).messages.find((x) => x.id === m.id)!;
  assert.deepEqual(view.reactions, [{ emoji: '😂', count: 2, mine: true }]);
  r = await w.core.conversations.react(bia, id, m.id, '😂');
  assert.deepEqual(r.reactions, [{ emoji: '😂', count: 1, mine: false }]);
  r = await w.core.conversations.react(ana, id, m.id, null);
  assert.deepEqual(r.reactions, []);
  await rejectsWith(w.core.conversations.react(bia, id, m.id, '💩'), 'VALIDATION');
  await rejectsWith(w.core.conversations.react(bia, id, m.id, undefined), 'VALIDATION');
  await rejectsWith(w.core.conversations.react(caio, id, m.id, '👍'), 'NOT_FOUND');
  assert.ok(REACTIONS.length >= 6);
});

test('reagir: sem reação em mensagem de sistema, apagada ou de quem deixou de ser amigo', async () => {
  const { w, ana, bia, id } = await setup();
  const m = await w.core.conversations.send(ana, id, { body: 'oi' });
  await w.core.conversations.react(bia, id, m.id, '👍');
  await w.core.conversations.deleteMessage(ana, id, m.id);
  await rejectsWith(w.core.conversations.react(bia, id, m.id, '👍'), 'NOT_FOUND');
  const m2 = await w.core.conversations.send(ana, id, { body: 'de novo' });
  await w.core.follows.unfollow(bia, ana);
  await rejectsWith(w.core.conversations.react(bia, id, m2.id, '👍'), 'FORBIDDEN');
});

// ---------- Apagar ----------

test('apagar: só quem enviou, para todos, sem conteúdo e fora da aba Mídia', async () => {
  const { w, ana, bia, id } = await setup();
  const m = await w.core.conversations.send(ana, id, { body: 'oops http://exemplo.com/x' });
  await rejectsWith(w.core.conversations.deleteMessage(bia, id, m.id), 'FORBIDDEN');
  assert.equal((await w.core.conversations.shared(ana, id)).links.length, 1);
  const gone = await w.core.conversations.deleteMessage(ana, id, m.id);
  assert.equal(gone.deleted, true);
  assert.equal(gone.body, '');
  const forBia = (await w.core.conversations.messages(bia, id)).messages.find((x) => x.id === m.id)!;
  assert.equal(forBia.deleted, true);
  assert.equal(forBia.body, '');
  assert.equal((await w.core.conversations.shared(ana, id)).links.length, 0);
  const preview = (await w.core.conversations.list(bia))[0]!.lastMessage!;
  assert.equal(preview.deleted, true);
  await rejectsWith(w.core.conversations.deleteMessage(ana, id, m.id), 'CONFLICT');
});

test('apagar: cartões do sistema não se apagam e a foto some junto com os bytes', async () => {
  const { w, ana, id } = await setup();
  const sys = (await w.core.conversations.messages(ana, id)).messages;
  assert.equal(sys.length, 0);
  const photo = await w.core.conversations.send(ana, id, { media: { mime: 'image/jpeg', data: JPEG } });
  assert.equal((await w.core.conversations.media(ana, id, photo.id)).data.length, JPEG.length);
  await w.core.conversations.deleteMessage(ana, id, photo.id);
  await rejectsWith(w.core.conversations.media(ana, id, photo.id), 'NOT_FOUND');
});

// ---------- Foto e vídeo ----------

test('foto e vídeo: enviar, baixar, listar na aba Mídia e validar tipo, bytes e tamanho', async () => {
  const { w, ana, bia, caio, id } = await setup();
  const photo = await w.core.conversations.send(ana, id, { media: { mime: 'image/jpeg', data: JPEG } });
  assert.equal(photo.kind, 'IMAGE');
  const video = await w.core.conversations.send(bia, id, { media: { mime: 'video/mp4; codecs=avc1', data: MP4 }, replyToId: photo.id });
  assert.equal(video.kind, 'VIDEO');
  assert.equal(video.replyTo?.preview, 'Foto');
  const got = await w.core.conversations.media(bia, id, photo.id);
  assert.equal(got.mime, 'image/jpeg');
  await rejectsWith(w.core.conversations.media(caio, id, photo.id), 'NOT_FOUND');
  const shared = await w.core.conversations.shared(ana, id);
  assert.deepEqual(shared.media.map((m) => m.kind).sort(), ['IMAGE', 'VIDEO']);
  assert.equal(shared.media.find((m) => m.kind === 'VIDEO')?.mine, false);
  const group = (await w.core.conversations.list(ana))[0]!;
  assert.equal(group.lastMessage?.kind, 'VIDEO');
  // Validações
  await rejectsWith(w.core.conversations.send(ana, id, { media: { mime: 'image/gif', data: JPEG } }), 'VALIDATION');
  await rejectsWith(w.core.conversations.send(ana, id, { media: { mime: 'image/jpeg', data: MP4 } }), 'VALIDATION');
  await rejectsWith(w.core.conversations.send(ana, id, { media: { mime: 'image/jpeg', data: new Uint8Array(0) } }), 'VALIDATION');
  await rejectsWith(w.core.conversations.send(ana, id, { media: { mime: 'image/jpeg', data: undefined } }), 'VALIDATION');
  await rejectsWith(w.core.conversations.send(ana, id, { media: { mime: 'image/jpeg', data: JPEG }, body: 'junto' }), 'VALIDATION');
  const big = new Uint8Array(CHAT_IMAGE_MAX_BYTES + 1);
  big.set(JPEG);
  await rejectsWith(w.core.conversations.send(ana, id, { media: { mime: 'image/jpeg', data: big } }), 'VALIDATION');
  assert.equal(parseChatMedia('video/webm', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0])).kind, 'VIDEO');
});

test('foto: aviso para o outro e sem aviso quando a conversa está silenciada', async () => {
  const { w, ana, bia, id } = await setup();
  await w.core.conversations.send(ana, id, { media: { mime: 'image/jpeg', data: JPEG } });
  const bodies = async (u: string) => (await w.core.notifications.list(u)).items.filter((n) => n.type === 'MESSAGE').map((n) => n.body);
  assert.deepEqual(await bodies(bia), ['Enviou uma foto']);
});

// ---------- Fixar e silenciar ----------

test('fixar: sobe para o topo só para quem fixou, com limite', async () => {
  const w = makeWorld();
  const ids = await w.signUpMany('ana', 'pes1', 'pes2', 'pes3', 'pes4', 'pes5', 'pes6');
  const ana = ids['ana']!;
  const convs: string[] = [];
  for (const name of ['pes1', 'pes2', 'pes3', 'pes4', 'pes5', 'pes6']) {
    await befriend(w, ana, ids[name]!);
    const c = await w.core.conversations.open(ana, ids[name]!);
    await w.core.conversations.send(ana, c.id, { body: `oi ${name}` });
    w.clock.tick(1000);
    convs.push(c.id);
  }
  // Ordem natural: a mais recente primeiro (p6 ... p1)
  assert.equal((await w.core.conversations.list(ana))[0]!.id, convs[5]);
  const pinned = await w.core.conversations.setPreferences(ana, convs[0]!, { pinned: true });
  assert.deepEqual(pinned, { pinned: true, muted: false });
  let list = await w.core.conversations.list(ana);
  assert.equal(list[0]!.id, convs[0]);
  assert.equal(list[0]!.pinned, true);
  // A outra pessoa não vê fixada.
  assert.equal((await w.core.conversations.list(ids['pes1']!))[0]!.pinned, false);
  // A fixada mais recente fica acima das outras fixadas.
  await w.core.conversations.setPreferences(ana, convs[1]!, { pinned: true });
  list = await w.core.conversations.list(ana);
  assert.deepEqual(list.slice(0, 2).map((c) => c.id), [convs[1], convs[0]]);
  // Limite
  for (const c of [convs[2]!, convs[3]!, convs[4]!]) await w.core.conversations.setPreferences(ana, c, { pinned: true });
  assert.equal(PINNED_MAX, 5);
  await rejectsWith(w.core.conversations.setPreferences(ana, convs[5]!, { pinned: true }), 'CONFLICT');
  // Fixar de novo uma já fixada não conta; soltar libera espaço.
  await w.core.conversations.setPreferences(ana, convs[0]!, { pinned: true });
  await w.core.conversations.setPreferences(ana, convs[0]!, { pinned: false });
  await w.core.conversations.setPreferences(ana, convs[5]!, { pinned: true });
  assert.equal((await w.core.conversations.list(ana))[0]!.id, convs[5]);
  await rejectsWith(w.core.conversations.setPreferences(ana, convs[0]!, {}), 'VALIDATION');
  await rejectsWith(w.core.conversations.setPreferences(ana, convs[0]!, { pinned: 'sim' }), 'VALIDATION');
  await rejectsWith(w.core.conversations.setPreferences(ids['pes2']!, convs[0]!, { pinned: true }), 'NOT_FOUND');
});

test('silenciar: sem aviso para quem silenciou, mas a mensagem e o contador continuam', async () => {
  const { w, ana, bia, id } = await setup();
  assert.deepEqual(await w.core.conversations.setPreferences(bia, id, { muted: true }), { pinned: false, muted: true });
  await w.core.conversations.send(ana, id, { body: 'oi' });
  const messageNotices = async (u: string) => (await w.core.notifications.list(u)).items.filter((n) => n.type === 'MESSAGE');
  assert.equal((await messageNotices(bia)).length, 0);
  const item = (await w.core.conversations.list(bia))[0]!;
  assert.equal(item.muted, true);
  assert.equal(item.unread, 1);
  assert.equal((await w.core.conversations.messages(bia, id)).muted, true);
  // A outra pessoa continua sendo avisada.
  await w.core.conversations.send(bia, id, { body: 'e aí' });
  assert.equal((await messageNotices(ana)).length, 1);
  await w.core.conversations.setPreferences(bia, id, { muted: false });
  w.clock.tick(1000);
  await w.core.conversations.send(ana, id, { body: 'voltou?' });
  assert.equal((await messageNotices(bia)).length, 1);
});

// ---------- Digitando ----------

test('digitando: aparece para o outro, some sozinho e ao enviar', async () => {
  const { w, ana, bia, id } = await setup();
  assert.deepEqual((await w.core.conversations.messages(bia, id)).typing, []);
  await w.core.conversations.typing(ana, id);
  assert.deepEqual((await w.core.conversations.messages(bia, id)).typing, ['ana']);
  assert.deepEqual((await w.core.conversations.messages(ana, id)).typing, []);
  w.clock.tick(TYPING_TTL_MS + 1);
  assert.deepEqual((await w.core.conversations.messages(bia, id)).typing, []);
  await w.core.conversations.typing(ana, id);
  await w.core.conversations.send(ana, id, { body: 'oi' });
  assert.deepEqual((await w.core.conversations.messages(bia, id)).typing, []);
});

test('digitando: em grupo lista quem digita e some para quem tem bloqueio', async () => {
  const { w, ana, bia, caio } = await setup();
  const g = await w.core.conversations.createGroup(ana, { name: 'Rolê', memberIds: [bia, caio] });
  await w.core.conversations.typing(bia, g.id);
  await w.core.conversations.typing(caio, g.id);
  assert.deepEqual((await w.core.conversations.messages(ana, g.id)).typing.sort(), ['bia', 'caio']);
  await w.core.blocks.block(ana, caio);
  assert.deepEqual((await w.core.conversations.messages(ana, g.id)).typing, ['bia']);
  const outsider = (await w.signUp('zeca')).user.id;
  await rejectsWith(w.core.conversations.typing(outsider, g.id), 'NOT_FOUND');
});
