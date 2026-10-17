import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

async function setup(policy: 'UNANIMITY' | 'MAJORITY' | 'MANUAL' = 'MAJORITY') {
  const w = makeWorld();
  const users = await w.signUpMany('ana', 'bia', 'caio', 'dani');
  const ana = users['ana']!;
  const bia = users['bia']!;
  const caio = users['caio']!;
  const dani = users['dani']!;
  for (const id of [bia, caio, dani]) {
    await w.core.follows.follow(ana, id);
    await w.core.follows.follow(id, ana);
  }
  const group = await w.core.conversations.createGroup(ana, { name: 'Rolê', memberIds: [bia, caio, dani] });
  const poll = await w.core.scheduling.create(ana, group.id, { title: 'Churrasco', rangeStart: '2026-10-20', rangeEnd: '2026-10-26', durationMinutes: 240, confirmationPolicy: policy });
  return { w, ana, bia, caio, dani, group, poll };
}

test('criar: valida intervalo, passado e permissão', async () => {
  const { w, ana, group, bia } = await setup();
  const base = { title: 'X', rangeStart: '2026-10-20', rangeEnd: '2026-10-22' };
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, rangeStart: '2026-10-01' }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, rangeEnd: '2026-10-19' }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, rangeEnd: '2027-03-01' }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, title: '' }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, confirmationPolicy: 'X' }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, timezone: 'Marte/Olimpo' }), 'VALIDATION');
  const w2 = makeWorld();
  const u = await w2.signUpMany('xavi', 'yara');
  await rejectsWith(w2.core.scheduling.create(u['xavi']!, group.id, base), 'NOT_FOUND');
  void bia;
});

