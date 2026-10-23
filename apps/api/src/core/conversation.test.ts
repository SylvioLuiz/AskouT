import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MESSAGES_PER_MINUTE, MESSAGE_MAX, extractLinks } from './conversation-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

type World = ReturnType<typeof makeWorld>;

async function befriend(w: World, a: string, b: string) {
  await w.core.follows.follow(a, b);
  await w.core.follows.follow(b, a);
}

async function friends() {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await befriend(w, ana!, bia!);
  const chat = await w.core.conversations.open(ana!, bia!);
  return { w, ana: ana!, bia: bia!, caio: caio!, id: chat.id };
}

const card = { source: 'EVENT', title: 'Jazz', venueName: 'Bar do Zé', lat: -23.55, lng: -46.63, startsAt: '2026-10-13T20:00:00.000Z', endsAt: null, sample: true, externalId: 'event:1' };

test('open: só entre amigos, idempotente nos dois sentidos, nunca com bloqueado', async () => {
  const { w, ana, bia, caio, id } = await friends();
  assert.equal((await w.core.conversations.open(bia, ana)).id, id);
  assert.equal((await w.core.conversations.open(ana, bia)).id, id);
  await rejectsWith(w.core.conversations.open(ana, caio), 'FORBIDDEN');
  await rejectsWith(w.core.conversations.open(ana, ana), 'VALIDATION');
  await rejectsWith(w.core.conversations.open(ana, 'xyz'), 'FORBIDDEN');
  await rejectsWith(w.core.conversations.open(ana, undefined), 'VALIDATION');
  await w.core.blocks.block(ana, bia);
  await rejectsWith(w.core.conversations.open(bia, ana), 'NOT_FOUND');
});

test('send: texto é aparado, normaliza quebra de linha e respeita limites', async () => {
  const { w, ana, id } = await friends();
  const sent = await w.core.conversations.send(ana, id, { body: '  oi\r\ntudo bem?  ' });
  assert.equal(sent.body, 'oi\ntudo bem?');
  assert.equal(sent.mine, true);
  assert.equal(sent.kind, 'TEXT');
  assert.equal(sent.suggestion, null);
  for (const bad of ['', '   ', 'a\u0000b', 'x'.repeat(MESSAGE_MAX + 1), 42, {}]) {
    await rejectsWith(w.core.conversations.send(ana, id, { body: bad }), 'VALIDATION');
  }
  await w.core.conversations.send(ana, id, { body: 'x'.repeat(MESSAGE_MAX) });
  await rejectsWith(w.core.conversations.send(ana, id, {}), 'VALIDATION');
  await rejectsWith(w.core.conversations.send(ana, id, { body: 'a', suggestion: card }), 'VALIDATION');
});

test('send: cartão de sugestão é validado campo a campo e só os campos conhecidos passam', async () => {
  const { w, ana, id } = await friends();
  const ok = await w.core.conversations.send(ana, id, { suggestion: { ...card, intruso: 'x' } });
  assert.equal(ok.kind, 'SUGGESTION');
  assert.deepEqual(ok.suggestion, card);
  assert.equal(ok.body, 'Jazz — Bar do Zé');
  const bads: Record<string, unknown>[] = [
    { ...card, source: 'OUTRO' },
    { ...card, title: '' },
    { ...card, lat: 91 },
    { ...card, lng: 'x' },
    { ...card, startsAt: 'ontem' },
    { ...card, sample: 'sim' },
    { ...card, externalId: 'x'.repeat(81) },
  ];
  for (const bad of bads) await rejectsWith(w.core.conversations.send(ana, id, { suggestion: bad }), 'VALIDATION');
  await rejectsWith(w.core.conversations.send(ana, id, { suggestion: [] }), 'VALIDATION');
});