test('votar: um voto por dia, edição, limpar, fora do intervalo e permissões', async () => {
  const { w, ana, bia, poll } = await setup();
  assert.equal(poll.days.length, 7);
  let v = await w.core.scheduling.vote(bia, poll.id, { status: 'YES', dates: ['2026-10-23', '2026-10-24'] });
  assert.equal(v.myVotes['2026-10-23'], 'YES');
  v = await w.core.scheduling.vote(bia, poll.id, { status: 'NO', dates: ['2026-10-23'] });
  assert.equal(v.myVotes['2026-10-23'], 'NO');
  assert.equal(Object.keys(v.myVotes).length, 2);
  v = await w.core.scheduling.vote(bia, poll.id, { status: 'CLEAR', dates: ['2026-10-24'] });
  assert.equal(v.myVotes['2026-10-24'], undefined);
  await rejectsWith(w.core.scheduling.vote(bia, poll.id, { status: 'YES', dates: ['2026-10-27'] }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.vote(bia, poll.id, { status: 'XX', dates: ['2026-10-23'] }), 'VALIDATION');
  const out = (await w.signUp('zeca')).user.id;
  await rejectsWith(w.core.scheduling.get(out, poll.id), 'NOT_FOUND');
  await rejectsWith(w.core.scheduling.vote(out, poll.id, { status: 'YES', dates: ['2026-10-23'] }), 'NOT_FOUND');
  // sem resposta não conta como "não posso"
  const day = (await w.core.scheduling.get(ana, poll.id)).days.find((d) => d.date === '2026-10-25')!;
  assert.equal(day.no, 0);
  assert.equal(day.unanswered, 4);
});

test('mapa de calor e ranking mudam quando os votos mudam; concluir não muda votos', async () => {
  const { w, ana, bia, caio, dani, poll } = await setup();
  assert.equal((await w.core.scheduling.get(ana, poll.id)).enoughData, false);
  for (const u of [ana, bia, caio, dani]) await w.core.scheduling.vote(u, poll.id, { status: 'YES', dates: ['2026-10-24'] });
  await w.core.scheduling.vote(ana, poll.id, { status: 'MAYBE', dates: ['2026-10-25'] });
  let v = await w.core.scheduling.get(ana, poll.id);
  assert.equal(v.ranking[0]!.date, '2026-10-24');
  assert.equal(v.ranking[0]!.compatibility, 100);
  assert.equal(v.ranking[0]!.coverage, 100);
  assert.equal(v.enoughData, true);
  await w.core.scheduling.vote(bia, poll.id, { status: 'NO', dates: ['2026-10-24'] });
  v = await w.core.scheduling.get(ana, poll.id);
  assert.equal(v.days.find((d) => d.date === '2026-10-24')!.no, 1);
  v = await w.core.scheduling.finish(bia, poll.id, true);
  assert.equal(v.iFinished, true);
  assert.equal(v.myVotes['2026-10-24'], 'NO');
  v = await w.core.scheduling.finish(bia, poll.id, false);
  assert.equal(v.iFinished, false);
});

test('só o organizador propõe; maioria fecha e cria o encontro no calendário', async () => {
  const { w, ana, bia, caio, dani, poll, group } = await setup('MAJORITY');
  await rejectsWith(w.core.scheduling.propose(bia, poll.id, '2026-10-24'), 'FORBIDDEN');
  await rejectsWith(w.core.scheduling.propose(ana, poll.id, '2026-11-24'), 'VALIDATION');
  let v = await w.core.scheduling.propose(ana, poll.id, '2026-10-24');
  assert.equal(v.status, 'CONFIRMING');
  assert.equal(v.proposal?.startsAt, '2026-10-24T22:00:00.000Z');
  await rejectsWith(w.core.scheduling.vote(bia, poll.id, { status: 'YES', dates: ['2026-10-24'] }), 'CONFLICT');
  await rejectsWith(w.core.scheduling.propose(ana, poll.id, '2026-10-25'), 'CONFLICT');
  v = await w.core.scheduling.respond(bia, poll.id, 'CONFIRMED');
  assert.equal(v.status, 'CONFIRMING');
  v = await w.core.scheduling.respond(caio, poll.id, 'CONFIRMED');
  assert.equal(v.status, 'FINALIZED');
  assert.ok(v.final?.meetupId);
  assert.equal((await w.core.scheduling.get(dani, poll.id)).final?.date, '2026-10-24');
  const chat = await w.core.conversations.messages(dani, group.id);
  assert.ok(chat.messages.some((m) => m.kind === 'MEETUP'));
  await rejectsWith(w.core.scheduling.respond(dani, poll.id, 'CONFIRMED'), 'CONFLICT');
  assert.equal((await w.core.scheduling.listForConversation(ana, group.id)).items[0]!.finalDate, '2026-10-24');
});

test('unanimidade: uma recusa derruba a data e a votação reabre; histórico fica', async () => {
  const { w, ana, bia, poll } = await setup('UNANIMITY');
  await w.core.scheduling.propose(ana, poll.id, '2026-10-24');
  const v = await w.core.scheduling.respond(bia, poll.id, 'DECLINED');
  assert.equal(v.status, 'VOTING');
  assert.equal(v.proposal, null);
  assert.equal(v.history.length, 1);
  assert.equal(v.history[0]!.status, 'REJECTED');
  const again = await w.core.scheduling.propose(ana, poll.id, '2026-10-25');
  assert.equal(again.status, 'CONFIRMING');
});

test('decisão manual: só o organizador fecha; retirar proposta e cancelar', async () => {
  const { w, ana, bia, caio, poll } = await setup('MANUAL');
  await w.core.scheduling.propose(ana, poll.id, '2026-10-24');
  let v = await w.core.scheduling.respond(bia, poll.id, 'CONFIRMED');
  v = await w.core.scheduling.respond(caio, poll.id, 'ADJUST');
  assert.equal(v.status, 'CONFIRMING');
  await rejectsWith(w.core.scheduling.finalizeManual(bia, poll.id), 'FORBIDDEN');
  v = await w.core.scheduling.finalizeManual(ana, poll.id);
  assert.equal(v.status, 'FINALIZED');

  const s = await setup('MANUAL');
  await s.w.core.scheduling.propose(s.ana, s.poll.id, '2026-10-24');
  assert.equal((await s.w.core.scheduling.withdraw(s.ana, s.poll.id)).status, 'VOTING');
  await rejectsWith(s.w.core.scheduling.cancel(s.bia, s.poll.id), 'FORBIDDEN');
  assert.equal((await s.w.core.scheduling.cancel(s.ana, s.poll.id)).status, 'CANCELLED');
  await rejectsWith(s.w.core.scheduling.vote(s.bia, s.poll.id, { status: 'YES', dates: ['2026-10-24'] }), 'CONFLICT');
});

test('prazo de votação encerra os votos; eventos do mesmo grupo são independentes', async () => {
  const { w, ana, bia, group } = await setup();
  const deadline = new Date(w.clock.now().getTime() + 3_600_000).toISOString();
  const b = await w.core.scheduling.create(ana, group.id, { title: 'Cinema', rangeStart: '2026-10-21', rangeEnd: '2026-10-23', votingDeadline: deadline });
  await w.core.scheduling.vote(bia, b.id, { status: 'YES', dates: ['2026-10-21'] });
  w.clock.tick(2 * 3_600_000);
  await rejectsWith(w.core.scheduling.vote(bia, b.id, { status: 'YES', dates: ['2026-10-22'] }), 'CONFLICT');
  assert.equal((await w.core.scheduling.get(bia, b.id)).votingOpen, false);
  const list = await w.core.scheduling.listForConversation(ana, group.id);
  assert.equal(list.items.length, 2);
});

test('resumo da conversa: progresso, melhor data até agora e proposta', async () => {
  const { w, ana, bia, caio, dani, group, poll } = await setup('MANUAL');
  let s = (await w.core.scheduling.listForConversation(ana, group.id)).items[0]!;
  assert.equal(s.participantCount, 4);
  assert.equal(s.finishedCount, 0);
  assert.equal(s.best, null);
  assert.equal(s.needsMyVote, true);
  for (const u of [ana, bia, caio, dani]) await w.core.scheduling.vote(u, poll.id, { status: 'YES', dates: ['2026-10-24'] });
  await w.core.scheduling.finish(bia, poll.id, true);
  s = (await w.core.scheduling.listForConversation(ana, group.id)).items[0]!;
  assert.equal(s.finishedCount, 1);
  assert.equal(s.best?.date, '2026-10-24');
  assert.equal(s.best?.compatibility, 100);
  await w.core.scheduling.propose(ana, poll.id, '2026-10-24');
  s = (await w.core.scheduling.listForConversation(bia, group.id)).items[0]!;
  assert.equal(s.proposedDate, '2026-10-24');
  assert.equal(s.needsMyConfirmation, true);
  assert.equal(s.best, null);
});

test('encerrar votos: só o organizador, só com todos concluídos; trava votos; prazo fecha sozinho', async () => {
  const { w, ana, bia, caio, dani, poll } = await setup('MANUAL');
  assert.equal(poll.canClose, false);
  await rejectsWith(w.core.scheduling.closeVoting(ana, poll.id), 'CONFLICT');
  for (const u of [ana, bia, caio, dani]) await w.core.scheduling.finish(u, poll.id, true);
  assert.equal((await w.core.scheduling.get(ana, poll.id)).canClose, true);
  assert.equal((await w.core.scheduling.get(bia, poll.id)).canClose, false);
  await rejectsWith(w.core.scheduling.closeVoting(bia, poll.id), 'FORBIDDEN');
  const closed = await w.core.scheduling.closeVoting(ana, poll.id);
  assert.equal(closed.votingClosed, true);
  assert.equal(closed.votingOpen, false);
  await rejectsWith(w.core.scheduling.vote(bia, poll.id, { status: 'NO', dates: ['2026-10-24'] }), 'CONFLICT');
  await rejectsWith(w.core.scheduling.closeVoting(ana, poll.id), 'CONFLICT');
  // com votos fechados ainda dá para propor, e uma proposta recusada reabre os votos
  await w.core.scheduling.propose(ana, poll.id, '2026-10-24');
  const back = await w.core.scheduling.withdraw(ana, poll.id);
  assert.equal(back.votingOpen, true);
});

test('prazo vencido encerra sozinho e some da lista "falta votar"', async () => {
  const { w, ana, bia, group } = await setup();
  const deadline = new Date(w.clock.now().getTime() + 3_600_000).toISOString();
  const p = await w.core.scheduling.create(ana, group.id, { title: 'Cinema', rangeStart: '2026-10-21', rangeEnd: '2026-10-23', votingDeadline: deadline });
  assert.equal((await w.core.scheduling.get(bia, p.id)).votingClosed, false);
  w.clock.tick(2 * 3_600_000);
  const v = await w.core.scheduling.get(bia, p.id);
  assert.equal(v.votingClosed, true);
  const item = (await w.core.scheduling.listForConversation(bia, group.id)).items.find((i) => i.id === p.id)!;
  assert.equal(item.needsMyVote, false);
  const proposed = await w.core.scheduling.propose(ana, p.id, '2026-10-22');
  assert.equal(proposed.status, 'CONFIRMING');
});

test('resumo traz votantes e fim da data definida', async () => {
  const { w, ana, bia, caio, group, poll } = await setup('MANUAL');
  await w.core.scheduling.vote(bia, poll.id, { status: 'YES', dates: ['2026-10-24'] });
  let s = (await w.core.scheduling.listForConversation(ana, group.id)).items[0]!;
  assert.equal(s.votedCount, 1);
  assert.equal(s.finalEndsAt, null);
  await w.core.scheduling.propose(ana, poll.id, '2026-10-24');
  await w.core.scheduling.respond(bia, poll.id, 'CONFIRMED');
  await w.core.scheduling.finalizeManual(ana, poll.id);
  s = (await w.core.scheduling.listForConversation(caio, group.id)).items[0]!;
  assert.equal(s.finalDate, '2026-10-24');
  assert.equal(s.finalEndsAt, '2026-10-25T02:00:00.000Z');
});

const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;

test('evento criado a partir da votação: confirmados já vão, nome sincroniza, uma vez só', async () => {
  const { w, ana, bia, caio, dani, poll, group } = await setup('MAJORITY');
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG], event: { title: 'X', startsAt: '2026-10-24T22:00:00.000Z' }, datePollId: poll.id }), 'CONFLICT');
  await w.core.scheduling.propose(ana, poll.id, '2026-10-24');
  await w.core.scheduling.respond(bia, poll.id, 'CONFIRMED');
  await w.core.scheduling.respond(caio, poll.id, 'CONFIRMED');
  await rejectsWith(w.core.posts.create(bia, { images: [JPEG], event: { title: 'X', startsAt: '2026-10-24T22:00:00.000Z' }, datePollId: poll.id }), 'NOT_FOUND');
  const post = await w.core.posts.create(ana, { images: [JPEG], event: { title: 'Churras na laje', startsAt: '2026-10-24T22:00:00.000Z' }, datePollId: poll.id });
  const ref = { source: 'USER' as const, id: post.id };
  assert.equal(await w.eventRoom.isGoing(ref, bia), true);
  assert.equal(await w.eventRoom.isGoing(ref, caio), true);
  assert.equal(await w.eventRoom.isGoing(ref, dani), false);
  const [item] = (await w.core.scheduling.listForConversation(ana, group.id)).items;
  assert.equal(item!.title, 'Churras na laje');
  assert.equal(item!.event?.id, post.id);
  const linked = await w.meetups.find(item!.meetupId!);
  assert.equal(linked?.eventPostId, post.id, 'o encontro guarda o ID do evento');
  assert.equal((await w.core.meetups.get(ana, item!.meetupId!)).eventRef, post.id);
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG], event: { title: 'Outro', startsAt: '2026-10-24T22:00:00.000Z' }, datePollId: poll.id }), 'CONFLICT');
  await w.core.posts.update(ana, post.id, { event: { title: 'Churras renomeado', startsAt: '2026-10-24T22:00:00.000Z' } });
  const after = (await w.core.scheduling.listForConversation(ana, group.id)).items[0]!;
  assert.equal(after.title, 'Churras renomeado');
  assert.equal((await w.core.meetups.get(ana, after.meetupId!)).title, 'Churras renomeado');
});