test('privacidade: quem não participa não vê nem envia; bloqueio esconde; deixar de ser amigo deixa só leitura', async () => {
  const { w, ana, bia, caio, id } = await friends();
  await w.core.conversations.send(ana, id, { body: 'segredo' });
  await rejectsWith(w.core.conversations.messages(caio, id), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.send(caio, id, { body: 'x' }), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.markRead(caio, id), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.messages(ana, 'nao-e-uuid'), 'NOT_FOUND');
  assert.deepEqual(await w.core.conversations.list(caio), []);

  await w.core.follows.unfollow(bia, ana);
  const view = await w.core.conversations.messages(ana, id);
  assert.equal(view.canSend, false);
  assert.equal(view.messages.length, 1, 'histórico continua legível');
  await rejectsWith(w.core.conversations.send(ana, id, { body: 'oi?' }), 'FORBIDDEN');
  assert.equal((await w.core.conversations.list(ana))[0]!.canSend, false);

  await w.core.blocks.block(bia, ana);
  await rejectsWith(w.core.conversations.messages(ana, id), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.messages(bia, id), 'NOT_FOUND');
  assert.deepEqual(await w.core.conversations.list(ana), []);
  assert.deepEqual(await w.core.conversations.list(bia), []);
  await w.core.blocks.unblock(bia, ana);
  assert.equal((await w.core.conversations.list(ana)).length, 1, 'ao desbloquear, o histórico volta');
});

test('list e messages: última mensagem, não lidas e leitura ao abrir', async () => {
  const { w, ana, bia, id } = await friends();
  w.clock.tick(1000);
  await w.core.conversations.send(ana, id, { body: 'um' });
  w.clock.tick(1000);
  await w.core.conversations.send(ana, id, { body: 'dois' });
  const [item] = await w.core.conversations.list(bia);
  assert.equal(item!.unread, 2);
  assert.equal(item!.lastMessage!.body, 'dois');
  assert.equal(item!.lastMessage!.mine, false);
  assert.equal(item!.other!.username, 'ana');
  assert.equal((await w.core.conversations.list(ana))[0]!.unread, 0, 'o que você enviou não conta como não lido');

  const view = await w.core.conversations.messages(bia, id);
  assert.deepEqual(view.messages.map((m) => m.body), ['um', 'dois']);
  assert.equal(view.hasMore, false);
  assert.equal((await w.core.conversations.list(bia))[0]!.unread, 0);
  assert.equal(JSON.stringify(view).includes('passwordHash'), false);
});

test('messages: paginação para trás com before e limite', async () => {
  const { w, ana, id } = await friends();
  for (let i = 1; i <= 5; i++) {
    w.clock.tick(1000);
    await w.core.conversations.send(ana, id, { body: `m${i}` });
  }
  const first = await w.core.conversations.messages(ana, id, { limit: 2 });
  assert.deepEqual(first.messages.map((m) => m.body), ['m4', 'm5']);
  assert.equal(first.hasMore, true);
  const older = await w.core.conversations.messages(ana, id, { limit: 2, before: first.messages[0]!.createdAt });
  assert.deepEqual(older.messages.map((m) => m.body), ['m2', 'm3']);
  assert.equal(older.hasMore, true);
  const oldest = await w.core.conversations.messages(ana, id, { limit: 2, before: older.messages[0]!.createdAt });
  assert.deepEqual(oldest.messages.map((m) => m.body), ['m1']);
  assert.equal(oldest.hasMore, false);
  await rejectsWith(w.core.conversations.messages(ana, id, { limit: 0 }), 'VALIDATION');
  await rejectsWith(w.core.conversations.messages(ana, id, { before: 'ontem' }), 'VALIDATION');
});

test('send: limite de mensagens por minuto; passada a janela, libera', async () => {
  const { w, ana, id } = await friends();
  for (let i = 0; i < MESSAGES_PER_MINUTE; i++) await w.core.conversations.send(ana, id, { body: `m${i}` });
  const err = await rejectsWith(w.core.conversations.send(ana, id, { body: 'a mais' }), 'RATE_LIMITED');
  assert.ok(err.details?.retryAfterSeconds);
  w.clock.tick(61_000);
  await w.core.conversations.send(ana, id, { body: 'liberou' });
});

// ---------- Aceitar o lugar e distâncias ----------

async function sentCard() {
  const f = await friends();
  const sent = await f.w.core.conversations.send(f.ana, f.id, { suggestion: card });
  return { ...f, messageId: sent.id };
}

test('respond: só o destinatário responde, uma vez, e o resultado aparece para os dois', async () => {
  const { w, ana, bia, id, messageId } = await sentCard();
  await rejectsWith(w.core.conversations.respond(ana, id, messageId, 'accept'), 'FORBIDDEN');
  await rejectsWith(w.core.conversations.respond(bia, id, messageId, 'talvez'), 'VALIDATION');
  await rejectsWith(w.core.conversations.respond(bia, id, 'nao-existe', 'accept'), 'NOT_FOUND');
  const done = await w.core.conversations.respond(bia, id, messageId, 'accept');
  assert.equal(done.response, 'ACCEPTED');
  assert.ok(done.respondedAt);
  await rejectsWith(w.core.conversations.respond(bia, id, messageId, 'decline'), 'CONFLICT');
  for (const who of [ana, bia]) {
    const view = await w.core.conversations.messages(who, id);
    assert.equal(view.messages[0]!.response, 'ACCEPTED');
  }
  const list = await w.core.conversations.list(ana);
  assert.equal(list[0]!.lastMessage!.response, 'ACCEPTED');
});

test('respond: mensagem de texto não é sugestão, estranhos não respondem, ex-amigos não respondem', async () => {
  const { w, ana, bia, caio, id } = await sentCard();
  const text = await w.core.conversations.send(ana, id, { body: 'oi' });
  await rejectsWith(w.core.conversations.respond(bia, id, text.id, 'accept'), 'NOT_FOUND');
  const card2 = await w.core.conversations.send(ana, id, { suggestion: card });
  await rejectsWith(w.core.conversations.respond(caio, id, card2.id, 'accept'), 'NOT_FOUND');
  await w.core.follows.unfollow(bia, ana);
  await rejectsWith(w.core.conversations.respond(bia, id, card2.id, 'accept'), 'FORBIDDEN');
});

test('distâncias do cartão: só com encontro Flash ativo e os dois compartilhando; somem quando acaba', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await befriend(w, ana!, bia!);
  await w.core.flash.turnOn(ana!, { hours: 2 });
  await w.core.flash.turnOn(bia!, { hours: 2 });
  const invite = await w.core.flash.invite(ana!, bia!);
  const { conversationId } = await w.core.flash.respond(bia!, invite.id, 'accept');
  const id = conversationId!;
  await w.core.conversations.send(ana!, id, { suggestion: card });

  const before = await w.core.conversations.messages(bia!, id);
  assert.equal(before.messages.find((m) => m.suggestion)!.distances, null, 'sem localização não há distância');

  await w.core.flash.shareLocation(ana!, invite.id, { lat: -23.55, lng: -46.63 }); // em cima do lugar
  await w.core.flash.shareLocation(bia!, invite.id, { lat: -23.56, lng: -46.63 }); // ~1,1 km ao sul
  const during = await w.core.conversations.messages(bia!, id);
  const d = during.messages.find((m) => m.suggestion)!.distances!;
  assert.ok(d.themM < 10, `Ana está no lugar: ${d.themM}`);
  assert.ok(d.meM > 1000 && d.meM < 1200, `Bia está a ~1,1 km: ${d.meM}`);
  const forAna = (await w.core.conversations.messages(ana!, id)).messages.find((m) => m.suggestion)!.distances!;
  assert.equal(forAna.meM, d.themM, 'cada um vê a própria distância como "me"');
  assert.equal(forAna.themM, d.meM);

  const text = await w.core.conversations.send(ana!, id, { body: 'oi' });
  assert.equal(text.distances, null, 'texto não tem distância');

  await w.core.flash.end(ana!, invite.id);
  const after = await w.core.conversations.messages(bia!, id);
  assert.equal(after.messages.find((m) => m.suggestion)!.distances, null, 'encontro acabou: a distância some, nada ficou guardado');
  assert.equal(JSON.stringify(after).includes('-23.56'), false);
});

const voice = (head: number[], extra = 40, mime = 'audio/webm;codecs=opus') => `data:${mime};base64,${Buffer.from([...head, ...new Array(extra).fill(7)]).toString('base64')}`;
const WEBM = [0x1a, 0x45, 0xdf, 0xa3];