test('prazo acabou: avisa todos uma única vez (chat + notificação) e o organizador escolhe a data', async () => {
  const { w, ana, bia, caio, group } = await setup();
  const deadline = new Date(w.clock.now().getTime() + 3_600_000).toISOString();
  const p = await w.core.scheduling.create(ana, group.id, { title: 'Cinema', rangeStart: '2026-10-21', rangeEnd: '2026-10-23', votingDeadline: deadline });
  assert.equal(await w.core.scheduling.notifyDeadlines(), 0);
  w.clock.tick(2 * 3_600_000);
  assert.equal(await w.core.scheduling.notifyDeadlines(), 1);
  assert.equal(await w.core.scheduling.notifyDeadlines(), 0);
  const titles = async (id: string) => (await w.core.notifications.list(id)).items.filter((n) => n.url === `/planejar/${p.id}` && /encerrou|encerrada/i.test(n.title)).map((n) => n.title);
  assert.deepEqual(await titles(bia), ['Votação encerrada']);
  assert.deepEqual(await titles(caio), ['Votação encerrada']);
  assert.deepEqual(await titles(ana), ['Sua votação encerrou']);
  const chat = await w.core.conversations.messages(bia, group.id);
  assert.ok(chat.messages.some((m) => m.kind === 'SYSTEM' && m.body.includes('prazo da votação "Cinema" acabou')));
});

test('prazo: votação já encerrada à mão, proposta ou cancelada não avisa', async () => {
  const { w, ana, bia, caio, dani, group } = await setup();
  const deadline = new Date(w.clock.now().getTime() + 3_600_000).toISOString();
  const mk = (title: string) => w.core.scheduling.create(ana, group.id, { title, rangeStart: '2026-10-21', rangeEnd: '2026-10-23', votingDeadline: deadline });
  const closed = await mk('A');
  for (const u of [ana, bia, caio, dani]) await w.core.scheduling.finish(u, closed.id, true);
  await w.core.scheduling.closeVoting(ana, closed.id);
  const cancelled = await mk('B');
  await w.core.scheduling.cancel(ana, cancelled.id);
  w.clock.tick(2 * 3_600_000);
  assert.equal(await w.core.scheduling.notifyDeadlines(), 0);
});