test('áudio: envia mensagem de voz, só quem está na conversa ouve, e valida o arquivo', async () => {
  const { w, ana, bia, caio, id } = await friends();
  const sent = await w.core.conversations.send(ana, id, { audio: voice(WEBM), audioMs: 4200 });
  assert.equal(sent.kind, 'AUDIO');
  assert.deepEqual(sent.audio, { durationMs: 4200 });
  assert.equal(sent.body, 'Mensagem de voz');
  const got = await w.core.conversations.audio(bia, id, sent.id);
  assert.equal(got.mime, 'audio/webm');
  assert.equal(got.data.length, 44);
  const list = await w.core.conversations.messages(bia, id);
  assert.deepEqual(list.messages.at(-1)!.audio, { durationMs: 4200 });
  assert.equal(list.messages.at(-1)!.mine, false);
  await rejectsWith(w.core.conversations.audio(caio, id, sent.id), 'NOT_FOUND');
  await rejectsWith(w.core.conversations.audio(bia, id, 'nao-existe'), 'NOT_FOUND');
  const text = await w.core.conversations.send(ana, id, { body: 'oi' });
  await rejectsWith(w.core.conversations.audio(bia, id, text.id), 'NOT_FOUND');
  // formatos de gravação de cada navegador
  await w.core.conversations.send(ana, id, { audio: voice([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70], 30, 'audio/mp4'), audioMs: 2000 });
  await w.core.conversations.send(ana, id, { audio: voice([0x4f, 0x67, 0x67, 0x53], 30, 'audio/ogg;codecs=opus'), audioMs: 2000 });
  // variações de escrita do tipo e mp4 fragmentado do Safari
  await w.core.conversations.send(ana, id, { audio: voice([0x4f, 0x67, 0x67, 0x53], 30, 'audio/ogg; codecs=opus'), audioMs: 2000 });
  await w.core.conversations.send(ana, id, { audio: voice([0, 0, 0, 20, 0x73, 0x74, 0x79, 0x70], 30, 'audio/mp4'), audioMs: 2000 });
  await w.core.conversations.send(ana, id, { audio: voice(WEBM, 30, 'audio/webm'), audioMs: 2000 });
  await w.core.conversations.send(ana, id, { audio: voice(WEBM, 30, 'audio/webm;codecs=opus;foo=bar'), audioMs: 2000 });
  const err = await rejectsWith(w.core.conversations.send(ana, id, { audio: voice([1, 2, 3, 4], 30, 'audio/webm'), audioMs: 2000 }), 'VALIDATION');
  assert.match(String(err.details?.audio), /webm/);
});

test('áudio: recusa arquivo falso, grande demais, duração fora de 1–90 s e mistura com texto', async () => {
  const { w, ana, id } = await friends();
  await rejectsWith(w.core.conversations.send(ana, id, { audio: voice([1, 2, 3, 4]), audioMs: 3000 }), 'VALIDATION'); // não é webm de verdade
  await rejectsWith(w.core.conversations.send(ana, id, { audio: 'data:text/html;base64,PGI+', audioMs: 3000 }), 'VALIDATION');
  await rejectsWith(w.core.conversations.send(ana, id, { audio: 'lixo', audioMs: 3000 }), 'VALIDATION');
  await rejectsWith(w.core.conversations.send(ana, id, { audio: voice(WEBM, 700 * 1024), audioMs: 3000 }), 'VALIDATION');
  for (const bad of [0, 999, 90_001, 1500.5, '3000', undefined, null]) {
    await rejectsWith(w.core.conversations.send(ana, id, { audio: voice(WEBM), audioMs: bad }), 'VALIDATION');
  }
  await rejectsWith(w.core.conversations.send(ana, id, { audio: voice(WEBM), audioMs: 3000, body: 'oi' }), 'VALIDATION');
  await w.core.conversations.send(ana, id, { audio: voice(WEBM), audioMs: 90_000 });
  await w.core.conversations.send(ana, id, { audio: voice(WEBM), audioMs: 1_000 });
});

test('áudio: deixou de ser amigo, não envia; aviso não carrega o conteúdo', async () => {
  const { w, ana, bia, id } = await friends();
  await w.core.follows.unfollow(bia, ana);
  await rejectsWith(w.core.conversations.send(ana, id, { audio: voice(WEBM), audioMs: 3000 }), 'FORBIDDEN');
});

test('shared: links, mensagens de voz e encontros da conversa; só quem participa e sem bloqueados', async () => {
  const { w, ana, bia, caio, id } = await friends();
  await w.core.conversations.send(ana, id, { body: 'Olha isso (https://exemplo.com/x), e também http://b.com/y.' });
  await w.core.conversations.send(bia, id, { body: 'sem link nenhum' });
  await w.core.conversations.send(bia, id, { audio: voice(WEBM), audioMs: 3000 });
  const s = await w.core.conversations.shared(ana, id);
  assert.deepEqual(s.links.map((l) => l.url).sort(), ['http://b.com/y', 'https://exemplo.com/x']);
  assert.equal(s.links[0]!.mine, true);
  assert.equal(s.voice.length, 1);
  assert.equal(s.voice[0]!.durationMs, 3000);
  assert.equal(s.voice[0]!.mine, false);
  assert.deepEqual(s.meetups, []);
  assert.equal(s.type, 'DIRECT');
  assert.equal(s.other?.userId, bia);
  await rejectsWith(w.core.conversations.shared(caio, id), 'NOT_FOUND');
  await w.core.blocks.block(ana, bia);
  await rejectsWith(w.core.conversations.shared(ana, id), 'NOT_FOUND');
});

test('extractLinks: tira pontuação do fim e repetidos', () => {
  assert.deepEqual(extractLinks('a https://x.com/a, b https://x.com/a. c (http://y.org/p?q=1)'), ['https://x.com/a', 'http://y.org/p?q=1']);
  assert.deepEqual(extractLinks('nada aqui'), []);
});

test('clear: limpa só para quem pediu; a outra pessoa continua vendo tudo e as novas mensagens chegam', async () => {
  const { w, ana, bia, caio, id } = await friends();
  await w.core.conversations.send(ana, id, { body: 'um' });
  await w.core.conversations.send(bia, id, { body: 'dois https://x.com/a' });
  await w.core.conversations.clear(ana, id);
  assert.equal((await w.core.conversations.messages(ana, id)).messages.length, 0);
  assert.equal((await w.core.conversations.messages(bia, id)).messages.length, 2);
  assert.equal((await w.core.conversations.shared(ana, id)).links.length, 0);
  assert.equal((await w.core.conversations.shared(bia, id)).links.length, 1);
  // "Apagar conversa": a conversa 1 a 1 limpa e sem mensagens novas some da lista de quem apagou, não da outra pessoa.
  assert.equal((await w.core.conversations.list(ana)).some((c) => c.id === id), false);
  assert.equal((await w.core.conversations.list(bia)).some((c) => c.id === id), true);
  w.clock.tick(5_000);
  await w.core.conversations.send(bia, id, { body: 'três' });
  assert.equal((await w.core.conversations.list(ana)).some((c) => c.id === id), true, 'volta quando chega mensagem nova');
  assert.deepEqual((await w.core.conversations.messages(ana, id)).messages.map((m) => m.body), ['três']);
  await rejectsWith(w.core.conversations.clear(caio, id), 'NOT_FOUND');
});

test('report: motivo da lista, detalhes limitados, guarda as últimas mensagens e só quem participa denuncia', async () => {
  const { w, ana, bia, caio, id } = await friends();
  await w.core.conversations.send(bia, id, { body: 'ofensa  qualquer' });
  await rejectsWith(w.core.conversations.report(ana, id, 'NADA'), 'VALIDATION');
  await rejectsWith(w.core.conversations.report(ana, id, undefined), 'VALIDATION');
  await rejectsWith(w.core.conversations.report(ana, id, 'SPAM', 'x'.repeat(301)), 'VALIDATION');
  await rejectsWith(w.core.conversations.report(caio, id, 'SPAM'), 'NOT_FOUND');
  assert.deepEqual(await w.core.conversations.report(ana, id, 'OFFENSIVE', ' xingou '), { reported: true });
  assert.deepEqual(await w.core.conversations.report(ana, id, 'SPAM'), { reported: true }, 'denunciar de novo atualiza');
  const stored = [...w.conversations.reports.values()];
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.reason, 'SPAM');
  assert.equal(stored[0]!.reportedUserId, bia);
  assert.match(stored[0]!.evidence, /denunciado: ofensa qualquer/);
});
